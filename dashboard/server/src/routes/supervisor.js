// /api/supervisor/live — real-time supervisor stats
const router = require('express').Router();
const pool   = require('../db/pg');
const { authenticate, requirePermission } = require('../middleware/auth');
const { getQueueDepth } = require('../lib/redis');

router.use(authenticate, requirePermission('section.supervisor'));

router.get('/live', async (req, res) => {
  try {
    const [agents, queues, slaRisk, stats] = await Promise.all([
      // Agent grid
      pool.query(`
        SELECT id, name, state, active_chats, max_chats, skills, shift
        FROM users WHERE role IN ('agent','kyc_agent','finance_agent')
        ORDER BY name
      `),
      // Queue depth by channel × priority
      pool.query(`
        SELECT channel, priority, COUNT(*) AS count
        FROM tickets
        WHERE status IN ('Open_Live','In_Progress') AND assigned_to IS NULL
        GROUP BY channel, priority
        ORDER BY priority ASC, channel ASC
      `),
      // SLA at-risk (< 1h remaining)
      pool.query(`
        SELECT t.id, t.priority, t.sla_deadline, t.sla_breached,
               c.name AS customer_name, c.tier,
               u.name AS assigned_to_name
        FROM tickets t
        LEFT JOIN customers c ON t.customer_id = c.id
        LEFT JOIN users u ON t.assigned_to = u.id
        WHERE t.status NOT IN ('Closed_Resolved','Closed_Unresponsive')
          AND t.sla_deadline < NOW() + INTERVAL '1 hour'
        ORDER BY t.sla_deadline ASC
        LIMIT 20
      `),
      // Today's stats
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day') AS opened_today,
          COUNT(*) FILTER (WHERE status IN ('Closed_Resolved','Closed_Unresponsive') AND updated_at > NOW() - INTERVAL '1 day') AS resolved_today,
          AVG(EXTRACT(EPOCH FROM (
            (SELECT created_at FROM messages WHERE ticket_id=t.id AND sender_type IN ('agent','bot') ORDER BY created_at ASC LIMIT 1)
            - t.created_at
          ))) AS avg_first_response_s,
          COUNT(*) FILTER (WHERE channel = 'web' AND status IN ('Open_Live','In_Progress')) AS bot_active
        FROM tickets t
        WHERE t.created_at > NOW() - INTERVAL '7 days'
      `),
    ]);

    const csQueueDepth = await getQueueDepth('cs').catch(() => 0);

    res.json({
      agents: agents.rows,
      queues: queues.rows,
      sla_risk: slaRisk.rows,
      stats: {
        ...stats.rows[0],
        queue_depth: csQueueDepth,
      },
    });
  } catch (err) {
    console.error('[supervisor] live error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
