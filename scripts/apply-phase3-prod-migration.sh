#!/usr/bin/env bash
# =============================================================================
# Phase 3 Production Migration — Runner
# =============================================================================
# Applies scripts/phase3-prod-migration.sql against $PRODUCTION_DATABASE_URL,
# then runs scripts/verify-phase3-prod-migration.sql to confirm post-state.
#
# This script is for documentation / convenience. It does NOT execute itself
# automatically — must be invoked explicitly by an authorized operator.
#
# Pre-requisites:
#   - $PRODUCTION_DATABASE_URL set in env
#   - Snapshot taken (see docs/architecture/phase3-deploy-preflight.md §5)
#   - Snapshot downloaded to local durable storage
#   - Gate 3 sign-off received
#
# Failure modes:
#   - Migration is wrapped in BEGIN/COMMIT with pre-commit verification.
#     Any violation RAISEs EXCEPTION → ROLLBACK → no state change.
#   - psql -v ON_ERROR_STOP=1 aborts on first error.
# =============================================================================
set -euo pipefail

if [[ -z "${PRODUCTION_DATABASE_URL:-}" ]]; then
  echo "ERROR: PRODUCTION_DATABASE_URL not set — refusing to run." >&2
  echo "       Set this env var to the Railway production database URL." >&2
  exit 1
fi

if [[ -n "${DATABASE_URL:-}" && "${PRODUCTION_DATABASE_URL}" == "${DATABASE_URL}" ]]; then
  echo "ERROR: PRODUCTION_DATABASE_URL is identical to DATABASE_URL — refusing to run." >&2
  echo "       This script must NEVER be executed against the dev database." >&2
  echo "       Verify env var values and re-run with two distinct URLs." >&2
  exit 1
fi

# Use pg_dump/psql v17 to match prod server version (17.9).
# Default in-PATH psql is 16.10; prefer the v17 binary installed in /nix/store.
PSQL17="$(ls /nix/store/*postgresql-17*/bin/psql 2>/dev/null | head -1 || true)"
if [[ -z "$PSQL17" ]]; then
  echo "WARN: psql v17 not found in /nix/store, falling back to default psql" >&2
  PSQL17="psql"
fi
echo "Using: $($PSQL17 --version)"
echo

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_SQL="$SCRIPT_DIR/phase3-prod-migration.sql"
VERIFY_SQL="$SCRIPT_DIR/verify-phase3-prod-migration.sql"

if [[ ! -f "$MIGRATION_SQL" ]]; then
  echo "ERROR: $MIGRATION_SQL not found" >&2
  exit 1
fi
if [[ ! -f "$VERIFY_SQL" ]]; then
  echo "ERROR: $VERIFY_SQL not found" >&2
  exit 1
fi

echo "================================================================="
echo "Phase 3 Production Migration — applying"
echo "  migration:    $MIGRATION_SQL"
echo "  verification: $VERIFY_SQL"
echo "  target:       PRODUCTION_DATABASE_URL"
echo "  start:        $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "================================================================="
echo

read -r -p "Type 'APPLY' to proceed (anything else aborts): " confirm
if [[ "$confirm" != "APPLY" ]]; then
  echo "Aborted." >&2
  exit 1
fi

echo
echo "--- Applying migration ---"
"$PSQL17" "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION_SQL"

echo
echo "--- Running post-deploy verification ---"
"$PSQL17" "$PRODUCTION_DATABASE_URL" -X -f "$VERIFY_SQL"

echo
echo "================================================================="
echo "Migration + verification complete at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "================================================================="
