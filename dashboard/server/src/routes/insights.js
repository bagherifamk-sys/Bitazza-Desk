// GET /api/insights?range=7d&channel=&agent_id=&category=&from=&to=
// Unified view: merges all analytics + metrics data in a single call.
// Permission: section.analytics (base) — agent_breakdown only populated for section.metrics holders.
const router = require('express').Router();
const pool   = require('../db/pg');
const { authenticate, requirePermission } = require('../middleware/auth');

router.use(authenticate, requirePermission('section.analytics'));

const VALID_CHANNELS = ['web', 'line', 'facebook', 'email'];
const VALID_RANGES   = ['today', '7d', '30d', 'custom'];

// Returns un-aliased WHERE fragment + params (same pattern as analytics.js)
function dateFilter(range, from, to) {
  switch (range) {
    case 'today':  return { sql: `created_at >= NOW() - INTERVAL '1 day'`,   params: [] };
    case '30d':    return { sql: `created_at >= NOW() - INTERVAL '30 days'`, params: [] };
    case 'custom':
      if (from && to) return { sql: `created_at BETWEEN $1 AND $2`, params: [from, to] };
      return { sql: `created_at >= NOW() - INTERVAL '30 days'`, params: [] };
    default:       return { sql: `created_at >= NOW() - INTERVAL '7 days'`,  params: [] };
  }
}

