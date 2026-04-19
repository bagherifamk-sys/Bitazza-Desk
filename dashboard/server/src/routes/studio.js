// /api/studio/flows — Workflow engine CRUD + publish + test-run
const router = require('express').Router();
const pool   = require('../db/pg');
const { authenticate, requirePermission } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const http   = require('http');

router.use(authenticate, requirePermission('section.studio'));

// Forward test-run requests to the Python FastAPI engine
const PYTHON_API = process.env.PYTHON_API_URL || 'http://127.0.0.1:8000';

function proxyPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url  = new URL(PYTHON_API);
    const opts = {
      hostname: url.hostname,
      port:     url.port || 80,
      path,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── GET /api/studio/flows ─────────────────────────────────────────────────────
router.get('/flows', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.id, w.name, w.trigger_channel, w.trigger_category,
              w.published, w.published_at, w.created_at, w.updated_at,
              u.name AS created_by_name
       FROM workflows w
       LEFT JOIN users u ON w.created_by = u.id
       ORDER BY w.updated_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/studio/flows/:id ─────────────────────────────────────────────────
router.get('/flows/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM workflows WHERE id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Workflow not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/studio/flows (create draft) ─────────────────────────────────────
router.post('/flows', async (req, res) => {
  const {
    name            = 'Untitled Workflow',
    trigger_channel = 'widget',
    trigger_category= 'any',
    nodes_json      = [],
    edges_json      = [],
  } = req.body;
  const id = uuidv4();
  try {
    await pool.query(
      `INSERT INTO workflows
         (id, name, trigger_channel, trigger_category, nodes_json, edges_json, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, name, trigger_channel, trigger_category,
       JSON.stringify(nodes_json), JSON.stringify(edges_json), req.user.id]
    );
    await pool.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
       VALUES ($1,'studio:create','workflow',$2)`,
      [req.user.id, id]
    );
    res.status(201).json({ id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/studio/flows/:id (save draft) ──────────────────────────────────
router.patch('/flows/:id', async (req, res) => {
  const { name, trigger_channel, trigger_category, nodes_json, edges_json } = req.body;
  try {
    await pool.query(
      `UPDATE workflows SET
         name             = COALESCE($1, name),
         trigger_channel  = COALESCE($2, trigger_channel),
         trigger_category = COALESCE($3, trigger_category),
         nodes_json       = COALESCE($4, nodes_json),
         edges_json       = COALESCE($5, edges_json),
         updated_at       = NOW()
       WHERE id = $6`,
      [
        name             ?? null,
        trigger_channel  ?? null,
        trigger_category ?? null,
        nodes_json       ? JSON.stringify(nodes_json) : null,
        edges_json       ? JSON.stringify(edges_json) : null,
        req.params.id,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/studio/flows/:id ──────────────────────────────────────────────
router.delete('/flows/:id', requirePermission('studio.publish'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM workflows WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/studio/flows/:id/publish ────────────────────────────────────────
router.post('/flows/:id/publish', requirePermission('studio.publish'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`SELECT * FROM workflows WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Workflow not found' });

    const { nodes_json, edges_json } = rows[0];
    const nodes = (typeof nodes_json === 'string' ? JSON.parse(nodes_json) : nodes_json) ?? [];
    const edges = (typeof edges_json === 'string' ? JSON.parse(edges_json) : edges_json) ?? [];

    // Validate: must have at least one node
    if (!nodes.length) {
      return res.status(400).json({ error: 'Workflow has no nodes.' });
    }

    // Validate: all non-terminal nodes must be connected
    const errors = [];
    const broken_node_ids = [];
    const connectedTargets = new Set(edges.map(e => e.target));
    const connectedSources = new Set(edges.map(e => e.source));
    const terminalKinds    = new Set(['escalate', 'resolve_ticket', 'wait_for_reply', 'wait_for_trigger']);

    for (const node of nodes) {
      const kind = node.kind || node.type;
      if (!connectedTargets.has(node.id) && nodes.indexOf(node) !== 0) {
        errors.push(`"${node.data?.label || kind}" has no incoming connection.`);
        broken_node_ids.push(node.id);
      }
      if (!terminalKinds.has(kind) && !connectedSources.has(node.id)) {
        errors.push(`"${node.data?.label || kind}" is a dead end — connect it to proceed.`);
        broken_node_ids.push(node.id);
      }
      if (kind === 'condition') {
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

    await pool.query(
      `UPDATE workflows
       SET published=true, published_at=NOW(), published_by=$1, updated_at=NOW()
       WHERE id=$2`,
      [req.user.id, id]
    );
    await pool.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
       VALUES ($1,'studio:publish','workflow',$2)`,
      [req.user.id, id]
    );

    // Check for trigger conflicts with other published workflows
    const { trigger_channel, trigger_category } = rows[0];
    const { rows: conflicts } = await pool.query(
      `SELECT name FROM workflows
       WHERE id != $1 AND published = true
         AND (trigger_channel = $2 OR trigger_channel = 'any' OR $2 = 'any')
         AND (trigger_category = $3 OR trigger_category = 'any' OR $3 = 'any')`,
      [id, trigger_channel, trigger_category]
    );
    const warnings = conflicts.length
      ? [`Trigger overlaps with live workflow: "${conflicts[0].name}". The first matching workflow will run.`]
      : [];

    res.json({ ok: true, message: 'Workflow published successfully.', warnings });
  } catch (err) {
    console.error('[studio] publish error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/studio/flows/:id/unpublish ──────────────────────────────────────
router.post('/flows/:id/unpublish', requirePermission('studio.publish'), async (req, res) => {
  try {
    await pool.query(
      `UPDATE workflows SET published=false, updated_at=NOW() WHERE id=$1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/studio/flows/:id/test-run ───────────────────────────────────────
// Proxies to Python FastAPI which runs the workflow in dry-run mode.
router.post('/flows/:id/test-run', async (req, res) => {
  const { id } = req.params;
  const {
    sample_message = 'Hello',
    channel = 'widget',
    category = 'other',
    language = 'en',
    user_id = 'test-user',
    extra_variables = {},
  } = req.body;

  try {
    const { rows } = await pool.query(`SELECT * FROM workflows WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Workflow not found' });

    const result = await proxyPost('/studio/test-run', {
      workflow: rows[0],
      sample_message,
      channel,
      category,
      language,
      user_id,
      extra_variables,
    });

    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[studio] test-run error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/studio/flows/:id/executions ─────────────────────────────────────
router.get('/flows/:id/executions', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
  try {
    const { rows } = await pool.query(
      `SELECT id, conversation_id, status, current_node_id, channel, category,
              created_at, updated_at
       FROM workflow_executions
       WHERE workflow_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.params.id, limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
