#!/usr/bin/env bash
# =============================================================================
# db-tests/run.sh
#
# Runs the access-control test suite against a throwaway local Postgres.
# No Docker, no Supabase project, no network. Roughly two seconds end to end,
# which is what makes it something you actually run before every push.
#
#   ./db-tests/run.sh
#
# Requires: a local PostgreSQL 14+ (`initdb`, `pg_ctl`, `psql` on PATH).
# Override the port with PGPORT_TEST if 5433 is taken.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PGPORT_TEST:-5433}"
DATADIR="${PGDATA_TEST:-/tmp/rw-applications-pgtest}"
SOCKET="/tmp"
DB="rw_applications_test"

if ! command -v pg_ctl >/dev/null 2>&1; then
  for d in /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql*/bin /usr/local/opt/postgresql*/bin; do
    [ -d "$d" ] && export PATH="$d:$PATH" && break
  done
fi
command -v pg_ctl >/dev/null 2>&1 || { echo "pg_ctl not found; install PostgreSQL client+server tools." >&2; exit 1; }

if ! pg_ctl -D "$DATADIR" status >/dev/null 2>&1; then
  [ -d "$DATADIR" ] || initdb -D "$DATADIR" -U postgres --auth=trust >/dev/null
  pg_ctl -D "$DATADIR" -l "$DATADIR/server.log" -o "-p $PORT -k $SOCKET" start >/dev/null
  sleep 1
fi

PSQL="psql -h $SOCKET -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"

$PSQL -d postgres -c "drop database if exists $DB;" >/dev/null
$PSQL -d postgres -c "create database $DB;"        >/dev/null

# The bootstrap stands in for what Supabase provides; everything after it is
# the code that actually ships.
$PSQL -d "$DB" -f "$ROOT/db-tests/00_supabase_bootstrap.sql" >/dev/null

for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$migration")"
  $PSQL -d "$DB" -f "$migration" >/dev/null
done

echo ""
psql -h "$SOCKET" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
     -f "$ROOT/db-tests/01_access_control_tests.sql"