router.get('/', async (req, res) => {
  const { from, to } = req.query;

  const range    = VALID_RANGES.includes(req.query.range)     ? req.query.range    : '7d';
  const channel  = VALID_CHANNELS.includes(req.query.channel) ? req.query.channel  : null;
  const agent_id = /^[0-9a-f-]{36}$/i.test(req.query.agent_id ?? '') ? req.query.agent_id : null;
  const category = typeof req.query.category === 'string' && /^[\w_]+$/.test(req.query.category) ? req.query.category : null;

  const canSeeAgentBreakdown = (req.user?.permissions ?? []).includes('section.metrics');

  const { sql: dateSql, params: baseParams } = dateFilter(range, from, to);

  const extraClauses = [];
  const extraParams  = [];
  let p = baseParams.length + 1;

  if (channel)  { extraClauses.push(`channel = $${p++}`);     extraParams.push(channel); }
  if (agent_id) { extraClauses.push(`assigned_to = $${p++}`); extraParams.push(agent_id); }
  if (category) { extraClauses.push(`category = $${p++}`);    extraParams.push(category); }

  const allParams  = [...baseParams, ...extraParams];
  const extraWhere = extraClauses.length ? 'AND ' + extraClauses.join(' AND ') : '';

  // w  = bare WHERE fragment (no alias) — for sub-queries using FROM tickets
  // wt = aliased WHERE fragment         — for queries using FROM tickets t
  const w  = `${dateSql} ${extraWhere}`;
  const wt = w
    .replace(/\bcreated_at\b/g, 't.created_at')
    .replace(/\bchannel\b/g,    't.channel')
    .replace(/\bassigned_to\b/g,'t.assigned_to')
    .replace(/\bcategory\b/g,   't.category');

  const q = (sql) => pool.query(sql, allParams);

  try {
    const queries = [

      // ── Summary KPIs ───────────────────────────────────────────────────────
      q(`
        SELECT
          COUNT(*)::int AS total_tickets,
          COUNT(*) FILTER (WHERE t.status = 'Closed_Resolved')::int AS resolved,
          COUNT(*) FILTER (WHERE t.status = 'Escalated')::int AS escalated,
          COUNT(*) FILTER (WHERE t.sla_breached = true)::int AS sla_breached,
          (COUNT(*) FILTER (WHERE t.status = 'Closed_Resolved'))::float
            / NULLIF(COUNT(*), 0) AS resolution_rate,
          AVG(
            CASE WHEN EXISTS (
              SELECT 1 FROM messages m WHERE m.ticket_id = t.id AND m.sender_type IN ('agent','bot')
            ) THEN
              EXTRACT(EPOCH FROM (
                (SELECT m.created_at FROM messages m
                 WHERE m.ticket_id = t.id AND m.sender_type IN ('agent','bot')
                 ORDER BY m.created_at ASC LIMIT 1)
                - t.created_at
              ))
            END
          )::float AS avg_frt_s,
          AVG(
            CASE WHEN t.status = 'Closed_Resolved'
              AND EXISTS (SELECT 1 FROM messages m WHERE m.ticket_id = t.id AND m.sender_type IN ('agent','bot'))
            THEN EXTRACT(EPOCH FROM (t.updated_at - t.created_at))
            END
          )::float AS avg_aht_s,
          AVG(t.csat_score)::float AS csat_avg,
          (COUNT(*) FILTER (WHERE t.channel = 'web' AND t.status = 'Closed_Resolved'))::float
            / NULLIF(COUNT(*) FILTER (WHERE t.channel = 'web'), 0) AS bot_resolution_rate
        FROM tickets t
        WHERE ${wt}
      `),

      // ── Volume ─────────────────────────────────────────────────────────────
      q(`
        SELECT
          COUNT(*)::int AS total,
          (SELECT json_agg(json_build_object('date', day, 'count', cnt) ORDER BY day)
           FROM (SELECT DATE(created_at) AS day, COUNT(*)::int AS cnt
                 FROM tickets WHERE ${w} GROUP BY day) d) AS by_day,
          (SELECT json_agg(json_build_object('channel', channel, 'count', cnt))
           FROM (SELECT channel, COUNT(*)::int AS cnt
                 FROM tickets WHERE ${w} GROUP BY channel) ch) AS by_channel,
          (SELECT json_agg(json_build_object('category', category, 'count', cnt) ORDER BY cnt DESC)
           FROM (SELECT category, COUNT(*)::int AS cnt
                 FROM tickets WHERE ${w} AND category IS NOT NULL
                 GROUP BY category ORDER BY cnt DESC LIMIT 9) ca) AS by_category
        FROM tickets WHERE ${w}
      `),

      // ── Response time (FRT) ────────────────────────────────────────────────
      q(`
        WITH frt AS (
          SELECT t.id,
            EXTRACT(EPOCH FROM (
              (SELECT m.created_at FROM messages m
               WHERE m.ticket_id = t.id AND m.sender_type IN ('agent','bot')
               ORDER BY m.created_at ASC LIMIT 1)
              - t.created_at
            )) AS seconds,
            DATE(t.created_at) AS day
          FROM tickets t WHERE ${wt}
            AND EXISTS (SELECT 1 FROM messages m WHERE m.ticket_id = t.id AND m.sender_type IN ('agent','bot'))
        ),
        by_day AS (SELECT day, ROUND(AVG(seconds)::numeric,1) AS avg_s FROM frt GROUP BY day)
        SELECT
          AVG(seconds)::float AS avg_s,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY seconds)::float AS median_s,
          PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY seconds)::float AS p90_s,
          (SELECT json_agg(json_build_object('date', day, 'avg_s', avg_s) ORDER BY day) FROM by_day) AS over_time
        FROM frt
      `),

      // ── Resolution (AHT) ──────────────────────────────────────────────────
      q(`
        WITH res AS (
          SELECT t.id, t.channel,
            EXTRACT(EPOCH FROM (t.updated_at - t.created_at)) AS seconds,
            DATE(t.created_at) AS day
          FROM tickets t WHERE ${wt}
            AND t.status = 'Closed_Resolved'
            AND EXISTS (SELECT 1 FROM messages m WHERE m.ticket_id = t.id AND m.sender_type IN ('agent','bot'))
        ),
        by_chan AS (SELECT channel, ROUND(AVG(seconds)::numeric,1) AS avg_s FROM res GROUP BY channel),
        by_day  AS (SELECT day,     ROUND(AVG(seconds)::numeric,1) AS avg_s FROM res GROUP BY day)
        SELECT
          AVG(seconds)::float AS avg_s,
          (SELECT json_agg(json_build_object('channel', channel, 'avg_s', avg_s) ORDER BY channel) FROM by_chan) AS by_channel,
          (SELECT json_agg(json_build_object('date', day, 'avg_s', avg_s) ORDER BY day)             FROM by_day)  AS over_time
        FROM res
      `),

      // ── Bot performance ────────────────────────────────────────────────────
      // bot = ai_persona IS NOT NULL; human = assigned_to IS NOT NULL AND ai_persona IS NULL
      q(`
        WITH daily AS (
          SELECT DATE(t.created_at) AS day,
            COUNT(*) FILTER (WHERE t.ai_persona IS NOT NULL)                              AS bot,
            COUNT(*) FILTER (WHERE t.ai_persona IS NULL AND t.assigned_to IS NOT NULL)   AS human
          FROM tickets t WHERE ${wt} GROUP BY DATE(t.created_at)
        ),
        per_bot AS (
          SELECT
            COALESCE(t.ai_persona->>'ai_name', 'Unknown Bot') AS bot_name,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE t.status = 'Closed_Resolved')::int AS resolved,
            COUNT(*) FILTER (WHERE t.status = 'Escalated')::int AS escalated,
            AVG(t.csat_score)::float AS csat_avg
          FROM tickets t WHERE ${wt} AND t.ai_persona IS NOT NULL
          GROUP BY t.ai_persona->>'ai_name' ORDER BY total DESC LIMIT 20
        )
        SELECT
          (SELECT COUNT(*)::float FROM tickets t WHERE ${wt} AND t.ai_persona IS NOT NULL AND t.status = 'Closed_Resolved')
            / NULLIF((SELECT COUNT(*) FROM tickets t WHERE ${wt} AND t.ai_persona IS NOT NULL), 0) AS resolution_rate,
          (SELECT COUNT(*)::float FROM tickets t WHERE ${wt} AND t.status = 'Escalated')
            / NULLIF((SELECT COUNT(*) FROM tickets t WHERE ${wt}), 0) AS handoff_rate,
          (SELECT COUNT(*)::int FROM tickets t WHERE ${wt} AND t.ai_persona IS NOT NULL) AS bot_total,
          (SELECT COUNT(*)::int FROM tickets t WHERE ${wt} AND t.ai_persona IS NULL AND t.assigned_to IS NOT NULL) AS human_total,
          (SELECT json_agg(json_build_object('date', day, 'bot', bot, 'human', human) ORDER BY day) FROM daily) AS by_day,
          (SELECT json_agg(json_build_object(
            'bot_name', bot_name,
            'total', total,
            'resolved', resolved,
            'escalated', escalated,
            'resolution_rate', CASE WHEN total > 0 THEN resolved::float / total ELSE 0 END,
            'escalation_rate', CASE WHEN total > 0 THEN escalated::float / total ELSE 0 END,
            'csat_avg', csat_avg
          ) ORDER BY total DESC) FROM per_bot) AS by_bot
      `),

      // ── CSAT ──────────────────────────────────────────────────────────────
      q(`
        WITH base AS (SELECT csat_score, channel FROM tickets WHERE ${w}),
        by_chan AS (
          SELECT channel, ROUND(AVG(csat_score)::numeric,2) AS avg_score
          FROM base WHERE csat_score IS NOT NULL GROUP BY channel
        ),
        dist AS (
          SELECT gs, COUNT(b.csat_score)::int AS cnt
          FROM generate_series(1,5) gs
          LEFT JOIN base b ON b.csat_score = gs
          GROUP BY gs
        )
        SELECT
          AVG(csat_score)::float AS avg,
          COUNT(csat_score)::int AS count,
          (SELECT json_agg(json_build_object('score', gs, 'count', cnt) ORDER BY gs) FROM dist) AS distribution,
          (SELECT json_agg(json_build_object('channel', channel, 'avg', avg_score)) FROM by_chan) AS by_channel
        FROM base
      `),

      // ── Intent ────────────────────────────────────────────────────────────
      q(`
        SELECT category, COUNT(*)::int AS count,
          COUNT(*)::float / NULLIF(SUM(COUNT(*)) OVER(), 0) AS pct
        FROM tickets WHERE ${w} AND category IS NOT NULL
        GROUP BY category ORDER BY count DESC LIMIT 9
      `),
    ];

    // ── Supervisor queries — only run when caller has section.metrics ──────────
    const supervisorQueries = canSeeAgentBreakdown ? [

      // [0] Agent leaderboard — all agents, tickets handled, FCR, SLA, FRT, AHT, CSAT
      pool.query(`
        WITH period_tickets AS (
          SELECT t.* FROM tickets t WHERE ${wt}
        ),
        fcr AS (
          SELECT t.assigned_to,
            COUNT(*) FILTER (WHERE t.status = 'Closed_Resolved'
              AND NOT EXISTS (
                SELECT 1 FROM audit_logs al
                WHERE al.target_id = t.id AND al.action = 'ticket_reopened'
              ))::int AS fcr_count
          FROM tickets t WHERE ${wt} AND t.assigned_to IS NOT NULL
          GROUP BY t.assigned_to
        )
        SELECT
          u.id AS agent_id,
          u.name,
          COUNT(t.id)::int                                                               AS total,
          COUNT(t.id) FILTER (WHERE t.status = 'Closed_Resolved')::int AS resolved,
          COALESCE(fcr.fcr_count, 0)                                                     AS fcr,
          COUNT(t.id) FILTER (WHERE t.sla_breached = true)::int                         AS sla_breaches,
          (COUNT(t.id) FILTER (WHERE t.sla_breached = true))::float
            / NULLIF(COUNT(t.id), 0)                                                     AS sla_breach_rate,
          AVG(EXTRACT(EPOCH FROM (
            (SELECT m.created_at FROM messages m
             WHERE m.ticket_id = t.id AND m.sender_type = 'agent'
             ORDER BY m.created_at ASC LIMIT 1)
            - t.created_at
          )))::float                                                                      AS avg_frt_s,
          AVG(CASE WHEN t.status = 'Closed_Resolved'
            THEN EXTRACT(EPOCH FROM (t.updated_at - t.created_at)) END)::float          AS avg_aht_s,
          AVG(t.csat_score)::float                                                       AS csat_avg,
          COUNT(t.id) FILTER (WHERE t.csat_score IS NOT NULL)::int                      AS csat_count
        FROM users u
        LEFT JOIN period_tickets t ON t.assigned_to = u.id
        LEFT JOIN fcr ON fcr.assigned_to = u.id
        WHERE u.active = true
        GROUP BY u.id, u.name, fcr.fcr_count
        ORDER BY total DESC, u.name ASC
      `, allParams),

      // [1] SLA breach breakdown — by agent and by category
      q(`
        SELECT
          (SELECT json_agg(json_build_object('name', name, 'breaches', breaches, 'total', total,
            'breach_rate', CASE WHEN total > 0 THEN breaches::float / total ELSE 0 END) ORDER BY breaches DESC)
           FROM (
             SELECT u.name,
               COUNT(t.id) FILTER (WHERE t.sla_breached)::int AS breaches,
               COUNT(t.id)::int AS total
             FROM users u
             LEFT JOIN tickets t ON t.assigned_to = u.id AND ${wt}
             WHERE u.active = true
             GROUP BY u.name ORDER BY breaches DESC LIMIT 15
           ) a) AS by_agent,
          (SELECT json_agg(json_build_object('category', category, 'breaches', breaches, 'total', total,
            'breach_rate', CASE WHEN total > 0 THEN breaches::float / total ELSE 0 END) ORDER BY breaches DESC)
           FROM (
             SELECT category, COUNT(*) FILTER (WHERE sla_breached)::int AS breaches, COUNT(*)::int AS total
             FROM tickets WHERE ${w} AND category IS NOT NULL
             GROUP BY category ORDER BY breaches DESC LIMIT 10
           ) c) AS by_category
      `),

      // [2] Queue health — backlog age buckets, unassigned, pending_customer, reopened rate
      q(`
        SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('Closed_Resolved','Closed_Unresponsive'))::int  AS open_total,
          COUNT(*) FILTER (WHERE status NOT IN ('Closed_Resolved','Closed_Unresponsive')
            AND EXTRACT(EPOCH FROM (NOW() - created_at)) < 3600)::int                           AS age_lt_1h,
          COUNT(*) FILTER (WHERE status NOT IN ('Closed_Resolved','Closed_Unresponsive')
            AND EXTRACT(EPOCH FROM (NOW() - created_at)) BETWEEN 3600 AND 14400)::int           AS age_1h_4h,
          COUNT(*) FILTER (WHERE status NOT IN ('Closed_Resolved','Closed_Unresponsive')
            AND EXTRACT(EPOCH FROM (NOW() - created_at)) BETWEEN 14400 AND 86400)::int          AS age_4h_24h,
          COUNT(*) FILTER (WHERE status NOT IN ('Closed_Resolved','Closed_Unresponsive')
            AND EXTRACT(EPOCH FROM (NOW() - created_at)) > 86400)::int                          AS age_gt_24h,
          COUNT(*) FILTER (WHERE status NOT IN ('Closed_Resolved','Closed_Unresponsive')
            AND assigned_to IS NULL AND ai_persona IS NULL)::int                                AS unassigned,
          COUNT(*) FILTER (WHERE status = 'Pending_Customer')::int                             AS pending_customer,
          -- reopened: tickets currently open that were last updated significantly after creation
          -- (proxy until ticket_reopened audit events are emitted by tickets route)
          COUNT(*) FILTER (WHERE status IN ('Open_Live','In_Progress')
            AND EXTRACT(EPOCH FROM (updated_at - created_at)) > 300)::int                     AS reopened_30d,
          COUNT(*) FILTER (WHERE status = 'Closed_Resolved')::int                             AS closed_30d
        FROM tickets
        WHERE ${w}
      `),

      // [3] Peak hours heatmap — tickets by hour-of-day (0–23) × weekday (0=Sun … 6=Sat)
      q(`
        SELECT
          EXTRACT(DOW  FROM created_at)::int AS dow,
          EXTRACT(HOUR FROM created_at)::int AS hour,
          COUNT(*)::int AS count
        FROM tickets WHERE ${w}
        GROUP BY dow, hour ORDER BY dow, hour
      `),

      // [4] Low CSAT drill-down — tickets rated 1 or 2
      q(`
        SELECT
          t.id, t.csat_score, t.channel, t.category,
          t.created_at, t.updated_at,
          u.name AS agent_name,
          c.name AS customer_name
        FROM tickets t
        LEFT JOIN users u ON t.assigned_to = u.id
        LEFT JOIN customers c ON t.customer_id = c.id
        WHERE ${wt} AND t.csat_score IN (1, 2)
        ORDER BY t.csat_score ASC, t.updated_at DESC
        LIMIT 50
      `),

    ] : [null, null, null, null, null];

    const [summary, volume, frt, resolution, bot, csat, intent,
           agentLeaderboard, slaBreakdown, queueHealth, peakHours, lowCsat] =
      await Promise.all([...queries, ...supervisorQueries]);

    res.json({
      summary: {
        total_tickets:       summary.rows[0]?.total_tickets ?? 0,
        resolved:            summary.rows[0]?.resolved ?? 0,
        escalated:           summary.rows[0]?.escalated ?? 0,
        sla_breached:        summary.rows[0]?.sla_breached ?? 0,
        resolution_rate:     Number(summary.rows[0]?.resolution_rate ?? 0),
        avg_frt_s:           summary.rows[0]?.avg_frt_s ?? null,
        avg_aht_s:           summary.rows[0]?.avg_aht_s ?? null,
        csat_avg:            summary.rows[0]?.csat_avg ?? null,
        bot_resolution_rate: Number(summary.rows[0]?.bot_resolution_rate ?? 0),
      },
      volume: {
        total:       volume.rows[0]?.total ?? 0,
        by_day:      volume.rows[0]?.by_day ?? [],
        by_channel:  volume.rows[0]?.by_channel ?? [],
        by_category: volume.rows[0]?.by_category ?? [],
      },
      response_time: {
        avg_s:     frt.rows[0]?.avg_s    ?? null,
        median_s:  frt.rows[0]?.median_s ?? null,
        p90_s:     frt.rows[0]?.p90_s    ?? null,
        over_time: frt.rows[0]?.over_time ?? [],
      },
      resolution: {
        avg_s:      resolution.rows[0]?.avg_s      ?? null,
        by_channel: resolution.rows[0]?.by_channel ?? [],
        over_time:  resolution.rows[0]?.over_time  ?? [],
      },
      bot: {
        resolution_rate: Number(bot.rows[0]?.resolution_rate ?? 0),
        handoff_rate:    Number(bot.rows[0]?.handoff_rate    ?? 0),
        bot_total:       bot.rows[0]?.bot_total   ?? 0,
        human_total:     bot.rows[0]?.human_total ?? 0,
        by_day:          bot.rows[0]?.by_day  ?? [],
        by_bot:          bot.rows[0]?.by_bot  ?? [],
      },
      csat: {
        avg:          csat.rows[0]?.avg          ?? null,
        count:        csat.rows[0]?.count        ?? 0,
        distribution: csat.rows[0]?.distribution ?? [],
        by_channel:   csat.rows[0]?.by_channel   ?? [],
      },
      intent: {
        top: intent.rows,
      },
      // Supervisor-only sections (null when caller lacks section.metrics)
      agent_leaderboard: canSeeAgentBreakdown ? (agentLeaderboard?.rows ?? []) : null,
      sla_breakdown: canSeeAgentBreakdown ? {
        by_agent:    slaBreakdown?.rows[0]?.by_agent    ?? [],
        by_category: slaBreakdown?.rows[0]?.by_category ?? [],
      } : null,
      queue_health: canSeeAgentBreakdown ? {
        open_total:       queueHealth?.rows[0]?.open_total       ?? 0,
        age_lt_1h:        queueHealth?.rows[0]?.age_lt_1h        ?? 0,
        age_1h_4h:        queueHealth?.rows[0]?.age_1h_4h        ?? 0,
        age_4h_24h:       queueHealth?.rows[0]?.age_4h_24h       ?? 0,
        age_gt_24h:       queueHealth?.rows[0]?.age_gt_24h       ?? 0,
        unassigned:       queueHealth?.rows[0]?.unassigned        ?? 0,
        pending_customer: queueHealth?.rows[0]?.pending_customer  ?? 0,
        reopened_30d:     queueHealth?.rows[0]?.reopened_30d      ?? 0,
        closed_30d:       queueHealth?.rows[0]?.closed_30d        ?? 0,
      } : null,
      peak_hours:    canSeeAgentBreakdown ? (peakHours?.rows ?? []) : null,
      low_csat:      canSeeAgentBreakdown ? (lowCsat?.rows  ?? []) : null,
    });
  } catch (err) {
    console.error('[insights] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
