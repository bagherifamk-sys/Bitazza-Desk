// Bitazza Help Desk — Node/Express backend
require('dotenv').config();
const http    = require('http');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');

// Routes
const authRouter       = require('./routes/auth');
const ticketsRouter    = require('./routes/tickets');
const agentsRouter     = require('./routes/agents');
const supervisorRouter = require('./routes/supervisor');
const copilotRouter    = require('./routes/copilot');
const cannedRouter     = require('./routes/canned');
const analyticsRouter  = require('./routes/analytics');
const metricsRouter    = require('./routes/metrics');
const studioRouter     = require('./routes/studio');
const coreRouter       = require('./routes/core');
const rolesRouter      = require('./routes/roles');

// Libs
const sockets = require('./lib/sockets');
const crons   = require('./lib/crons');
const { ensureConnected } = require('./lib/redis');

const app = express();
const server = http.createServer(app);

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3001',
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

// Rate limit all API routes: 200 req/min per IP
app.use('/api', rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',        authRouter);
app.use('/api/tickets',     ticketsRouter);
app.use('/api/agents',      agentsRouter);
app.use('/api/supervisor',  supervisorRouter);
app.use('/api/copilot',     copilotRouter);
app.use('/api/canned-responses', cannedRouter);
app.use('/api/analytics',       analyticsRouter);
app.use('/api/metrics',         metricsRouter);
app.use('/api/studio',          studioRouter);
app.use('/api/core',            coreRouter);
app.use('/api/roles',           rolesRouter);

// Serve uploaded avatars
app.use('/uploads', require('express').static(require('path').join(__dirname, '..', 'uploads')));

// Health check
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, _next) => {
  console.error('[server] unhandled error:', err.message);
  res.status(500).json({ error: 'Server error' });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
const PORT = process.env.SERVER_PORT || 3002;

async function boot() {
  // Connect Redis (non-blocking — app still starts if Redis is down)
  try {
    await ensureConnected();
  } catch (err) {
    console.warn('[boot] Redis unavailable:', err.message, '— continuing without realtime state');
  }

  // Init Socket.io
  sockets.init(server);

  // Start cron jobs
  crons.start();

  server.listen(PORT, () => {
    console.log(`[server] listening on :${PORT}`);
    console.log(`[server] frontend expected at ${process.env.FRONTEND_URL || 'http://localhost:3001'}`);
  });
}

boot();
