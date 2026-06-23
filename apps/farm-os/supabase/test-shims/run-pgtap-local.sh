#!/usr/bin/env bash
# Run the Farm OS pgTAP suite against a throwaway LOCAL PostgreSQL — no Docker, no
# Supabase CLI. Spins an ephemeral cluster, applies the Supabase shims (bootstrap.sql) +
# all migrations + seed, runs every supabase/tests/*.sql, prints a TAP summary, and
# tears the cluster down. Exit 0 iff every assertion passes.
#
# Requirements: PostgreSQL 15+ and pgTAP installed and on PATH (or set PG_BIN).
#   macOS:  brew install postgresql@17   &&   build pgTAP: git clone https://github.com/theory/pgtap && cd pgtap && make && make install
#   Debian/Ubuntu:  apt-get install postgresql postgresql-<v>-pgtap
#
# NOTE: a local superuser bypasses RLS, so this CANNOT verify FORCE ROW LEVEL SECURITY
# behaviour, and it does not exercise PostgREST/GoTrue. `supabase test db` + the Playwright
# e2e on the Docker stack remain the authoritative gates. This is a fast correctness check.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPA="$(cd "$HERE/.." && pwd)"          # apps/farm-os/supabase
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb)")}"
export PATH="$PG_BIN:$PATH"
export LC_ALL=C LANG=C

WORK="$(mktemp -d)"; PGDATA="$WORK/pgdata"; PORT="${PGPORT:-54399}"
cleanup() { pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "==> initdb ($WORK)"; initdb -D "$PGDATA" -U postgres --encoding=UTF8 --locale=C >/dev/null
pg_ctl -D "$PGDATA" -l "$WORK/pg.log" -o "-p $PORT -k $WORK -c listen_addresses=''" -w start >/dev/null
createdb -h "$WORK" -p "$PORT" -U postgres farm

run() { psql -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres -d farm -X -q "$@"; }
echo "==> shims";       run -f "$HERE/bootstrap.sql" >/dev/null
echo "==> migrations";  for f in "$SUPA"/migrations/*.sql; do run -f "$f" >/dev/null; done
echo "==> seed";        run -f "$SUPA"/seed.sql >/dev/null

echo "==> pgTAP"; tot_ok=0; tot_no=0
for f in "$SUPA"/tests/*.sql; do
  out="$(psql -h "$WORK" -p "$PORT" -U postgres -d farm -X -t -A -f "$f" 2>&1)"
  ok=$(grep -cE '^ok [0-9]' <<<"$out" || true); no=$(grep -cE '^not ok [0-9]' <<<"$out" || true)
  printf '   %-40s ok=%s not_ok=%s\n' "$(basename "$f")" "$ok" "$no"
  [ "$no" -ne 0 ] && grep -E '^not ok|ERROR:|FATAL:' <<<"$out"
  tot_ok=$((tot_ok+ok)); tot_no=$((tot_no+no))
done
echo "==> TOTAL ok=$tot_ok not_ok=$tot_no"
[ "$tot_no" -eq 0 ]
