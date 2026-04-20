#!/bin/bash
# Start all services and keep them alive.
# Usage: bash start-feature.sh

REPO="/Users/kasrabaqeri/Desktop/CS BOT"

log() { echo "[$(date +%H:%M:%S)] $*"; }

kill_port() {
  lsof -ti tcp:$1 | xargs kill -9 2>/dev/null; sleep 0.5
}

# ── Kill stale processes ──────────────────────────────────────────────────────
log "Clearing ports..."
kill_port 3002; kill_port 4000; kill_port 8000

sleep 1

# ── Redis ─────────────────────────────────────────────────────────────────────
if ! redis-cli ping >/dev/null 2>&1; then
  log "Starting Redis..."
  redis-server --daemonize yes --logfile /tmp/redis.log
  sleep 1
fi
log "Redis: OK"

# ── Python :8000 ──────────────────────────────────────────────────────────────
log "Starting Python :8000"
cd "$REPO" && .venv/bin/python -m uvicorn api.main:app --reload --port 8000 \
  >> /tmp/py.log 2>&1 &
sleep 4

# ── Node.js :4000 ─────────────────────────────────────────────────────────────
log "Starting Node.js :4000"
cd "$REPO/dashboard/server" && nodemon src/index.js >> /tmp/node.log 2>&1 &
sleep 2

# ── Vite :3002 ────────────────────────────────────────────────────────────────
log "Starting Vite :3002"
cd "$REPO/dashboard" && node_modules/.bin/vite --port 3002 >> /tmp/vite.log 2>&1 &
sleep 2

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "All services started."
log "  Dashboard → http://localhost:3002"
log "  API       → http://localhost:8000"
log "  Node      → http://localhost:4000"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Watching for crashes (Ctrl+C to stop)..."

# ── Watchdog loop ─────────────────────────────────────────────────────────────
while true; do
  if ! lsof -ti tcp:3002 >/dev/null 2>&1; then
    log "Vite :3002 died — restarting"
    cd "$REPO/dashboard" && node_modules/.bin/vite --port 3002 >> /tmp/vite.log 2>&1 &
  fi
  if ! lsof -ti tcp:4000 >/dev/null 2>&1; then
    log "Node.js :4000 died — restarting"
    cd "$REPO/dashboard/server" && nodemon src/index.js >> /tmp/node.log 2>&1 &
  fi
  if ! lsof -ti tcp:8000 >/dev/null 2>&1; then
    log "Python :8000 died — restarting"
    cd "$REPO" && .venv/bin/python -m uvicorn api.main:app --reload --port 8000 >> /tmp/py.log 2>&1 &
  fi
  sleep 8
done
