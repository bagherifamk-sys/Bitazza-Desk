// GET /api/metrics?range=7d&agent_id=&channel=&from=&to=
// FR-17: FRT | AHT | CSAT — supervisor + super_admin only
const router = require('express').Router();
const pool   = require('../db/pg');
const { authenticate, requirePermission } = require('../middleware/auth');

router.use(authenticate, requirePermission('section.metrics'));

// Allowed enum values for whitelist validation
const VALID_CHANNELS = ['web', 'line', 'facebook', 'email'];
const VALID_RANGES   = ['7d', '30d', 'custom'];

// Returns { sql, params } — safe parameterized date clause
function dateClause(range, from, to, alias = 't') {
  switch (range) {
    case '30d':   return { sql: `${alias}.created_at >= NOW() - INTERVAL '30 days'`, params: [] };
    case 'custom':
      if (from && to) return { sql: `${alias}.created_at BETWEEN $1 AND $2`, params: [from, to] };
      return { sql: `${alias}.created_at >= NOW() - INTERVAL '30 days'`, params: [] };
    default:      return { sql: `${alias}.created_at >= NOW() - INTERVAL '7 days'`,  params: [] };
  }
}

router.get('/', async (req, res) => {
  const { from, to } = req.query;

  // Whitelist-validate optional filters
  const range    = VALID_RANGES.includes(req.query.range) ? req.query.range : '7d';
  const channel  = VALID_CHANNELS.includes(req.query.channel)  ? req.query.channel  : null;
  const agent_id = /^[0-9a-f-]{36}$/i.test(req.query.agent_id ?? '') ? req.query.agent_id : null;

  const { sql: baseSql, params: baseParams } = dateClause(range, from, to, 't');

  // Build extra clauses with parameterized values
  const extraClauses = [];
  const extraParams  = [];
  let p = baseParams.length + 1;

  if (agent_id) { extraClauses.push(`t.assigned_to = $${p++}`); extraParams.push(agent_id); }
  if (channel)  { extraClauses.push(`t.channel = $${p++}`);     extraParams.push(channel); }

  const allParams  = [...baseParams, ...extraParams];
  const extraWhere = extraClauses.length ? 'AND ' + extraClauses.join(' AND ') : '';
  const baseWhere  = `${baseSql} ${extraWhere}`;

  const q = (sql) => pool.query(sql, allParams);

  try {
    const [frtRows, frtAgent, frtTime, ahtRows, ahtChan, ahtTime, csatRows, csatDist, csatAgent, summary] =
      await Promise.all([

        // ── FRT avg ───────────────────────────────────────────────────────────
        q(`
          SELECT AVG(EXTRACT(EPOCH FROM (
            (SELECT m.created_at FROM messages m
             WHERE m.ticket_id = t.id AND m.sender_type = 'agent'
             ORDER BY m.created_at ASC LIMIT 1)
            - t.created_at
          )))::float AS avg_s
          FROM tickets t
          WHERE ${baseWhere}
            AND EXISTS (SELECT 1 FROM messages m WHERE m.ticket_id = t.id AND m.sender_type = 'agent')
        `),

        // ── FRT by agent ──────────────────────────────────────────────────────
        q(`
          SELECT u.name,
            AVG(EXTRACT(EPOCH FROM (
              (SELECT m.created_at FROM messages m
               WHERE m.ticket_id = t.id AND m.sender_type = 'agent'
               ORDER BY m.created_at ASC LIMIT 1)
              - t.created_at
            )))::float AS avg_s
          FROM tickets t
          JOIN users u ON t.assigned_to = u.id
          WHERE ${baseWhere}
            AND EXISTS (SELECT 1 FROM messages m WHERE m.ticket_id = t.id AND m.sender_type = 'agent')
          GROUP BY u.name
          ORDER BY avg_s ASC
          LIMIT 10
        `),

        // ── FRT over time ─────────────────────────────────────────────────────
        q(`
          SELECT DATE(t.created_at) AS date,
            AVG(EXTRACT(EPOCH FROM (
              (SELECT m.created_at FROM messages m
               WHERE m.ticket_id = t.id AND m.sender_type = 'agent'
               ORDER BY m.created_at ASC LIMIT 1)
              - t.created_at
            )))::float AS avg_s
          FROM tickets t
          WHERE ${baseWhere}
            AND EXISTS (SELECT 1 FROM messages m WHERE m.ticket_id = t.id AND m.sender_type = 'agent')
          GROUP BY DATE(t.created_at)
          ORDER BY date ASC
        `),

        // ── AHT avg (Open_Live → Closed_*) ───────────────────────────────────
        q(`
          SELECT AVG(EXTRACT(EPOCH FROM (t.updated_at - t.created_at)))::float AS avg_s
          FROM tickets t
          WHERE ${baseWhere}
            AND t.status IN ('Closed_Resolved','Closed_Unresponsive')
        `),

        // ── AHT by channel ────────────────────────────────────────────────────
        q(`
          SELECT t.channel,
            AVG(EXTRACT(EPOCH FROM (t.updated_at - t.created_at)))::float AS avg_s
          FROM tickets t
          WHERE ${baseWhere}
            AND t.status IN ('Closed_Resolved','Closed_Unresponsive')
          GROUP BY t.channel
          ORDER BY t.channel
        `),

        // ── AHT over time ─────────────────────────────────────────────────────
        q(`
          SELECT DATE(t.created_at) AS date,
            AVG(EXTRACT(EPOCH FROM (t.updated_at - t.created_at)))::float AS avg_s
          FROM tickets t
          WHERE ${baseWhere}
            AND t.status IN ('Closed_Resolved','Closed_Unresponsive')
          GROUP BY DATE(t.created_at)
          ORDER BY date ASC
        `),

        // ── CSAT avg ──────────────────────────────────────────────────────────
        q(`
          SELECT AVG(t.csat_score)::float AS avg,
                 COUNT(*) FILTER (WHERE t.csat_score IS NOT NULL)::int AS count
          FROM tickets t
          WHERE ${baseWhere}
        `),

        // ── CSAT distribution ─────────────────────────────────────────────────
        // NOTE: distribution always covers all time to show full range; not filtered
        pool.query(`
          SELECT gs AS score, COUNT(t.id)::int AS count
          FROM generate_series(1,5) gs
          LEFT JOIN tickets t ON t.csat_score = gs
          GROUP BY gs
          ORDER BY gs
        `),

        // ── CSAT by agent ─────────────────────────────────────────────────────
        q(`
          SELECT u.name,
            AVG(t.csat_score)::float AS avg,
            COUNT(*) FILTER (WHERE t.csat_score IS NOT NULL)::int AS count
          FROM tickets t
          JOIN users u ON t.assigned_to = u.id
          WHERE ${baseWhere}
            AND t.csat_score IS NOT NULL
          GROUP BY u.name
          ORDER BY avg DESC
          LIMIT 10
        `),

        // ── Summary KPIs ──────────────────────────────────────────────────────
        q(`
          SELECT
            COUNT(*)::int AS total_tickets,
            COUNT(*) FILTER (WHERE t.status IN ('Closed_Resolved','Closed_Unresponsive'))::int AS resolved,
            COUNT(*) FILTER (WHERE t.status = 'Escalated')::int AS escalated,
            COUNT(*) FILTER (WHERE t.sla_breached = true)::int AS sla_breached,
            COUNT(*) FILTER (WHERE t.status IN ('Closed_Resolved','Closed_Unresponsive'))::float
              / NULLIF(COUNT(*), 0) AS resolution_rate
          FROM tickets t
          WHERE ${baseWhere}
        `),
      ]);

    res.json({
      frt: {
        avg_s:     frtRows.rows[0]?.avg_s ?? 0,
        by_agent:  frtAgent.rows,
        over_time: frtTime.rows,
      },
      aht: {
        avg_s:      ahtRows.rows[0]?.avg_s ?? 0,
        by_channel: ahtChan.rows,
        over_time:  ahtTime.rows,
      },
      csat: {
        avg:          csatRows.rows[0]?.avg ?? null,
        count:        csatRows.rows[0]?.count ?? 0,
        distribution: csatDist.rows,
        by_agent:     csatAgent.rows,
      },
      summary: summary.rows[0] ?? {},
    });
  } catch (err) {
    console.error('[metrics] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
