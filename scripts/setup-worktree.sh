#!/usr/bin/env bash
# Bootstrap a worktree for local development.
#
# What it does (idempotent):
#   1. Brings up the shared local Postgres container (docker-compose.dev.yml)
#   2. Creates a worktree-specific database (surevax_<slug>)
#   3. Computes a deterministic per-worktree port offset (0-99) so two
#      worktrees never collide on `pnpm dev` — UNLESS --static (see below)
#   4. Writes apps/backend/.env (DATABASE_URL, PORT, secrets, CORS_ORIGIN, ...)
#   5. Writes apps/frontend/.env.local (VITE_DEV_PORT, VITE_API_PROXY_TARGET)
#      + .claude/launch.json (matching ports, for the preview tooling)
#   6. Runs migrations + seed against the new database
#
# Flags:
#   --force   overwrite an existing apps/backend/.env (else it refuses to
#             clobber a Railway-pointing config).
#   --static  pin ports to 3000 (backend) / 5173 (frontend) instead of the
#             per-worktree offset — the static preview / spine deployment.
#             Run only ONE --static worktree at a time (it owns 3000/5173).

set -euo pipefail

FORCE=0
STATIC=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --static) STATIC=1 ;;
    *) echo "unknown arg: $arg (supported: --force, --static)" >&2; exit 2 ;;
  esac
done

# Resolve the worktree we're in (not the main repo) — every worktree has its
# own working directory and we want this scoped to that.
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"
cd "$WORKTREE_ROOT"

# Slug for the DB name: lowercase, [^a-z0-9_]→_
SLUG="$(printf '%s' "$WORKTREE_NAME" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_' | sed 's/__*/_/g; s/^_//; s/_$//')"
DB_NAME="surevax_${SLUG}"

BACKEND_ENV="$WORKTREE_ROOT/apps/backend/.env"
FRONTEND_ENV="$WORKTREE_ROOT/apps/frontend/.env.local"

if [[ $STATIC -eq 1 ]]; then
  # Static deployment (preview / single-clinic spine): fixed canonical ports so
  # the preview tooling + .claude/launch.json have a predictable target. Trades
  # multi-worktree collision-avoidance for predictability — run only ONE
  # --static worktree at a time (it owns 3000/5173).
  BACKEND_PORT=3000
  FRONTEND_PORT=5173
