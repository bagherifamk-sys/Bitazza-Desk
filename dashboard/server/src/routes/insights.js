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
          COUNT(*) FILTER (WHERE t.status IN ('Closed_Resolved','Closed_Unresponsive'))::int AS resolved,
          COUNT(*) FILTER (WHERE t.status = 'Escalated')::int AS escalated,
          COUNT(*) FILTER (WHERE t.sla_breached = true)::int AS sla_breached,
          (COUNT(*) FILTER (WHERE t.status IN ('Closed_Resolved','Closed_Unresponsive')))::float
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
            CASE WHEN t.status IN ('Closed_Resolved','Closed_Unresponsive')
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
            AND t.status IN ('Closed_Resolved','Closed_Unresponsive')
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
      q(`
        WITH daily AS (
          SELECT DATE(t.created_at) AS day,
            COUNT(*) FILTER (WHERE t.channel = 'web')  AS bot,
            COUNT(*) FILTER (WHERE t.channel != 'web') AS human
          FROM tickets t WHERE ${wt} GROUP BY DATE(t.created_at)
        )
        SELECT
          (SELECT COUNT(*)::float FROM tickets t WHERE ${wt} AND t.channel = 'web' AND t.status = 'Closed_Resolved')
            / NULLIF((SELECT COUNT(*) FROM tickets t WHERE ${wt} AND t.channel = 'web'), 0) AS resolution_rate,
          (SELECT COUNT(*)::float FROM tickets t WHERE ${wt} AND t.status = 'Escalated')
            / NULLIF((SELECT COUNT(*) FROM tickets t WHERE ${wt}), 0) AS handoff_rate,
          (SELECT json_agg(json_build_object('date', day, 'bot', bot, 'human', human) ORDER BY day) FROM daily) AS by_day
      `),

      // ── CSAT ──────────────────────────────────────────────────────────────
      q(`
        WITH base AS (SELECT csat_score, channel FROM tickets WHERE ${w}),
        by_chan AS (
          SELECT channel, ROUND(AVG(csat_score)::numeric,2) AS avg_score
          FROM base WHERE csat_score IS NOT NULL GROUP BY channel
        )
        SELECT
          AVG(csat_score)::float AS avg,
          COUNT(csat_score)::int AS count,
          (SELECT json_agg(json_build_object('score', gs, 'count', cnt) ORDER BY gs)
           FROM (SELECT gs, COUNT(t2.id)::int AS cnt
                 FROM generate_series(1,5) gs
                 LEFT JOIN tickets t2 ON t2.csat_score = gs AND t2.created_at > NOW() - INTERVAL '30 days'
                 GROUP BY gs) d) AS distribution,
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

    // Agent breakdown — only run when caller has section.metrics
    const agentQueries = canSeeAgentBreakdown ? [
      q(`
        SELECT u.name,
          AVG(EXTRACT(EPOCH FROM (
            (SELECT m.created_at FROM messages m
             WHERE m.ticket_id = t.id AND m.sender_type IN ('agent','bot')
             ORDER BY m.created_at ASC LIMIT 1)
            - t.created_at
          )))::float AS avg_s
        FROM tickets t JOIN users u ON t.assigned_to = u.id
        WHERE ${wt}
          AND EXISTS (SELECT 1 FROM messages m WHERE m.ticket_id = t.id AND m.sender_type IN ('agent','bot'))
        GROUP BY u.name ORDER BY avg_s ASC LIMIT 10
      `),
      q(`
        SELECT t.channel,
          AVG(EXTRACT(EPOCH FROM (t.updated_at - t.created_at)))::float AS avg_s
        FROM tickets t WHERE ${wt}
          AND t.status IN ('Closed_Resolved','Closed_Unresponsive')
          AND EXISTS (SELECT 1 FROM messages m WHERE m.ticket_id = t.id AND m.sender_type IN ('agent','bot'))
        GROUP BY t.channel ORDER BY t.channel
      `),
      q(`
        SELECT u.name,
          AVG(t.csat_score)::float AS avg,
          COUNT(*) FILTER (WHERE t.csat_score IS NOT NULL)::int AS count
        FROM tickets t JOIN users u ON t.assigned_to = u.id
        WHERE ${wt} AND t.csat_score IS NOT NULL
        GROUP BY u.name ORDER BY avg DESC LIMIT 10
      `),
    ] : [null, null, null];

    const [summary, volume, frt, resolution, bot, csat, intent,
           frtByAgent, ahtByChannel, csatByAgent] =
      await Promise.all([...queries, ...agentQueries]);

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
        by_day:          bot.rows[0]?.by_day ?? [],
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
      agent_breakdown: canSeeAgentBreakdown ? {
        frt_by_agent:   frtByAgent?.rows   ?? [],
        aht_by_channel: ahtByChannel?.rows ?? [],
        csat_by_agent:  csatByAgent?.rows  ?? [],
      } : null,
    });
  } catch (err) {
    console.error('[insights] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
