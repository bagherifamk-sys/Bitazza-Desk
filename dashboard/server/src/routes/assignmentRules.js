// /api/assignment-rules — read and update routing configuration
const router = require('express').Router();
const pool   = require('../db/pg');
const { authenticate, requirePermission } = require('../middleware/auth');
const { bustRulesCache } = require('./tickets');

router.use(authenticate, requirePermission('admin.settings'));

// ── GET /api/assignment-rules ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value, updated_at, updated_by FROM assignment_rules ORDER BY key`
    );
    // Return as a flat object: { category_team_map: {...}, sticky_agent_hours: 12, ... }
    const result = {};
    for (const r of rows) result[r.key] = { value: r.value, updated_at: r.updated_at, updated_by: r.updated_by };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/assignment-rules/:key ─────────────────────────────────────────
const ALLOWED_KEYS = new Set(['category_team_map', 'sticky_agent_hours', 'vip_auto_priority1', 'sla_minutes']);

router.patch('/:key', async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'Unknown rule key' });

  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'value is required' });

  try {
    const { rows } = await pool.query(
      `UPDATE assignment_rules
       SET value = $1::jsonb, updated_at = NOW(), updated_by = $2
       WHERE key = $3
       RETURNING key, value, updated_at, updated_by`,
      [JSON.stringify(value), req.user.id, key]
    );
    if (!rows.length) return res.status(404).json({ error: 'Rule not found' });

    await pool.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, metadata)
       VALUES ($1, 'assignment_rule_updated', 'assignment_rule', $2)`,
      [req.user.id, JSON.stringify({ key, value })]
    );

    bustRulesCache();
    res.json({ key: rows[0].key, value: rows[0].value, updated_at: rows[0].updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
