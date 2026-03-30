// /api/studio/flows — AI Studio flow CRUD + publish (FR-15, FR-16)
const router = require('express').Router();
const pool   = require('../db/pg');
const { authenticate, requirePermission } = require('../middleware/auth');
const { client: redis, ensureConnected, keys } = require('../lib/redis');
const { v4: uuidv4 } = require('uuid');

router.use(authenticate, requirePermission('section.studio'));

// ── GET /api/studio/flows ─────────────────────────────────────────────────────
router.get('/flows', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, published, published_at, created_at, updated_at,
              u.name AS created_by_name
       FROM ai_studio_flows f
       LEFT JOIN users u ON f.created_by = u.id
       ORDER BY f.updated_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/studio/flows (create draft) ─────────────────────────────────────
router.post('/flows', async (req, res) => {
  const { name = 'Untitled Flow', flow_json = {} } = req.body;
  const id = uuidv4();
  try {
    await pool.query(
      `INSERT INTO ai_studio_flows (id, name, flow_json, created_by) VALUES ($1,$2,$3,$4)`,
      [id, name, JSON.stringify(flow_json), req.user.id]
    );
    // Audit log
    await pool.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id) VALUES ($1,'studio:create','flow',$2)`,
      [req.user.id, id]
    );
    res.status(201).json({ id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/studio/flows/:id (save draft) ─────────────────────────────────
router.patch('/flows/:id', async (req, res) => {
  const { name, flow_json } = req.body;
  try {
    await pool.query(
      `UPDATE ai_studio_flows
       SET name=COALESCE($1,name), flow_json=COALESCE($2,flow_json), updated_at=NOW()
       WHERE id=$3`,
      [name ?? null, flow_json ? JSON.stringify(flow_json) : null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/studio/flows/:id/publish (FR-16) ───────────────────────────────
router.post('/flows/:id/publish', requirePermission('studio.publish'), async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query('SELECT flow_json FROM ai_studio_flows WHERE id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Flow not found' });

    const flow = rows[0].flow_json;
    const nodes = flow.nodes ?? [];
    const edges = flow.edges ?? [];

    // ── Validation (FR-16) ────────────────────────────────────────────────────
    const errors = [];
    const broken_node_ids = [];

    const connectedTargets = new Set(edges.map(e => e.target));
    const connectedSources = new Set(edges.map(e => e.source));
    const hasHandoff = nodes.some(n => n.data?.kind === 'handoff');

    if (!hasHandoff) {
      errors.push('Flow must contain at least one Handoff node.');
    }

    for (const node of nodes) {
      const k = node.data?.kind;
      if (!connectedTargets.has(node.id) && node.id !== 'start') {
        errors.push(`"${node.data?.label || k}" has no incoming connection.`);
        broken_node_ids.push(node.id);
      }
      if (k !== 'handoff' && !connectedSources.has(node.id)) {
        errors.push(`"${node.data?.label || k}" is a dead end. Connect to proceed.`);
        broken_node_ids.push(node.id);
      }
      if (k === 'condition') {
        const out = edges.filter(e => e.source === node.id);
        if (!out.some(e => e.sourceHandle === 'true') || !out.some(e => e.sourceHandle === 'false')) {
          errors.push(`"${node.data?.label || 'Condition'}" needs both True and False branches.`);
          broken_node_ids.push(node.id);
        }
      }
    }

    if (errors.length) {
      return res.status(400).json({ error: errors[0], errors, broken_node_ids });
    }

    // ── Atomic publish: PG + Redis ────────────────────────────────────────────
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE ai_studio_flows
         SET published=true, published_at=NOW(), published_by=$1, updated_at=NOW()
         WHERE id=$2`,
        [req.user.id, id]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Flush to Redis
    try {
      await ensureConnected();
      await redis.set(keys.botFlowActive(), JSON.stringify(flow));
    } catch (e) {
      console.warn('[studio] Redis flush failed (non-blocking):', e.message);
    }

    // Audit log
    await pool.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id) VALUES ($1,'studio:publish','flow',$2)`,
      [req.user.id, id]
    );

    res.json({ ok: true, message: 'Flow published successfully.' });
  } catch (err) {
    console.error('[studio] publish error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