else
  # Port offset: first 4 hex chars of sha1(worktree name) → 0..99.
  # If another worktree's apps/backend/.env already claims that backend port,
  # bump until we find a free one. Birthday-paradox collisions are common
  # (~37% with 10 worktrees), so always check.
  HASH_HEX="$(printf '%s' "$WORKTREE_NAME" | shasum | cut -c1-4)"
  OFFSET=$(( 0x${HASH_HEX} % 100 ))

  # Collect ports already claimed by sibling worktrees' .env files
  WORKTREES_DIR="$(dirname "$WORKTREE_ROOT")"
  CLAIMED_PORTS=""
  if [[ -d "$WORKTREES_DIR" ]]; then
    for env_file in "$WORKTREES_DIR"/*/apps/backend/.env; do
      [[ -f "$env_file" ]] || continue
      [[ "$env_file" == "$BACKEND_ENV" ]] && continue  # skip our own
      port="$(awk -F= '/^PORT=/{print $2; exit}' "$env_file" 2>/dev/null || true)"
      [[ -n "$port" ]] && CLAIMED_PORTS="$CLAIMED_PORTS $port"
    done
  fi

  is_claimed() {
    local p="$1"
    for cp in $CLAIMED_PORTS; do
      [[ "$cp" == "$p" ]] && return 0
    done
    return 1
  }

  # Bump offset until backend port is free; cap iterations at 100.
  for _ in $(seq 1 100); do
    candidate=$(( 3000 + OFFSET ))
    if ! is_claimed "$candidate"; then
      break
    fi
    OFFSET=$(( (OFFSET + 1) % 100 ))
  done

  BACKEND_PORT=$(( 3000 + OFFSET ))
  FRONTEND_PORT=$(( 5173 + OFFSET ))
fi

echo "▸ Worktree:      $WORKTREE_NAME"
echo "▸ DB:            $DB_NAME"
echo "▸ Backend port:  $BACKEND_PORT"
echo "▸ Frontend port: $FRONTEND_PORT"
echo

# Refuse to clobber an existing backend .env unless --force
if [[ -e "$BACKEND_ENV" && $FORCE -eq 0 ]]; then
  echo "✗ apps/backend/.env already exists. Pass --force to overwrite."
  echo "  (If it points at Railway and you want to keep it, do nothing. Local"
  echo "   Docker setup is opt-in. To switch, run: pnpm run setup --force)"
  exit 1
fi

# 1. Docker Postgres
#
# docker-compose.dev.yml intentionally declares a stable container name so
# sibling worktrees share one local Postgres instance while using separate
# databases. `docker compose up` cannot attach to a container created from a
# different worktree project name, so reuse the named container when it already
# exists instead of trying to recreate it.
PG_CONTAINER="surevax-dev-postgres"
if docker container inspect "$PG_CONTAINER" >/dev/null 2>&1; then
  echo "▸ Reusing Postgres container $PG_CONTAINER..."
  docker start "$PG_CONTAINER" >/dev/null
else
  echo "▸ Starting Postgres container..."
  docker compose -f "$WORKTREE_ROOT/docker-compose.dev.yml" up -d >/dev/null
fi

echo "▸ Waiting for Postgres to be ready..."
for i in $(seq 1 30); do
  if docker exec "$PG_CONTAINER" pg_isready -U surevax >/dev/null 2>&1; then
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "✗ Postgres did not become ready within 30s"
    exit 1
  fi
  sleep 1
done

# 2. Create per-worktree DB if missing
EXISTS="$(docker exec "$PG_CONTAINER" psql -U surevax -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>/dev/null || echo '')"
if [[ "$EXISTS" != "1" ]]; then
  echo "▸ Creating database $DB_NAME..."
  docker exec "$PG_CONTAINER" createdb -U surevax "$DB_NAME"
else
  echo "▸ Database $DB_NAME already exists"
fi

# 3. Generate dev secrets — ≥32 chars, with the dev_..._change_in_production
#    marker so the production guard in env.ts trips if anyone copies one.
random_secret() {
  printf 'dev_%s_change_in_production' "$(openssl rand -hex 14)"
}

# 4. Write apps/backend/.env
# AUTH-2 two-role split:
#   • DATABASE_URL points at the NOBYPASSRLS `surevax_app` role — runtime.
#   • DATABASE_MIGRATOR_URL points at the BYPASSRLS `surevax` role — migrations + seed.
# The migration step below runs first as `surevax` (creates `surevax_app`) then
# sets the dev password on the new role via ALTER ROLE.
APP_DEV_PASSWORD=surevax_app_dev_password

echo "▸ Writing apps/backend/.env"
cat > "$BACKEND_ENV" <<EOF
# Generated by scripts/setup-worktree.sh for worktree: $WORKTREE_NAME
# Re-run \`pnpm run setup --force\` to regenerate.

# Runtime: surevax_app role (NOBYPASSRLS), RLS-bound.
DATABASE_URL=postgresql://surevax_app:${APP_DEV_PASSWORD}@localhost:5432/${DB_NAME}
# Migrator — surevax superuser, used by migrate.ts + seed/db.ts only.
DATABASE_MIGRATOR_URL=postgresql://surevax:surevax_dev_password@localhost:5432/${DB_NAME}
NODE_ENV=development
PORT=${BACKEND_PORT}

COOKIE_SECRET=$(random_secret)
JWT_SECRET=$(random_secret)
JWT_ACCESS_SECRET=$(random_secret)
JWT_REFRESH_SECRET=$(random_secret)

CORS_ORIGIN=http://localhost:${FRONTEND_PORT}
EOF

# 5. Write apps/frontend/.env.local
echo "▸ Writing apps/frontend/.env.local"
cat > "$FRONTEND_ENV" <<EOF
# Generated by scripts/setup-worktree.sh for worktree: $WORKTREE_NAME
VITE_DEV_PORT=${FRONTEND_PORT}
VITE_API_PROXY_TARGET=http://localhost:${BACKEND_PORT}
EOF

# 5b. Write .claude/launch.json so the preview tooling targets the dev ports.
#     Gitignored (per-worktree runtime config) — always matches .env, never
#     stale, never churns in git.
LAUNCH_JSON="$WORKTREE_ROOT/.claude/launch.json"
PNPM_PATH="$(command -v pnpm || echo /opt/homebrew/bin/pnpm)"
echo "▸ Writing .claude/launch.json"
mkdir -p "$WORKTREE_ROOT/.claude"
cat > "$LAUNCH_JSON" <<EOF
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "frontend",
      "runtimeExecutable": "${PNPM_PATH}",
      "runtimeArgs": ["--filter", "@surevax/frontend", "dev"],
      "port": ${FRONTEND_PORT}
    },
    {
      "name": "backend",
      "runtimeExecutable": "${PNPM_PATH}",
      "runtimeArgs": ["--filter", "@surevax/backend", "dev"],
      "port": ${BACKEND_PORT}
    }
  ]
}
EOF

# 6. Migrations + seed. pnpm isn't always on PATH in this repo's bash sessions;
#    fall back to the Homebrew install at /opt/homebrew/bin/pnpm.
PNPM="${PNPM:-pnpm}"
if ! command -v "$PNPM" >/dev/null 2>&1; then
  if [[ -x /opt/homebrew/bin/pnpm ]]; then
    PNPM=/opt/homebrew/bin/pnpm
  else
    echo "✗ pnpm not found on PATH and not at /opt/homebrew/bin/pnpm"
    echo "  Set PNPM=<path> and re-run."
    exit 1
  fi
fi

MIGRATOR_URL="postgresql://surevax:surevax_dev_password@localhost:5432/${DB_NAME}"
APP_URL="postgresql://surevax_app:${APP_DEV_PASSWORD}@localhost:5432/${DB_NAME}"

echo "▸ Running migrations..."
DATABASE_MIGRATOR_URL="$MIGRATOR_URL" DATABASE_URL="$MIGRATOR_URL" \
  "$PNPM" --filter @surevax/backend db:deploy

# AUTH-2: 0001_extensions_and_rls.sql created the surevax_app role (no
# password). Set the dev password here so the app's DATABASE_URL works.
echo "▸ Setting surevax_app dev password..."
docker exec "$PG_CONTAINER" psql -U surevax -d "${DB_NAME}" \
  -c "ALTER ROLE surevax_app WITH PASSWORD '${APP_DEV_PASSWORD}'" >/dev/null

echo "▸ Seeding..."
DATABASE_MIGRATOR_URL="$MIGRATOR_URL" DATABASE_URL="$MIGRATOR_URL" \
  "$PNPM" --filter @surevax/backend db:seed

# Sanity probe — the app role MUST NOT bypass RLS. psql -tA renders bool as
# `t` / `f` by default but pg_roles emits `true` / `false` via `||` text cast,
# so accept both forms.
PROBE=$(docker exec "$PG_CONTAINER" psql -U surevax -d "${DB_NAME}" -tAc \
  "SELECT rolsuper || ',' || rolbypassrls FROM pg_roles WHERE rolname='surevax_app'")
case "$PROBE" in
  "f,f"|"false,false") ;;
  *)
    echo "✗ surevax_app sanity probe failed: rolsuper,rolbypassrls=$PROBE (expected f,f or false,false)"
    exit 1
    ;;
esac
echo "▸ surevax_app probe OK (rolsuper=false rolbypassrls=false)"

# Probe app connectivity.
PGPASSWORD="$APP_DEV_PASSWORD" docker exec -e PGPASSWORD="$APP_DEV_PASSWORD" \
  "$PG_CONTAINER" psql -U surevax_app -d "${DB_NAME}" -tAc "SELECT 1" >/dev/null
echo "▸ surevax_app login OK"

# Suppress unused-variable shellcheck — APP_URL is the canonical app URL,
# written into .env above; keep the variable for documentation / future grep.
: "${APP_URL:?}"

echo "▸ Pinning graphify Python interpreter..."
GRAPHIFY_BIN=$(command -v graphify 2>/dev/null || true)
if [ -n "$GRAPHIFY_BIN" ]; then
  GRAPHIFY_PY=$(head -1 "$GRAPHIFY_BIN" | tr -d '#!')
  mkdir -p graphify-out
  echo "$GRAPHIFY_PY" > graphify-out/.graphify_python
  echo "  graphify-out/.graphify_python → $GRAPHIFY_PY"
else
  echo "  graphify not found on PATH — skipping (graphify query won't work until you install graphify)"
fi

echo
echo "✓ Worktree '$WORKTREE_NAME' ready"
echo "  DB:       $DB_NAME"
echo "  Backend:  http://localhost:${BACKEND_PORT}"
echo "  Frontend: http://localhost:${FRONTEND_PORT}"
echo
echo "Next: pnpm dev"
