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

echo "==> pgTAP"; tot_ok=0; tot_no=0; tot_bad=0
for f in "$SUPA"/tests/*.sql; do
  # Capture psql's exit code too (|| keeps `set -e` from aborting and lets us read $?).
  # NOTE: the test runs WITHOUT ON_ERROR_STOP on purpose (pgTAP's throws_ok/lives_ok rely
  # on continuing past a caught exception), so psql usually exits 0 even when a statement
  # raises — which is exactly why the ok/not-ok tally alone can FALSE-GREEN. See the three
  # guards below.
  rc=0; out="$(psql -h "$WORK" -p "$PORT" -U postgres -d farm -X -t -A -f "$f" 2>&1)" || rc=$?
  ok=$(grep -cE '^ok [0-9]' <<<"$out" || true)
  # Honor the TAP TODO directive: `not ok N - … # TODO …` is an EXPECTED failure (a regression
  # test pinning a known-unfixed bug), so it must NOT fail the run — same as pg_prove/`supabase
  # test db`. Count only non-TODO `not ok` lines as real failures; report TODOs separately.
  no=$(grep -E '^not ok [0-9]' <<<"$out" | grep -cvE '# TODO' || true)
  todo=$(grep -cE '^not ok [0-9].*# TODO' <<<"$out" || true)

  # ── False-green guards (a test file can pass the ok/not-ok tally yet not have actually run) ──
  # G1: an UNCAUGHT SQL error. Without ON_ERROR_STOP, psql prints `ERROR:`/`FATAL:`/`PANIC:`,
  #     skips the failed statement, and still exits 0 — the errored assertion emits no TAP line.
  #     pgTAP's throws_ok/lives_ok catch their own exceptions and DON'T print these, so any such
  #     line at the start of a message is a genuine, un-asserted failure.
  err=$(grep -cE '^(psql:.*: )?(ERROR|FATAL|PANIC):' <<<"$out" || true)
  # G2: a PLAN mismatch — the file declared `1..N` but a mid-run abort left fewer assertions.
  plan=$(grep -oE '^1\.\.[0-9]+' <<<"$out" | head -1 | sed 's/^1\.\.//' || true)
  ran=$((ok + no + todo))
  planbad=0
  if [ -n "$plan" ]; then
    [ "$ran" -ne "$plan" ] && planbad=1
  elif [ "$ran" -eq 0 ]; then
    planbad=1   # G3: no plan line AND no assertions => the file produced no TAP at all (errored out)
  fi

  filebad=0
  { [ "$rc" -ne 0 ] || [ "$err" -ne 0 ] || [ "$planbad" -ne 0 ]; } && filebad=1
  note=""
  [ "$filebad" -ne 0 ] && note="  *** FAIL (rc=$rc errors=$err plan=${plan:-none} ran=$ran)"
  printf '   %-40s ok=%s not_ok=%s todo=%s%s\n' "$(basename "$f")" "$ok" "$no" "$todo" "$note"
  { [ "$no" -ne 0 ] || [ "$filebad" -ne 0 ]; } && \
    grep -E '^not ok|^(psql:.*: )?(ERROR|FATAL|PANIC):' <<<"$out" | grep -vE '# TODO' || true
  tot_ok=$((tot_ok+ok)); tot_no=$((tot_no+no)); tot_bad=$((tot_bad+filebad))
done
echo "==> TOTAL ok=$tot_ok not_ok=$tot_no file_failures=$tot_bad"
# Green iff there were zero real `not ok` AND zero files that errored / under-ran / exited non-zero.
[ "$tot_no" -eq 0 ] && [ "$tot_bad" -eq 0 ]
