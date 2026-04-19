#!/bin/bash
# Start all feature branch services and keep them alive.
# Usage: bash start-feature.sh

REPO="/Users/kasrabaqeri/Desktop/CS BOT"
MAIN="/Users/kasrabaqeri/Desktop/CS BOT-main"

log() { echo "[$(date +%H:%M:%S)] $*"; }

kill_port() {
  lsof -ti tcp:$1 | xargs kill -9 2>/dev/null; sleep 0.5
}

start_service() {
  local name=$1 port=$2 cmd=$3 dir=$4 logfile=$5
  while true; do
    if ! lsof -ti tcp:$port >/dev/null 2>&1; then
      log "Starting $name on :$port"
      cd "$dir" && eval "$cmd" >> "$logfile" 2>&1 &
      sleep 3
    fi
    sleep 5
  done
}

# ── Kill stale processes ──────────────────────────────────────────────────────
log "Clearing ports..."
kill_port 3002; kill_port 3003; kill_port 4000; kill_port 8000; kill_port 8001

sleep 1

# ── Redis ─────────────────────────────────────────────────────────────────────
if ! redis-cli ping >/dev/null 2>&1; then
  log "Starting Redis..."
  redis-server --daemonize yes --logfile /tmp/redis.log
  sleep 1
fi
log "Redis: OK"

# ── Python :8000 — main branch ────────────────────────────────────────────────
log "Starting Python :8000 (main)"
cd "$MAIN" && .venv/bin/python -m uvicorn api.main:app --reload --port 8000 \
  >> /tmp/py-main.log 2>&1 &
sleep 4

# ── Python :8001 — feature branch ────────────────────────────────────────────
log "Starting Python :8001 (feature)"
cd "$REPO" && .venv/bin/python -m uvicorn api.main:app --reload --port 8001 \
  >> /tmp/py-feature.log 2>&1 &
sleep 2

# ── Node.js :4000 — shared ───────────────────────────────────────────────────
log "Starting Node.js :4000"
cd "$REPO/dashboard/server" && node src/index.js >> /tmp/node.log 2>&1 &
sleep 2

# ── Vite :3002 — main dashboard ──────────────────────────────────────────────
log "Starting Vite :3002 (main dashboard)"
cd "$MAIN/dashboard" && node_modules/.bin/vite --port 3002 >> /tmp/vite-main.log 2>&1 &
sleep 2

# ── Vite :3003 — feature dashboard ───────────────────────────────────────────
log "Starting Vite :3003 (feature dashboard)"
cd "$REPO/dashboard" && node_modules/.bin/vite --port 3003 >> /tmp/vite-feature.log 2>&1 &
sleep 2

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "All services started."
log "  Main dashboard  → http://localhost:3002"
log "  Feature dashboard → http://localhost:3003"
log "  Widget          → http://localhost:5173"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Watching for crashes (Ctrl+C to stop)..."

# ── Watchdog loop ─────────────────────────────────────────────────────────────
while true; do
  # Vite :3002
  if ! lsof -ti tcp:3002 >/dev/null 2>&1; then
    log "Vite :3002 died — restarting"
    cd "$MAIN/dashboard" && node_modules/.bin/vite --port 3002 >> /tmp/vite-main.log 2>&1 &
  fi
  # Vite :3003
  if ! lsof -ti tcp:3003 >/dev/null 2>&1; then
    log "Vite :3003 died — restarting"
    cd "$REPO/dashboard" && node_modules/.bin/vite --port 3003 >> /tmp/vite-feature.log 2>&1 &
  fi
  # Node.js :4000
  if ! lsof -ti tcp:4000 >/dev/null 2>&1; then
    log "Node.js :4000 died — restarting"
    cd "$REPO/dashboard/server" && node src/index.js >> /tmp/node.log 2>&1 &
  fi
  # Python :8001
  if ! lsof -ti tcp:8001 >/dev/null 2>&1; then
    log "Python :8001 died — restarting"
    cd "$REPO" && .venv/bin/python -m uvicorn api.main:app --reload --port 8001 >> /tmp/py-feature.log 2>&1 &
  fi
  # Python :8000
  if ! lsof -ti tcp:8000 >/dev/null 2>&1; then
    log "Python :8000 died — restarting"
    cd "$MAIN" && .venv/bin/python -m uvicorn api.main:app --reload --port 8000 >> /tmp/py-main.log 2>&1 &
  fi
  sleep 8
done
