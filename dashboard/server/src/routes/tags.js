// /api/tags — global tag management
const router = require('express').Router();
const pool   = require('../db/pg');
const { authenticate, requirePermission } = require('../middleware/auth');

// GET /api/tags — return all tag names
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT name FROM tags ORDER BY name');
    res.json({ tags: rows.map(r => r.name) });
  } catch (err) {
    console.error('[tags] GET /api/tags error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tags — create a new tag
router.post('/', authenticate, requirePermission('tags.manage'), async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  try {
    await pool.query(
      'INSERT INTO tags (id, name) VALUES (gen_random_uuid(), $1) ON CONFLICT (name) DO NOTHING',
      [name.trim()]
    );
    const { rows } = await pool.query('SELECT name FROM tags ORDER BY name');
    res.json({ tags: rows.map(r => r.name) });
  } catch (err) {
    console.error('[tags] POST /api/tags error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/tags/:name — delete a tag
router.delete('/:name', authenticate, requirePermission('tags.manage'), async (req, res) => {
  try {
    await pool.query('DELETE FROM tags WHERE name = $1', [req.params.name]);
    const { rows } = await pool.query('SELECT name FROM tags ORDER BY name');
    res.json({ tags: rows.map(r => r.name) });
  } catch (err) {
    console.error('[tags] DELETE /api/tags error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
