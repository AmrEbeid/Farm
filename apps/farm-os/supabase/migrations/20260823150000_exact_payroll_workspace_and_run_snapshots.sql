-- R4b pass 1: two exact, bounded, active-organisation snapshots for the payroll WORKSPACE (the run
-- history) and a single closed RUN's detail — the read-contract counterpart of
-- 20260729090000_payroll_run_persistence.sql's write/close RPC.
--
-- WHY THIS EXISTS. `lib/payroll-report.ts` already reads `payroll_runs`/`payroll_run_lines` directly
-- through PostgREST with LIMIT = max + 1 overflow detection — a working, fail-closed read, but one
-- that leaves "how many runs/lines actually exist" and "the page I can show" as two facts the caller
-- has to reconcile itself, and repeats the auth/membership checks nowhere in SQL. This migration adds
-- the same exact/bounded contract shape R4a gave the inventory list and item 360
-- (20260823140000_exact_inventory_list_and_item_snapshots.sql): one deterministically ordered
-- limit/offset page, with its EXACT total published separately, decided and gated entirely inside
-- PostgreSQL. It does not replace `fn_close_payroll_run` itself, but it IS the read path behind the
-- rebuilt payroll workspace, run 360 and readiness pages: `lib/payroll-report.ts`'s direct
-- `payroll_runs`/`payroll_run_lines` selects are retired in the same change that introduces these two
-- functions, and every payroll read on those routes goes through one of them.
--
-- NO SCOPE SPLIT. Unlike inventory, payroll has no operational/finance role branching: the existing
-- `payroll_read` RLS policy already gates every row on `authorize('payroll.read', org_id)`
-- (owner/accountant only, SPEC-0006's own role set) and there is no third role with a narrower payroll
-- view to build. Both functions re-check the SAME permission explicitly (never trusting RLS alone for
-- a money-adjacent read, mirroring `fn_close_payroll_run`'s own posture) — belt and suspenders, not a
-- second policy.
--
-- STORED VALUES ONLY, NEVER RECOMPUTED. `payroll_run_lines` freezes person name,
-- mode/rate/quantity/unit/gross at
-- close time and is immutable (`fn_immutable_payroll_row`); these snapshots read exactly those frozen
-- columns and never join `people_compensation` to re-price against a current rate. A rate edited after
-- a close must never change what a past run reports (the same invariant `fn_close_payroll_run`'s own
-- header documents under "COMPENSATION MUTATION CONSISTENCY").
--
-- NO CONTACT PII, NO CLOSER IDENTITY. The stored person-name snapshot is the only identity fact
-- published (SPEC-0048 keeps phone/email PII-locked). `payroll_runs.closed_by` is
-- never published by either snapshot: which specific person closed a run is not a fact either page
-- (a runs list, a run's own line detail) needs to show, and every column on `payroll_runs`/
-- `payroll_run_lines` is already provenance-locked from ANY UPDATE, so leaving it out here is a
-- narrower publication, not a weaker one.
--
-- HONESTY CONTRACT (docs/CLAUDE.md #1). Every count is an exact count of RECORDED rows in the active
-- organisation. The bounded page is published beside its own exact total, never in place of it, so a
-- truncated page can never be mistaken for the whole book.
--
-- FAIL CLOSED — CORRUPTION AND RECONCILIATION. Both functions are SECURITY INVOKER: a
-- `payroll_run_lines` row that belongs to another organisation is already invisible to the caller
-- under RLS, so only the FORWARD relationship (a line's `person_id` resolving inside THIS
-- organisation) is checkable here, and it is checked explicitly rather than assumed — a defence
-- against a privileged bypass of the ordinary write-path guard, mirroring R4a's own posture on its one
-- checkable join. Independently, each run's stored `total_gross` is re-verified against the sum of its
-- own stored lines: both are written together in one statement at close time and never touched again,
-- so any drift between them can only be corruption, and it fails the read closed (23514) rather than
-- publishing a total that disagrees with the lines behind it.
--
-- A CLOSED RUN WITH ZERO LINES IS CORRUPTION, NOT A VALID ZERO RUN. `fn_close_payroll_run` refuses an
-- empty crew before its first write, and the report this replaces (`payroll-report.ts`) already
-- refuses to render a run whose lines read back empty. A recorded `payroll_runs` row with no
-- `payroll_run_lines` behind it can therefore only mean the write path was bypassed, so both functions
-- below fail the read closed (23514) rather than reporting a run of exact zero lines as if it were one.
--
-- CROSS-ORG AND NONEXISTENT ARE INDISTINGUISHABLE. `fn_payroll_run_snapshot` returns `null` — not an
-- exception — for a run id that belongs to another organisation and for one that exists nowhere at
-- all, exactly like `fn_inventory_item_snapshot`: the caller must never be able to learn from the
-- error shape whether another organisation happens to own that id.
--
-- BOUNDS. Both functions paginate server-side (limit 1-50, offset 0-1,000,000, the same ceilings R4a
-- established) and publish their exact totals SEPARATELY from the bounded rows. Counts and decimals
-- leave PostgreSQL as TEXT for the same reason R4a's header states: a JS number cannot represent every
-- bigint, and a binary double cannot represent every `numeric`.

begin;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 0) FREEZE PERSON NAME ON EACH IMMUTABLE PAYROLL LINE
-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- Rates and quantities were already frozen, but the old report joined today's mutable people.name.
-- Add the missing close-time identity fact. Existing rows can only be assigned the name recorded on
-- the people row at this migration boundary; production currently has no payroll_run_lines, while
-- this guarded backfill keeps the migration correct if a legacy row appears before apply.
alter table public.payroll_run_lines
  add column if not exists person_name_snapshot text;

-- The table's unconditional immutable trigger correctly blocks ordinary updates. Pause that one
-- trigger only inside this transaction for the one-time null-only backfill; any failure rolls the
-- trigger state and the data change back together.
alter table public.payroll_run_lines disable trigger immutable_payroll_run_lines;
update public.payroll_run_lines l
   set person_name_snapshot = p.name
  from public.people p
 where l.person_name_snapshot is null
   and p.id = l.person_id
   and p.org_id = l.org_id;
alter table public.payroll_run_lines enable trigger immutable_payroll_run_lines;

do $$
begin
  if exists (
    select 1
      from public.payroll_run_lines
     where person_name_snapshot is null
        or pg_catalog.btrim(person_name_snapshot) = ''
  ) then
    raise exception 'payroll person-name snapshot backfill is incomplete' using errcode = '23514';
  end if;
end;
$$;

alter table public.payroll_run_lines
  alter column person_name_snapshot set not null;
alter table public.payroll_run_lines
  drop constraint if exists payroll_run_lines_person_name_snapshot_nonempty;
alter table public.payroll_run_lines
  add constraint payroll_run_lines_person_name_snapshot_nonempty
  check (pg_catalog.btrim(person_name_snapshot) <> '');

create or replace function public.fn_freeze_payroll_person_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person_name text;
begin
  select p.name
    into v_person_name
    from public.people p
   where p.id = new.person_id
     and p.org_id = new.org_id;

  if v_person_name is null or pg_catalog.btrim(v_person_name) = '' then
    raise exception 'payroll_run_lines: person identity is missing or belongs to another organization'
      using errcode = '23514';
  end if;

  if new.person_name_snapshot is null then
    new.person_name_snapshot := v_person_name;
  elsif new.person_name_snapshot is distinct from v_person_name then
    raise exception 'payroll_run_lines: person-name snapshot must match the person at close time'
      using errcode = '23514';
  end if;

  return new;
end;
$$;
revoke execute on function public.fn_freeze_payroll_person_name() from public, anon, authenticated;

drop trigger if exists freeze_payroll_person_name on public.payroll_run_lines;
create trigger freeze_payroll_person_name
  before insert on public.payroll_run_lines
  for each row execute function public.fn_freeze_payroll_person_name();

comment on column public.payroll_run_lines.person_name_snapshot is
  'Worker display name frozen when the immutable payroll line is inserted. Historical payroll reads never join the current mutable people.name.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 1) EXACT PAYROLL WORKSPACE SNAPSHOT — the run history, bounded and exactly counted
-- ───────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_payroll_workspace_snapshot(
  p_org uuid,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_active_org uuid;
  v_result jsonb;
begin
  if p_org is null then
    raise exception 'organization is required' using errcode = '23502';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'payroll workspace limit must be between 1 and 50' using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 1000000 then
    raise exception 'payroll workspace offset is out of range' using errcode = '22023';
  end if;

  begin
    v_active_org := nullif(
      nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'active_org_id',
      ''
    )::uuid;
  exception when others then
    raise exception 'forbidden: invalid active organization claim' using errcode = '42501';
  end;

  if v_uid is null or v_active_org is null or v_active_org is distinct from p_org then
    raise exception 'forbidden: payroll workspace requires the active organization' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_member m where m.user_id = v_uid and m.org_id = p_org
  ) then
    raise exception 'forbidden: organization membership is required' using errcode = '42501';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: organization is outside the active scope' using errcode = '42501';
  end if;
  if not public.authorize('payroll.read', p_org) then
    raise exception 'forbidden: payroll.read (owner/accountant) is required' using errcode = '42501';
  end if;

  -- Relationship integrity, forward direction only — see the header's FAIL CLOSED note. The write
  -- path already forbids a cross-org person on a payroll_run_lines row (fn_guard_payroll_run_line_
  -- tenant); this re-verifies it defensively for a privileged bypass, never trusting it silently on a
  -- money-adjacent read.
  if exists (
    select 1 from public.payroll_run_lines l
    left join public.people p on p.id = l.person_id and p.org_id = p_org
    where l.org_id = p_org and p.id is null
  ) then
    raise exception 'payroll workspace organization relationship mismatch' using errcode = '23514';
  end if;

  -- A closed run with no stored lines is corruption, never a valid zero run — see the header's A
  -- CLOSED RUN WITH ZERO LINES note. Checked before reconciliation, because an empty run's
  -- total_gross = 0 would otherwise reconcile trivially against zero lines and hide the gap.
  if exists (
    select 1
      from public.payroll_runs r
     where r.org_id = p_org
       and not exists (
         select 1 from public.payroll_run_lines l where l.run_id = r.id and l.org_id = p_org
       )
  ) then
    raise exception 'payroll workspace contains a closed run with no stored lines' using errcode = '23514';
  end if;

  -- Reconciliation: a run's frozen total_gross must equal the sum of its own frozen lines. Both are
  -- written together in one statement at close time and neither is ever touched again, so any drift
  -- can only be corruption.
  if exists (
    select 1
      from public.payroll_runs r
      left join (
        select run_id, coalesce(pg_catalog.sum(gross), 0) as line_total
          from public.payroll_run_lines
         where org_id = p_org
         group by run_id
      ) totals on totals.run_id = r.id
     where r.org_id = p_org
       and r.total_gross <> coalesce(totals.line_total, 0)
  ) then
    raise exception 'payroll workspace total_gross does not reconcile with its stored lines' using errcode = '23514';
  end if;

  with
  runs as materialized (
    select r.id, r.period_start, r.period_end, r.closed_at, r.total_gross
      from public.payroll_runs r
     where r.org_id = p_org
  ),
  line_counts as (
    select run_id, pg_catalog.count(*)::bigint as line_count
      from public.payroll_run_lines
     where org_id = p_org
     group by run_id
  ),
  totals as (
    select pg_catalog.count(*)::bigint as total_runs,
           coalesce(pg_catalog.sum(total_gross), 0) as total_gross
      from runs
  ),
  -- Deterministic total order: most recently closed period first, id as the final tiebreak — what
  -- makes limit/offset paging correct rather than merely plausible.
  page as materialized (
    select r.*, coalesce(lc.line_count, 0) as line_count
      from runs r
      left join line_counts lc on lc.run_id = r.id
     order by r.period_start desc, r.period_end desc, r.id desc
     limit p_limit offset p_offset
  ),
  authority as (
    select jsonb_object_agg(a.domain, a.status) as statuses
      from public.data_authority_status a
     where a.org_id = p_org and a.domain = 'payroll'
  )
  select jsonb_build_object(
    'version', 'farm-os.payroll-workspace.v1',
    'org_id', p_org,
    'limit', p_limit,
    'offset', p_offset,
    'authority', coalesce((select statuses from authority), '{}'::jsonb),
    -- Exact recorded totals, kept strictly separate from the bounded page below.
    'counts', jsonb_build_object(
      'total_runs', (select total_runs::text from totals)
    ),
    'totals', jsonb_build_object(
      'total_gross', (select total_gross::text from totals)
    ),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'run_id', p.id::text,
          'period_start', p.period_start::text,
          'period_end', p.period_end::text,
          'closed_at', p.closed_at::text,
          'total_gross', p.total_gross::text,
          'line_count', p.line_count::text
        )
        order by p.period_start desc, p.period_end desc, p.id desc
      ) from page p
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.fn_payroll_workspace_snapshot(uuid, integer, integer) from public;
revoke all on function public.fn_payroll_workspace_snapshot(uuid, integer, integer) from anon;
grant execute on function public.fn_payroll_workspace_snapshot(uuid, integer, integer) to authenticated;

comment on function public.fn_payroll_workspace_snapshot(uuid, integer, integer) is
  'Exact bounded payroll run history for the active organization: an exact run count and exact total gross published separately from one deterministically ordered limit/offset page of runs. Reads only the frozen payroll_runs/payroll_run_lines columns (never recomputed from a current rate) and fails closed (23514) on a cross-org line reference, a closed run with zero stored lines, or a total_gross/line-sum reconciliation drift.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 2) EXACT PAYROLL RUN SNAPSHOT — one closed run's frozen detail, bounded and exactly counted
-- ───────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_payroll_run_snapshot(
  p_org uuid,
  p_run_id uuid,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_active_org uuid;
  v_run record;
  v_line_total numeric;
  v_result jsonb;
begin
  if p_org is null or p_run_id is null then
    raise exception 'organization and payroll run are required' using errcode = '23502';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'payroll run line limit must be between 1 and 50' using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 1000000 then
    raise exception 'payroll run line offset is out of range' using errcode = '22023';
  end if;

  begin
    v_active_org := nullif(
      nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'active_org_id',
      ''
    )::uuid;
  exception when others then
    raise exception 'forbidden: invalid active organization claim' using errcode = '42501';
  end;

  if v_uid is null or v_active_org is null or v_active_org is distinct from p_org then
    raise exception 'forbidden: the payroll run requires the active organization' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_member m where m.user_id = v_uid and m.org_id = p_org
  ) then
    raise exception 'forbidden: organization membership is required' using errcode = '42501';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: organization is outside the active scope' using errcode = '42501';
  end if;
  if not public.authorize('payroll.read', p_org) then
    raise exception 'forbidden: payroll.read (owner/accountant) is required' using errcode = '42501';
  end if;

  -- A run outside the active organization is NOT FOUND, not forbidden — and a run id that exists
  -- nowhere at all reads exactly the same: the caller must not learn from the error whether another
  -- organization happens to own that id (mirrors fn_inventory_item_snapshot).
  select r.id, r.period_start, r.period_end, r.closed_at, r.total_gross
    into v_run
    from public.payroll_runs r
   where r.id = p_run_id and r.org_id = p_org;
  if v_run.id is null then
    return null;
  end if;

  -- Relationship integrity, forward direction only, scoped to this one run — see the workspace
  -- snapshot's own note above.
  if exists (
    select 1 from public.payroll_run_lines l
    left join public.people p on p.id = l.person_id and p.org_id = p_org
    where l.run_id = p_run_id and l.org_id = p_org and p.id is null
  ) then
    raise exception 'payroll run organization relationship mismatch' using errcode = '23514';
  end if;

  -- A closed run with no stored lines is corruption, never a valid zero run — see the header's A
  -- CLOSED RUN WITH ZERO LINES note. Checked before reconciliation, because an empty run's
  -- total_gross = 0 would otherwise reconcile trivially against zero lines and hide the gap.
  if not exists (
    select 1 from public.payroll_run_lines where run_id = p_run_id and org_id = p_org
  ) then
    raise exception 'payroll run has no stored lines' using errcode = '23514';
  end if;

  select coalesce(pg_catalog.sum(gross), 0) into v_line_total
    from public.payroll_run_lines
   where run_id = p_run_id and org_id = p_org;
  if v_run.total_gross <> v_line_total then
    raise exception 'payroll run total_gross does not reconcile with its stored lines' using errcode = '23514';
  end if;

  with
  lines as materialized (
    select l.id, l.person_id, l.person_name_snapshot as person_name,
           l.mode, l.unit, l.quantity, l.rate, l.gross
      from public.payroll_run_lines l
     where l.run_id = p_run_id and l.org_id = p_org
  ),
  totals as (
    select pg_catalog.count(*)::bigint as total_lines from lines
  ),
  -- Deterministic total order: person name, then mode, then unit (coalesced so NULL never breaks the
  -- tie silently), id as the final tiebreak.
  page as materialized (
    select *
      from lines
     order by person_name, mode, coalesce(unit, ''), id
     limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'version', 'farm-os.payroll-run.v1',
    'org_id', p_org,
    'run_id', p_run_id,
    'period_start', v_run.period_start::text,
    'period_end', v_run.period_end::text,
    'closed_at', v_run.closed_at::text,
    'total_gross', v_run.total_gross::text,
    'limit', p_limit,
    'offset', p_offset,
    -- Exact recorded line count, kept strictly separate from the bounded page below.
    'counts', jsonb_build_object(
      'total_lines', (select total_lines::text from totals)
    ),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'line_id', pg.id::text,
          'person_id', pg.person_id::text,
          'person_name', pg.person_name,
          'mode', pg.mode,
          'unit', pg.unit,
          'quantity', pg.quantity::text,
          'rate', pg.rate::text,
          'gross', pg.gross::text
        )
        order by pg.person_name, pg.mode, coalesce(pg.unit, ''), pg.id
      ) from page pg
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.fn_payroll_run_snapshot(uuid, uuid, integer, integer) from public;
revoke all on function public.fn_payroll_run_snapshot(uuid, uuid, integer, integer) from anon;
grant execute on function public.fn_payroll_run_snapshot(uuid, uuid, integer, integer) to authenticated;

comment on function public.fn_payroll_run_snapshot(uuid, uuid, integer, integer) is
  'Exact bounded detail for one closed payroll run: stored close-time identity and frozen totals, an exact line count published separately from one deterministically ordered limit/offset page of frozen lines (person-name snapshot only — no contact PII, no closer identity). Returns null when the run is outside the active organization or does not exist, so the two are indistinguishable. Reads only stored/frozen values (never current people.name and never recomputed from a current rate) and fails closed (23514) on a cross-org line reference, zero stored lines, or a total_gross/line-sum reconciliation drift.';

commit;
