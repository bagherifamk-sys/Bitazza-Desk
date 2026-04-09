// /api/supervisor/live — real-time supervisor stats
const router = require('express').Router();
const pool   = require('../db/pg');
const { authenticate, requirePermission } = require('../middleware/auth');
const { getQueueDepth } = require('../lib/redis');

router.use(authenticate, requirePermission('section.supervisor'));

router.get('/live', async (req, res) => {
  try {
    const [agents, queues, slaRisk, stats, channelHealth, pendingStale] = await Promise.all([
      // Agent grid — with last message activity and longest open ticket
      pool.query(`
        SELECT
          u.id, u.name, u.role, u.state, u.max_chats, u.skills, u.shift,
          (SELECT MAX(m.created_at) FROM messages m WHERE m.sender_id = u.id) AS last_activity_at,
          (SELECT EXTRACT(EPOCH FROM (NOW() - MIN(t2.created_at))) / 60
           FROM tickets t2
           WHERE t2.assigned_to = u.id
             AND t2.status NOT IN ('Closed_Resolved','Closed_Unresponsive')) AS longest_open_mins,
          (SELECT COUNT(*) FROM tickets t2
           WHERE t2.assigned_to = u.id
             AND t2.status NOT IN ('Closed_Resolved','Closed_Unresponsive')) AS open_ticket_count
        FROM users u
        WHERE u.active = true
        ORDER BY u.name
      `),
      // Queue depth by channel × priority — with oldest ticket timestamp
      pool.query(`
        SELECT channel, priority, COUNT(*) AS count, MIN(created_at) AS oldest_at
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
      // Today's stats — extended with resolution time, CSAT, yesterday delta, bot containment
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day') AS opened_today,
          COUNT(*) FILTER (WHERE status IN ('Closed_Resolved','Closed_Unresponsive') AND updated_at > NOW() - INTERVAL '1 day') AS resolved_today,
          AVG(EXTRACT(EPOCH FROM (
            (SELECT created_at FROM messages WHERE ticket_id=t.id AND sender_type IN ('agent','bot') ORDER BY created_at ASC LIMIT 1)
            - t.created_at
          ))) AS avg_first_response_s,
          COUNT(*) FILTER (WHERE channel = 'web' AND status IN ('Open_Live','In_Progress')) AS bot_active,
          AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) FILTER (WHERE status IN ('Closed_Resolved','Closed_Unresponsive') AND updated_at > NOW() - INTERVAL '1 day') AS avg_resolution_s,
          AVG(csat_score) FILTER (WHERE csat_score IS NOT NULL AND updated_at > NOW() - INTERVAL '7 days') AS csat_avg,
          COUNT(*) FILTER (WHERE status IN ('Closed_Resolved','Closed_Unresponsive') AND updated_at BETWEEN NOW() - INTERVAL '2 days' AND NOW() - INTERVAL '1 day') AS resolved_yesterday,
          COUNT(*) FILTER (WHERE channel='web' AND status IN ('Closed_Resolved','Closed_Unresponsive') AND updated_at > NOW() - INTERVAL '1 day' AND id NOT IN (SELECT DISTINCT ticket_id FROM messages WHERE sender_type IN ('agent') AND created_at > NOW() - INTERVAL '1 day')) AS bot_contained,
          COUNT(*) FILTER (WHERE channel='web' AND status IN ('Closed_Resolved','Closed_Unresponsive') AND updated_at > NOW() - INTERVAL '1 day') AS bot_total
        FROM tickets t
        WHERE t.created_at > NOW() - INTERVAL '7 days'
      `),
      // Channel health — open counts, queue, SLA metrics per channel
      pool.query(`
        SELECT channel,
          COUNT(*) FILTER (WHERE status IN ('Open_Live','In_Progress','Pending_Customer')) AS open_count,
          COUNT(*) FILTER (WHERE status IN ('Open_Live','In_Progress') AND assigned_to IS NULL) AS queued,
          MIN(created_at) FILTER (WHERE status IN ('Open_Live','In_Progress') AND assigned_to IS NULL) AS oldest_queued_at,
          COUNT(*) FILTER (WHERE sla_breached = true AND status NOT IN ('Closed_Resolved','Closed_Unresponsive')) AS sla_breached_count,
          ROUND(100.0 * COUNT(*) FILTER (WHERE sla_breached = false AND status IN ('Closed_Resolved','Closed_Unresponsive') AND updated_at > NOW() - INTERVAL '1 day') / NULLIF(COUNT(*) FILTER (WHERE status IN ('Closed_Resolved','Closed_Unresponsive') AND updated_at > NOW() - INTERVAL '1 day'), 0), 1) AS sla_met_pct
        FROM tickets
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY channel
        ORDER BY channel
      `),
      // Pending stale — waiting on customer > 2 hours
      pool.query(`
        SELECT t.id, t.last_customer_msg_at, t.nudge_sent_at, t.sla_deadline,
               c.name AS customer_name, c.tier,
               u.name AS assigned_to_name
        FROM tickets t
        LEFT JOIN customers c ON t.customer_id = c.id
        LEFT JOIN users u ON t.assigned_to = u.id
        WHERE t.status = 'Pending_Customer'
          AND (t.last_customer_msg_at < NOW() - INTERVAL '2 hours' OR t.last_customer_msg_at IS NULL)
        ORDER BY t.last_customer_msg_at ASC NULLS FIRST
        LIMIT 15
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
      channel_health: channelHealth.rows,
      pending_stale: pendingStale.rows,
    });
  } catch (err) {
    console.error('[supervisor] live error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Agent drill-down — active tickets for a specific agent
router.get('/agent/:id/tickets', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT t.id, t.status, t.priority, t.channel, t.sla_deadline, t.sla_breached,
             c.name AS customer_name, c.tier, t.created_at, t.updated_at,
             (SELECT content FROM messages WHERE ticket_id = t.id AND sender_type = 'customer'
              ORDER BY created_at DESC LIMIT 1) AS last_message
      FROM tickets t
      LEFT JOIN customers c ON t.customer_id = c.id
      WHERE t.assigned_to = $1 AND t.status NOT IN ('Closed_Resolved','Closed_Unresponsive')
      ORDER BY t.priority ASC, t.created_at ASC
    `, [id]);
    res.json(result.rows);
  } catch (err) {
    console.error('[supervisor] agent tickets error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
