// GET /api/users/search        — search user by uid, email, or phone
// GET /api/users/:uid/profile  — full profile (KYC, balances, etc.)
// GET /api/users/:uid/transactions   — paginated deposit/withdrawal history
// GET /api/users/:uid/spot-trades    — paginated spot trade history
// GET /api/users/:uid/futures-trades — paginated futures trade history
// GET /api/users/:uid/tickets        — all CS tickets for this user (from our DB)
const router  = require('express').Router();
const pool    = require('../db/pg');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

const MOCK_API_URL = process.env.MOCK_API_URL || 'http://localhost:8000';
const MOCK_API_TOKEN = process.env.MOCK_API_TOKEN || 'dev-token';

async function mockFetch(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${MOCK_API_URL}${path}`, {
      headers: { Authorization: `Bearer ${MOCK_API_TOKEN}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function validateUid(uid) {
  return /^[\w-]+$/.test(uid);
}

// Search: GET /api/users/search?q=...&by=uid|email|phone
router.get('/search', async (req, res) => {
  const { q, by = 'uid' } = req.query;
  if (!q) return res.status(400).json({ error: 'q is required' });

  const param = by === 'email' ? 'email' : by === 'phone' ? 'phone' : 'user_id';
  try {
    const profile = await mockFetch(`/mock/user?${param}=${encodeURIComponent(q)}`);
    const restrictions = await mockFetch(`/mock/restrictions?user_id=${encodeURIComponent(profile.user_id)}`);
    res.json({ ...profile, restrictions });
  } catch (err) {
    if (err.message.includes('404') || err.message.includes('upstream 404')) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(503).json({ error: 'User lookup unavailable' });
  }
});

// Profile: GET /api/users/:uid/profile
router.get('/:uid/profile', async (req, res) => {
  if (!validateUid(req.params.uid)) return res.status(400).json({ error: 'Invalid uid' });
  try {
    const [profile, restrictions] = await Promise.all([
      mockFetch(`/mock/user?user_id=${encodeURIComponent(req.params.uid)}`),
      mockFetch(`/mock/restrictions?user_id=${encodeURIComponent(req.params.uid)}`),
    ]);
    res.json({ ...profile, restrictions });
  } catch (err) {
    if (err.message.includes('404')) return res.status(404).json({ error: 'User not found' });
    res.status(503).json({ error: 'Profile unavailable' });
  }
});

// Transactions: GET /api/users/:uid/transactions?page=1&page_size=20
router.get('/:uid/transactions', async (req, res) => {
  if (!validateUid(req.params.uid)) return res.status(400).json({ error: 'Invalid uid' });
  const { page = 1, page_size = 20 } = req.query;
  try {
    const data = await mockFetch(`/mock/transactions?user_id=${encodeURIComponent(req.params.uid)}&page=${page}&page_size=${page_size}`);
    res.json(data);
  } catch (err) {
    if (err.message.includes('404')) return res.status(404).json({ error: 'User not found' });
    res.status(503).json({ error: 'Transaction history unavailable' });
  }
});

// Spot trades: GET /api/users/:uid/spot-trades?page=1&page_size=20
router.get('/:uid/spot-trades', async (req, res) => {
  if (!validateUid(req.params.uid)) return res.status(400).json({ error: 'Invalid uid' });
  const { page = 1, page_size = 20 } = req.query;
  try {
    const data = await mockFetch(`/mock/spot-trades?user_id=${encodeURIComponent(req.params.uid)}&page=${page}&page_size=${page_size}`);
    res.json(data);
  } catch (err) {
    if (err.message.includes('404')) return res.status(404).json({ error: 'User not found' });
    res.status(503).json({ error: 'Spot trade history unavailable' });
  }
});

// Futures trades: GET /api/users/:uid/futures-trades?page=1&page_size=20
router.get('/:uid/futures-trades', async (req, res) => {
  if (!validateUid(req.params.uid)) return res.status(400).json({ error: 'Invalid uid' });
  const { page = 1, page_size = 20 } = req.query;
  try {
    const data = await mockFetch(`/mock/futures-trades?user_id=${encodeURIComponent(req.params.uid)}&page=${page}&page_size=${page_size}`);
    res.json(data);
  } catch (err) {
    if (err.message.includes('404')) return res.status(404).json({ error: 'User not found' });
    res.status(503).json({ error: 'Futures trade history unavailable' });
  }
});

// Ticket history: GET /api/users/:uid/tickets
// Looks up by customer.external_id (bitazza_uid) or customer email
router.get('/:uid/tickets', async (req, res) => {
  if (!validateUid(req.params.uid)) return res.status(400).json({ error: 'Invalid uid' });
  try {
    const { rows } = await pool.query(`
      SELECT
        t.id, t.status, t.priority, t.channel, t.category, t.tags,
        t.created_at, t.updated_at, t.assigned_to,
        c.name AS customer_name, c.email AS customer_email,
        u.name AS assigned_to_name,
        (SELECT content FROM messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_message
      FROM tickets t
      LEFT JOIN customers c ON t.customer_id = c.id
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE c.external_id = $1 OR c.bitazza_uid = $1
      ORDER BY t.created_at DESC
      LIMIT 100
    `, [req.params.uid]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Balances: GET /api/users/:uid/balances
router.get('/:uid/balances', async (req, res) => {
  if (!validateUid(req.params.uid)) return res.status(400).json({ error: 'Invalid uid' });
  try {
    const data = await mockFetch(`/mock/balances?user_id=${encodeURIComponent(req.params.uid)}`);
    res.json(data);
  } catch (err) {
    if (err.message.includes('404')) return res.status(404).json({ error: 'User not found' });
    res.status(503).json({ error: 'Balance data unavailable' });
  }
});

module.exports = router;
