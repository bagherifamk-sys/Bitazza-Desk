#!/usr/bin/env bash
# CS BOT — Full Fly.io deployment script
# Run from the repo root: bash deploy.sh
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# ── Load secrets from .env ────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "ERROR: .env file not found. Copy .env.example and fill in values."
  exit 1
fi
source .env

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║         CS BOT — Fly.io Deployment           ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Create Postgres (shared by API + dashboard) ───────────────────────────
echo "▶ [1/7] Creating Postgres cluster..."
fly postgres create --name csbot-db --region sin --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1 2>/dev/null || echo "  (already exists, skipping)"

# ── 2. Create Redis ───────────────────────────────────────────────────────────
echo "▶ [2/7] Creating Redis instance..."
fly redis create --name csbot-redis --region sin --no-replicas 2>/dev/null || echo "  (already exists, skipping)"
REDIS_URL=$(fly redis status csbot-redis --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('privateUrl',''))" 2>/dev/null || echo "")

# ── 3. Deploy API ─────────────────────────────────────────────────────────────
echo ""
echo "▶ [3/7] Creating API app..."
fly apps create csbot-api --org personal 2>/dev/null || echo "  (already exists)"

echo "▶ [4/7] Setting API secrets..."
fly secrets set \
  GEMINI_API_KEY="$GEMINI_API_KEY" \
  FRESHDESK_API_KEY="$FRESHDESK_API_KEY" \
  FRESHDESK_SUBDOMAIN="$FRESHDESK_SUBDOMAIN" \
  JWT_SECRET="$JWT_SECRET" \
  USE_MOCK_USER_API="true" \
  ENV="production" \
  --app csbot-api

echo "▶ [4b/7] Attaching Postgres to API..."
fly postgres attach csbot-db --app csbot-api 2>/dev/null || echo "  (already attached)"

echo "▶ [4c/7] Creating data volume for ChromaDB..."
fly volumes create csbot_data --region sin --size 3 --app csbot-api 2>/dev/null || echo "  (already exists)"

echo "▶ [4d/7] Deploying API..."
fly deploy --app csbot-api --config fly.toml --remote-only

# ── 4. Run DB migrations via API ─────────────────────────────────────────────
echo ""
echo "▶ [5/7] Running Python DB migrations..."
fly ssh console --app csbot-api --command "python -c \"from db.conversation_store import init_db; init_db(); print('Python schema ready')\"" 2>/dev/null || echo "  (will run on first boot)"

# ── 5. Deploy Dashboard ───────────────────────────────────────────────────────
echo ""
echo "▶ [6/7] Creating Dashboard app..."
fly apps create csbot-dashboard --org personal 2>/dev/null || echo "  (already exists)"

echo "▶ [6b/7] Setting Dashboard secrets..."
fly secrets set \
  JWT_SECRET="$JWT_SECRET" \
  NODE_ENV="production" \
  FRONTEND_URL="https://csbot-dashboard.fly.dev" \
  --app csbot-dashboard

if [ -n "$REDIS_URL" ]; then
  fly secrets set REDIS_URL="$REDIS_URL" --app csbot-dashboard
fi

echo "▶ [6c/7] Attaching Postgres to Dashboard..."
fly postgres attach csbot-db --app csbot-dashboard 2>/dev/null || echo "  (already attached)"

echo "▶ [6d/7] Deploying Dashboard..."
fly deploy --app csbot-dashboard --config dashboard/fly.toml --remote-only

# ── 6. Run Node migrations ────────────────────────────────────────────────────
echo ""
echo "▶ Running Node DB migrations (schema + seed roles)..."
fly ssh console --app csbot-dashboard --command "node server/src/db/migrate.js" 2>/dev/null || echo "  (will run on first boot via startup)"

# ── 7. Deploy Widget ──────────────────────────────────────────────────────────
echo ""
echo "▶ [7/7] Creating Widget app..."
fly apps create csbot-widget --org personal 2>/dev/null || echo "  (already exists)"

echo "▶ [7b/7] Deploying Widget..."
fly deploy --app csbot-widget --config frontend/widget/fly.toml --remote-only

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║              Deployment Complete!            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  API:        https://csbot-api.fly.dev"
echo "  Dashboard:  https://csbot-dashboard.fly.dev"
echo "  Widget:     https://csbot-widget.fly.dev"
echo ""
echo "  Health checks:"
echo "    curl https://csbot-api.fly.dev/health"
echo "    curl https://csbot-dashboard.fly.dev/health"
echo ""
