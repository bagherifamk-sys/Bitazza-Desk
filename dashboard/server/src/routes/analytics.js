// GET /api/analytics?date_range=7d&channel=&agent_id=&category=
const router = require('express').Router();
const pool   = require('../db/pg');
const { authenticate, requirePermission } = require('../middleware/auth');

router.use(authenticate, requirePermission('section.analytics'));

const VALID_CHANNELS = ['web', 'line', 'facebook', 'email'];
const VALID_RANGES   = ['today', '7d', '30d', 'custom'];

// Returns a WHERE fragment (no alias) + params array
function dateFilter(date_range, date_from, date_to) {
  switch (date_range) {
    case 'today':  return { sql: `created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok'`, params: [] };
    case '30d':    return { sql: `created_at >= NOW() - INTERVAL '30 days'`, params: [] };
    case 'custom':
      if (date_from && date_to)
        return { sql: `created_at BETWEEN $1 AND $2`, params: [date_from, date_to] };
      return { sql: `created_at >= NOW() - INTERVAL '30 days'`, params: [] };
    default:       return { sql: `created_at >= NOW() - INTERVAL '7 days'`,  params: [] };
  }
}

router.get('/', async (req, res) => {
  const { date_range = '7d', date_from, date_to } = req.query;

  const channel  = VALID_CHANNELS.includes(req.query.channel)  ? req.query.channel  : null;
  const agent_id = /^[0-9a-f-]{36}$/i.test(req.query.agent_id ?? '') ? req.query.agent_id : null;
  const category = typeof req.query.category === 'string' && /^[\w_]+$/.test(req.query.category) ? req.query.category : null;
  const range    = VALID_RANGES.includes(date_range) ? date_range : '7d';

  const { sql: dateSql, params: baseParams } = dateFilter(range, date_from, date_to);

  // Build extra WHERE clauses (no alias — used in plain FROM tickets sub-queries)
  const extraClauses = [];
  const extraParams  = [];
  let p = baseParams.length + 1;

  if (channel)  { extraClauses.push(`channel = $${p++}`);      extraParams.push(channel); }
  if (agent_id) { extraClauses.push(`assigned_to = $${p++}`);  extraParams.push(agent_id); }
  if (category) { extraClauses.push(`category = $${p++}`);     extraParams.push(category); }

  const allParams  = [...baseParams, ...extraParams];
  const extraWhere = extraClauses.length ? 'AND ' + extraClauses.join(' AND ') : '';

  // w  = bare WHERE fragment (no alias) — for sub-queries using FROM tickets
  // wt = aliased WHERE fragment — for queries using FROM tickets t
  const w  = `${dateSql} ${extraWhere}`;
  const wt = w.replace(/\bcreated_at\b/g, 't.created_at')
               .replace(/\bchannel\b/g, 't.channel')
               .replace(/\bassigned_to\b/g, 't.assigned_to')
               .replace(/\bcategory\b/g, 't.category');

  const q = (sql) => pool.query(sql, allParams);

  try {
    const [volume, responseTime, resolution, bot, csat, intent] = await Promise.all([

      // ── Volume ───────────────────────────────────────────────────────────────
      q(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'Closed_Resolved')::int AS resolved,
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
        FROM tickets
        WHERE ${w}
      `),

      // ── Response time (FRT) ──────────────────────────────────────────────────
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
          FROM tickets t
          WHERE ${wt}
            AND EXISTS (
              SELECT 1 FROM messages m WHERE m.ticket_id = t.id AND m.sender_type IN ('agent','bot')
            )
        ),
        by_day AS (
          SELECT day, ROUND(AVG(seconds)::numeric, 1) AS avg_s
          FROM frt GROUP BY day
        )
        SELECT
          AVG(seconds)::float AS avg_s,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY seconds)::float AS median_s,
          PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY seconds)::float AS p90_s,
          (SELECT json_agg(json_build_object('date', day, 'avg_s', avg_s) ORDER BY day) FROM by_day) AS by_day
        FROM frt
      `),

      // ── Resolution time ──────────────────────────────────────────────────────
      q(`
        WITH res AS (
          SELECT t.id, t.channel,
            EXTRACT(EPOCH FROM (t.updated_at - t.created_at)) AS seconds
          FROM tickets t
          WHERE ${wt}
            AND t.status IN ('Closed_Resolved','Closed_Unresponsive')
        ),
        by_chan AS (
          SELECT channel, ROUND(AVG(seconds)::numeric, 1) AS avg_s
          FROM res GROUP BY channel
        )
        SELECT
          AVG(seconds)::float AS avg_s,
          (SELECT json_agg(json_build_object('channel', channel, 'avg_s', avg_s) ORDER BY channel) FROM by_chan) AS by_channel
        FROM res
      `),

      // ── Bot performance ──────────────────────────────────────────────────────
      q(`
        WITH daily AS (
          SELECT
            DATE(t.created_at) AS day,
            COUNT(*) FILTER (WHERE t.channel = 'web')  AS bot,
            COUNT(*) FILTER (WHERE t.channel != 'web') AS human
          FROM tickets t
          WHERE ${wt}
          GROUP BY DATE(t.created_at)
        )
        SELECT
          (SELECT COUNT(*)::float FROM tickets t WHERE ${wt} AND t.channel = 'web' AND t.status = 'Closed_Resolved')
            / NULLIF((SELECT COUNT(*) FROM tickets t WHERE ${wt} AND t.channel = 'web'), 0) AS resolution_rate,
          (SELECT COUNT(*)::float FROM tickets t WHERE ${wt} AND t.status = 'Escalated')
            / NULLIF((SELECT COUNT(*) FROM tickets t WHERE ${wt}), 0) AS handoff_rate,
          (SELECT json_agg(json_build_object('date', day, 'bot', bot, 'human', human) ORDER BY day) FROM daily) AS by_day
      `),

      // ── CSAT ─────────────────────────────────────────────────────────────────
      q(`
        WITH base AS (
          SELECT csat_score, channel FROM tickets WHERE ${w}
        ),
        by_chan AS (
          SELECT channel, ROUND(AVG(csat_score)::numeric, 2) AS avg_score
          FROM base WHERE csat_score IS NOT NULL GROUP BY channel
        )
        SELECT
          AVG(csat_score)::float AS avg,
          COUNT(csat_score)::int AS count,
          (SELECT json_agg(json_build_object('score', gs, 'count', cnt) ORDER BY gs)
           FROM (SELECT gs, COUNT(t2.id)::int AS cnt
                 FROM generate_series(1,5) gs
                 LEFT JOIN tickets t2 ON t2.csat_score = gs
                   AND t2.created_at > NOW() - INTERVAL '30 days'
                 GROUP BY gs) d) AS distribution,
          (SELECT json_agg(json_build_object('channel', channel, 'avg', avg_score)) FROM by_chan) AS by_channel
        FROM base
      `),

      // ── Intent / category distribution ───────────────────────────────────────
      q(`
        SELECT category,
          COUNT(*)::int AS count,
          COUNT(*)::float / NULLIF(SUM(COUNT(*)) OVER(), 0) AS pct
        FROM tickets
        WHERE ${w} AND category IS NOT NULL
        GROUP BY category
        ORDER BY count DESC
        LIMIT 9
      `),
    ]);

    res.json({
      volume: {
        total:       volume.rows[0]?.total      ?? 0,
        resolved:    volume.rows[0]?.resolved    ?? 0,
        by_day:      volume.rows[0]?.by_day      ?? [],
        by_channel:  volume.rows[0]?.by_channel  ?? [],
        by_category: volume.rows[0]?.by_category ?? [],
      },
      response_time: {
        avg_s:    responseTime.rows[0]?.avg_s    ?? null,
        median_s: responseTime.rows[0]?.median_s ?? null,
        p90_s:    responseTime.rows[0]?.p90_s    ?? null,
        by_day:   responseTime.rows[0]?.by_day   ?? [],
      },
      resolution: {
        avg_s:      resolution.rows[0]?.avg_s      ?? null,
        by_channel: resolution.rows[0]?.by_channel ?? [],
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
    });
  } catch (err) {
    console.error('[analytics] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
