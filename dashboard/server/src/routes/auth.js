// POST /api/auth/login  →  { token, user: { ...fields, permissions[] } }
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool   = require('../db/pg');
const { signToken, getPermissionsForRole } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  try {
    const { rows } = await pool.query(
      'SELECT id, email, name, password_hash, role, team, state FROM users WHERE email = $1 AND active = true',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const [token, permissions] = await Promise.all([
      signToken(user),
      getPermissionsForRole(user.role),
    ]);

    const { password_hash: _, ...safeUser } = user;
    res.json({ token, user: { ...safeUser, permissions } });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
