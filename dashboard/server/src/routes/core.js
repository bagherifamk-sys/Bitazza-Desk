// GET /api/core/profile/:uid
// FR-09: Proxy to Bitazza Core API — fetch live KYC, balances, recent transactions.
// 5s timeout enforced; graceful 503 if upstream is down.
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

const CORE_API_URL  = process.env.CORE_API_URL  || '';
const CORE_API_KEY  = process.env.CORE_API_KEY  || '';

router.get('/profile/:uid', async (req, res) => {
  if (!CORE_API_URL) {
    return res.status(503).json({ error: 'Core API not configured (CORE_API_URL missing)' });
  }

  // Validate uid — only allow alphanumeric + hyphen/underscore
  const uid = req.params.uid;
  if (!/^[\w-]+$/.test(uid)) {
    return res.status(400).json({ error: 'Invalid uid' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const upstream = await fetch(`${CORE_API_URL}/internal/users/${encodeURIComponent(uid)}/cs-profile`, {
      headers: {
        'Authorization': `Bearer ${CORE_API_KEY}`,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Core API returned ${upstream.status}` });
    }

    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Core API timeout' });
    }
    console.error('[core] upstream error:', err.message);
    res.status(503).json({ error: 'Core API unavailable' });
  } finally {
    clearTimeout(timeout);
  }
});

module.exports = router;
