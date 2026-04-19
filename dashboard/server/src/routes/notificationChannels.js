// /api/admin/notification-channels — configure daily/weekly report delivery
const router = require('express').Router();
const pool   = require('../db/pg');
const { authenticate, requirePermission } = require('../middleware/auth');

const VALID_CHANNELS = new Set(['slack', 'teams', 'discord', 'line', 'email', 'notion', 'confluence']);

router.use(authenticate, requirePermission('admin.settings'));

// ── GET /api/admin/notification-channels ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT channel, enabled, config, reports, updated_by, updated_at
       FROM notification_channel_configs`
    );
    // Return all 7 channels with defaults for unconfigured ones
    const map = {};
    for (const ch of VALID_CHANNELS) {
      map[ch] = { channel: ch, enabled: false, config: {}, reports: { daily: true, weekly: true }, updated_at: null };
    }
    for (const r of rows) {
      map[r.channel] = {
        channel:    r.channel,
        enabled:    r.enabled,
        config:     r.config,
        reports:    r.reports,
        updated_at: r.updated_at,
      };
    }
    res.json(Object.values(map));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/admin/notification-channels/:channel ────────────────────────────
router.put('/:channel', async (req, res) => {
  const { channel } = req.params;
  if (!VALID_CHANNELS.has(channel)) return res.status(400).json({ error: `Unknown channel: ${channel}` });

  const { enabled, config, reports } = req.body;
  if (enabled === undefined || !config || !reports) {
    return res.status(400).json({ error: 'enabled, config, and reports are required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO notification_channel_configs (channel, enabled, config, reports, updated_by, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, NOW())
       ON CONFLICT (channel) DO UPDATE SET
         enabled    = EXCLUDED.enabled,
         config     = EXCLUDED.config,
         reports    = EXCLUDED.reports,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING channel, enabled, config, reports, updated_by, updated_at`,
      [channel, enabled, JSON.stringify(config), JSON.stringify(reports), req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/notification-channels/:channel/test ──────────────────────
// Proxies to Python FastAPI which has access to the report engine
const PYTHON_API = process.env.PYTHON_API_URL || 'http://localhost:8000';

router.post('/:channel/test', async (req, res) => {
  const { channel } = req.params;
  if (!VALID_CHANNELS.has(channel)) return res.status(400).json({ error: `Unknown channel: ${channel}` });

  try {
    const response = await fetch(`${PYTHON_API}/api/admin/notification-channels/${channel}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
