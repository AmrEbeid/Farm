#!/usr/bin/env bash
# Benchmark the canonical 698-row reconciliation queue against an ephemeral local PostgreSQL.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
SUPA="$APP/supabase"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb)")}"
export PATH="$PG_BIN:$PATH"
export LC_ALL=C LANG=C

WORK="$(mktemp -d)"
PGDATA="$WORK/pgdata"
PORT="${PGPORT:-54401}"
cleanup() {
  pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

initdb -D "$PGDATA" -U postgres --encoding=UTF8 --locale=C >/dev/null
pg_ctl -D "$PGDATA" -l "$WORK/pg.log" -o "-p $PORT -k $WORK -c listen_addresses=''" -w start >/dev/null
createdb -h "$WORK" -p "$PORT" -U postgres farm

run() { psql -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres -d farm -X -q "$@"; }
run -f "$SUPA/test-shims/bootstrap.sql" >/dev/null 2>&1
for migration in "$SUPA"/migrations/*.sql; do run -f "$migration" >/dev/null 2>&1; done
run -f "$SUPA/seed.sql" >/dev/null 2>&1

run <<'SQL'
begin;

insert into public.reconciliation_batches (
  id, org_id, status, source_label, created_by
)
select
  'b6980000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'staged',
  'queue benchmark',
  user_id
from public.organization_member
where org_id = '00000000-0000-0000-0000-000000000001'
  and role = 'accountant'
limit 1;

with inserted_evidence as (
  insert into public.reconciliation_evidence_items (
    id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
    source_identity_fingerprint, source_amount, classification, invalid_calendar_quality_flag
  )
  select
    pg_catalog.gen_random_uuid(),
    '00000000-0000-0000-0000-000000000001',
    'source_workbook_row',
    repeat('b', 64),
    case when g <= 660 then 'المصروفات' else 'المبيعات' end,
    g::text,
    'queue-benchmark-' || g::text,
    g::numeric,
    case when g % 47 = 0 then 'amount_correction_candidate' else 'source_addition_candidate' end,
    false
  from pg_catalog.generate_series(1, 698) g
  returning id
)
insert into public.reconciliation_batch_rows (
  id, org_id, batch_id, evidence_item_id, review_state, disposition, frozen
)
select
  pg_catalog.gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'b6980000-0000-4000-8000-000000000001',
  id,
  'unreviewed',
  'hold',
  false
from inserted_evidence;

create temporary table benchmark_samples (elapsed_ms numeric not null);
grant insert, select on benchmark_samples to authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.json_build_object(
    'sub', (
      select user_id from public.organization_member
      where org_id = '00000000-0000-0000-0000-000000000001'
        and role = 'accountant'
      limit 1
    ),
    'role', 'authenticated'
  )::text,
  true
) as claims \gset
set local role authenticated;

do $benchmark$
declare
  started_at timestamptz;
  iteration integer;
begin
  for iteration in 1..5 loop
    perform public.fn_reconciliation_queue_page(
      '00000000-0000-0000-0000-000000000001',
      'b6980000-0000-4000-8000-000000000001',
      null, null, null, 1, 50
    );
  end loop;
  for iteration in 1..30 loop
    started_at := pg_catalog.clock_timestamp();
    perform public.fn_reconciliation_queue_page(
      '00000000-0000-0000-0000-000000000001',
      'b6980000-0000-4000-8000-000000000001',
      null, null, null, 1, 50
    );
    insert into benchmark_samples values (
      extract(epoch from (pg_catalog.clock_timestamp() - started_at)) * 1000
    );
  end loop;
end
$benchmark$;

reset role;
select
  count(*) as samples,
  round(min(elapsed_ms), 2) as min_ms,
  round(pg_catalog.percentile_cont(0.5) within group (order by elapsed_ms)::numeric, 2) as median_ms,
  round(pg_catalog.percentile_cont(0.95) within group (order by elapsed_ms)::numeric, 2) as p95_ms,
  pg_catalog.jsonb_array_length(public.fn_reconciliation_queue_page(
    '00000000-0000-0000-0000-000000000001',
    'b6980000-0000-4000-8000-000000000001',
    null, null, null, 1, 50
  ) -> 'rows') as returned_rows
from benchmark_samples;

rollback;
SQL
