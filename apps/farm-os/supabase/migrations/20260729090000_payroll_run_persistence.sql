-- Farm OS — SPEC-0006 slice 3: payroll persistence + reporting kernel (synthetic data only).
--
-- RATIFIED (Owner, 2026-06-27) — build proceeds on SYNTHETIC data; real staff PII stays behind the
-- Stage-M privacy review (unchanged by this migration). Companion issues: #388 (wage-model decision
-- memo — mixed hourly/daily/piece/seasonal, no fabricated rates, "store only scopes supported by real
-- FKs") and #394 (independent access-design review — CONC-1 concurrent-close hardening, need-to-know
-- PII left as-is, AI exclusion, payroll-run audit gate). NO PAYMENT EXECUTION: this closes a period and
-- snapshots gross pay for reporting; it moves no money and posts no journal.
--
-- SCOPE DECISION (#388 §"Data-model implication", narrowed to "real existing foreign keys" per this
-- slice's mandate). The memo's rate-resolution key suggestion was (person, crew?, crop/variety?,
-- task/phase?). `crew` is free text only (labor_logs.team_name, no table) — excluded, and a free-text
-- crew labor row FAILS payroll close outright (see below), it is never priced. `crop/variety`/
-- `task/phase` have no reliable FK from labor_logs today (plan_op_id is nullable and unpopulated by the
-- current UI — see 20260701310000's own header note). The only real, always-populated FK is
-- `person_id`. This slice therefore resolves compensation by (person_id, mode[, unit]) — a person may
-- hold one rate per mode (hourly/daily/seasonal) plus one rate per (mode='piece', unit) pair, letting
-- modes legitimately MIX for the same worker in one period (#388 point 5) without inventing a scope key
-- no table backs yet. A future slice may add a plan_op_id-scoped override once the UI actually populates
-- it; it is out of scope here.
--
-- MODES (additive, backward compatible):
--   hourly   — gross = Σ(hours) × rate                     (existing engine, UNCHANGED)
--   daily    — gross = (# DISTINCT work_date rows logged) × rate (one row = one day present; if a
--              person has more than one labor_logs row for the SAME work_date — e.g. two tasks in a
--              day — that day still counts ONCE, never inflating the day count)
--   piece    — gross = Σ(quantity) × rate, keyed by unit ∈ {tree,box,crate,kg,bucket,bin,row} (#388 pt.4)
--   seasonal — gross = rate, ONCE per person, paid ONLY when the close period is an EXACT match to the
--              rate's own declared contract_period_start/contract_period_end (people_compensation, new
--              columns below) — never inferred from cadence/overlap. A seasonal rate with no exact-period
--              match for the requested close is treated exactly like a missing rate (fail-closed, #394
--              addendum: "seasonal must carry explicit contract bounds, close on the exact declared
--              period only").
-- `labor_logs.hours` stays NOT NULL for every row regardless of mode (attendance is always recorded);
-- `mode`/`quantity`/`unit` are ADDITIVE columns defaulting to 'hourly'/null/null, so every existing row
-- (and every existing people_compensation row) is reinterpreted as an hourly line with NO DATA CHANGE —
-- "preserve existing compensation and hourly labor rows safely".
--
-- FAIL-CLOSED (never fabricates, never partially closes):
--   - missing/invalid rate (null, zero, negative, or no people_compensation row for the resolved
--     (person,mode[,unit]) key) aborts the WHOLE close — zero rows are ever written (defense-in-depth:
--     validation runs to completion BEFORE the first write; see the "claim-first" ordering below).
--   - ambiguous rate is structurally impossible: partial unique indexes on people_compensation forbid a
--     second active rate for the same (person,mode) / (person,mode,unit) key (tested directly).
--   - free-text crews (labor_logs.team_name, person_id null) abort the whole close — there is no scope
--     key to resolve a rate against an unregistered crew.
--   - unsupported units are rejected by a CHECK constraint at INSERT time on both labor_logs and
--     people_compensation (defense-in-depth: also impossible to reach the close RPC).
--   - period errors (null bound, start after end) and empty input (zero labor_logs rows in the org+
--     period) abort before any write.
--   - cross-org references (a labor_logs row whose person_id resolves to a DIFFERENT org's people row —
--     only reachable by bypassing the existing RLS/guard write path, e.g. a service-role bulk insert)
--     are re-verified defensively inside the close RPC itself, which never trusts an upstream guard
--     alone for money-adjacent data (mirrors the reconciliation baseline tables' own re-verification
--     posture, 20260726090000).
--
-- CONCURRENCY (#394 note A — the CONC-1 lesson: idempotent-on-replay is not enough, a concurrent pair
-- must not double-write, and — #394 follow-up — two DIFFERENT-but-overlapping periods for the same org
-- must serialize too, not just two callers of the exact same period). `fn_close_payroll_run` takes a
-- PER-ORG advisory transaction lock, EXCLUSIVE (private.fn_payroll_run_mutex_key(p_org), md5-derived
-- exactly like 20260726170000's accounting-period mutex — md5 over the org uuid alone, because its
-- output is algorithm-defined, not a server-version implementation detail), IMMEDIATELY after the
-- org/role checks and BEFORE reading whether a run already exists. Scoping the lock to the ORG (not
-- org+period) is deliberate: two concurrent closes for the SAME org — whether for the identical period or
-- for two merely-OVERLAPPING periods — always serialize on the same key, so the second caller only ever
-- decides its exact-match/overlap fate against a fully-committed (or fully-rolled-back) first attempt,
-- never a half-written one. A concurrent second caller for the SAME org blocks on that lock until the
-- first commits or rolls back, then either (a) sees the first's committed run for the EXACT same period
-- and replays it — never recomputes, never double-inserts — or (b) sees it OVERLAPS a different period
-- the first just closed and is rejected (23505, see OVERLAP note below), or (c) proceeds normally if there
-- is no overlap at all. The unique constraint on payroll_runs(org_id, period_start, period_end) is a
-- second, independent backstop (claim-first via `insert ... on conflict do nothing returning id`) in case
-- any future code path ever reaches the insert without holding the mutex.
--
-- OVERLAP (#394 follow-up — "reject overlapping closed periods while exact replay stays idempotent").
-- After the exact-match idempotent-replay check (and only if it did NOT find a run), a second check
-- rejects any period that overlaps (daterange &&) an EXISTING closed run for the same org that is not
-- byte-identical to the requested period — e.g. closing Feb 10-20 after Feb 1-15 was already closed is
-- refused outright (23505), because the overlapping days were already priced into the first run and
-- pricing them again would double-pay. Only a period with NO overlap at all, or the exact same period
-- (idempotent replay, handled above), is ever allowed past this point. Both checks run under the SAME
-- per-org EXCLUSIVE mutex acquired above, so two concurrent closers proposing overlapping-but-different
-- periods cannot both pass this check — the second one always sees the first's commit before deciding.
--
-- LABOR-WRITE COORDINATION (#394 follow-up — "coordinate labor writes with close so late writes cannot
-- escape"). The SAME per-org mutex is the join point with `labor_logs` writes: `fn_guard_labor_log_
-- payroll_freeze` (attached to labor_logs as a BEFORE INSERT/UPDATE/DELETE trigger, section 7 below)
-- takes the identical key in SHARE mode before deciding whether the row it is about to write is covered
-- by an already-closed period — the exact SHARE/EXCLUSIVE money-writer/period-writer contract
-- 20260726170000 established for the accounting ledger (§0 there), reused verbatim here. EXCLUSIVE
-- conflicts with every SHARE holder, so `fn_close_payroll_run` cannot commit while any labor_logs write
-- transaction for that org is still open, and no labor_logs write can proceed past its freeze check while
-- a close is in flight. A labor write that starts before the close's EXCLUSIVE acquisition either commits
-- first (and is therefore included in the close's aggregation, since every statement after the lock
-- acquisition reads a fresh, post-commit snapshot) or blocks until the close finishes and is THEN rejected
-- by the freeze check (the period is closed by the time it re-checks) — there is no third outcome where a
-- late write both succeeds and escapes the closed snapshot.
--
-- CROSS-ORG UPDATE, LOCKED AND CHECKED PER-ROW-PER-ORG (byte review fix). A single `labor_logs` row's
-- OLD and NEW state can belong to DIFFERENT orgs only on an UPDATE that itself rewrites `org_id` (e.g. a
-- privileged/service-role correction that moves a row between tenants) — `v_org := coalesce(new.org_id,
-- old.org_id)` in an earlier draft collapsed both checks onto a SINGLE org (NEW's, since coalesce prefers
-- the non-null first argument), so the OLD row's own work_date was checked against the NEW org's closed
-- periods instead of its own. A row sitting inside org A's already-closed period could then be "moved" to
-- org B (which has no closed run for that date) in one UPDATE and walk straight out of the freeze — the
-- OLD-row half of the check never actually ran against the org that closed it. The fix: the trigger takes
-- the per-org mutex SHARE for BOTH `old.org_id` and `new.org_id` when they differ (deterministic UUID
-- order — `old.org_id`/`new.org_id`, smaller first — so two concurrent triggers moving rows in opposite
-- org directions can never form a lock-order cycle; SHARE never conflicts with SHARE either way, so this
-- is defense-in-depth, not a live deadlock hazard today), and then checks the OLD row's work_date against
-- payroll_runs scoped to `old.org_id` and the NEW row's work_date against payroll_runs scoped to
-- `new.org_id` — never a coalesced/blended org for either half. An ordinary same-org write only ever
-- takes one lock and runs one org-scoped check per direction, unchanged from before. Regression-tested
-- below: a superuser-privileged UPDATE that moves a row out of org A's closed Feb1-7 period into an
-- org with no closed run for that date is rejected, and the row is left completely unchanged.
--
-- COMPENSATION-WRITE COORDINATION (byte review fix — "a run cannot mix old/new rates across loop
-- statements"). `fn_close_payroll_run`'s aggregation loop (section 10) issues ONE `select ... into v_rate
-- from people_compensation` per (person,mode[,unit]) line, and each of those is its OWN statement — under
-- READ COMMITTED, each takes its own fresh snapshot, so WITHOUT coordination a `people_compensation` rate
-- UPDATE that commits midway through the loop (between two lines' SELECTs) could be visible for some
-- lines of the SAME run and not others, silently mixing an old and a new rate inside one snapshot.
-- `fn_guard_people_compensation_payroll_coordination` (an internal BEFORE INSERT/UPDATE/DELETE trigger on
-- people_compensation, section 3B below) closes this the same way section 7's freeze trigger closes the
-- labor-write gap: it takes the SAME per-org mutex SHARE (both old/new org, same deterministic order,
-- when a mutation's org changes) before its rate mutation is allowed to proceed. Because
-- `fn_close_payroll_run` takes the mutex EXCLUSIVE before its aggregation loop even starts, EVERY
-- people_compensation mutation transaction that is already open at that moment must commit or roll back
-- FIRST (SHARE blocks the EXCLUSIVE acquisition), and no NEW mutation can start once EXCLUSIVE is held
-- (its own trigger's SHARE acquisition blocks in turn) until the close finishes. The entire aggregation
-- loop therefore always runs against ONE fully-committed-or-fully-rolled-back compensation snapshot, never
-- a torn mix of old and new rates across its own statements. Unlike the labor freeze trigger, this one
-- raises NO exception and reads no payroll_runs row at all — "COMPENSATION MUTATION CONSISTENCY" above is
-- unchanged: a rate/contract-bounds edit remains freely allowed at any time, including immediately after a
-- close, and can only ever affect a FUTURE close (regression-tested below with a real two-session race:
-- an in-flight rate UPDATE is proved to block a concurrent close on the shared mutex, the close is proved
-- to price against the UPDATE's fully-committed value once it lands, and a further rate edit issued AFTER
-- the close is proved to leave the already-frozen snapshot line untouched).
--
-- IMMUTABILITY. Once a payroll_runs/payroll_run_lines row exists it can never be updated or deleted, by
-- any role including the table owner — the "closed payroll run and immutable snapshot lines" the spec
-- requires — enforced by an unconditional BEFORE UPDATE OR DELETE trigger, the same shape as the
-- reconciliation baseline tables' frozen-row hardening (20260726083000 / 20260726090000).
--
-- FREEZE (#394 follow-up — "freeze labor_logs covered by a closed period against insert/update/delete").
-- `fn_guard_labor_log_payroll_freeze` (BEFORE INSERT OR UPDATE OR DELETE on labor_logs, section 7 below)
-- rejects any insert/update/delete whose OLD or NEW row's work_date falls inside a period this org has
-- already closed — a labor_logs row already priced into a closed run can never be edited or removed out
-- from under it, and no new row can be back-dated into a period that is already closed. This is
-- independent of, and layered UNDER, the per-org SHARE/EXCLUSIVE mutex described above (LABOR-WRITE
-- COORDINATION) that handles the concurrent, in-flight case; this trigger handles the sequential case —
-- any write attempted strictly AFTER a close has committed.
--
-- COMPENSATION MUTATION CONSISTENCY. people_compensation rows (rate, contract_period_start/end) remain
-- freely updatable by owner/accountant (comp_rw, unchanged) at any time, including after a payroll run
-- has closed against them — this is safe BY CONSTRUCTION, never by a new guard, because
-- payroll_run_lines snapshots mode/rate/quantity/unit/gross as its own frozen columns at close time and
-- never re-reads people_compensation afterward (private.fn_payroll_run_report, section 10, joins only
-- payroll_run_lines). A later rate/contract-bounds edit therefore can only affect a FUTURE close, never
-- a past one (regression-tested below).
--
-- CONFIDENTIALITY. Both new tables: FORCE RLS, SELECT gated on authorize('payroll.read', org_id)
-- (owner/accountant only, the exact SPEC-0006 role set — no new permission is introduced; re-emitting
-- authorize() only to add a redundant permission would risk silently dropping one of the 19 existing
-- branches, so it is NOT re-emitted here). No INSERT/UPDATE/DELETE grant to any client role — the ONLY
-- write path is this migration's SECURITY DEFINER RPC. Audit: audit_log rows for 'payroll_run' /
-- 'payroll_run_line' are folded into the SAME confidential branch as 'people_compensation' in the
-- audit_read policy (re-emitted below, every existing branch preserved verbatim — #394 note D). AI/
-- export exposure: lib/assistant-policy.ts's SENSITIVE regex already matches `/payroll/i`, so
-- `fn_close_payroll_run`/`payroll_runs`/`payroll_run_lines` are refused by construction (pinned by a new
-- lib/assistant-policy.test.ts case, no source change needed); no export descriptor/registry references
-- payroll anywhere in the repo (verified) and none is added here.
--
-- ROLLBACK RUNBOOK (exact, additive-only against people_compensation/labor_logs so a rollback of the new
-- objects returns both tables to their pre-migration shape with NO existing row altered):
--   begin;
--   alter policy audit_read on public.audit_log using ( <20260725201546's exact body, unchanged> );
--   drop trigger if exists audit_payroll_run_line on public.payroll_run_lines;
--   drop trigger if exists audit_payroll_run on public.payroll_runs;
--   drop trigger if exists guard_payroll_run_line_tenant on public.payroll_run_lines;
--   drop trigger if exists immutable_payroll_run_lines on public.payroll_run_lines;
--   drop trigger if exists immutable_payroll_runs on public.payroll_runs;
--   drop trigger if exists guard_labor_log_payroll_freeze on public.labor_logs;
--   drop function if exists public.fn_guard_labor_log_payroll_freeze();
--   drop trigger if exists guard_people_compensation_payroll_coordination on public.people_compensation;
--   drop function if exists public.fn_guard_people_compensation_payroll_coordination();
--   drop function if exists public.fn_close_payroll_run(uuid, date, date);
--   drop function if exists private.fn_payroll_run_report(uuid);
--   drop function if exists private.fn_payroll_run_mutex_key(uuid);
--   drop function if exists public.fn_guard_payroll_run_line_tenant();
--   drop function if exists public.fn_immutable_payroll_row();
--   drop table if exists public.payroll_run_lines;
--   drop table if exists public.payroll_runs;
--   alter table public.labor_logs drop constraint if exists labor_logs_piece_shape;
--   alter table public.labor_logs drop constraint if exists labor_logs_unit_check;
--   alter table public.labor_logs drop constraint if exists labor_logs_mode_check;
--   alter table public.labor_logs drop column if exists unit;
--   alter table public.labor_logs drop column if exists quantity;
--   alter table public.labor_logs drop column if exists mode;
--   alter table public.people_compensation drop constraint if exists people_compensation_seasonal_period_valid;
--   alter table public.people_compensation drop constraint if exists people_compensation_seasonal_shape;
--   alter table public.people_compensation drop constraint if exists people_compensation_piece_shape;
--   alter table public.people_compensation drop constraint if exists people_compensation_unit_check;
--   alter table public.people_compensation drop constraint if exists people_compensation_mode_check;
--   drop index if exists public.people_compensation_person_mode_unit_uq;
--   drop index if exists public.people_compensation_person_mode_uq;
--   alter table public.people_compensation drop column if exists contract_period_end;
--   alter table public.people_compensation drop column if exists contract_period_start;
--   alter table public.people_compensation drop column if exists unit;
--   alter table public.people_compensation drop column if exists mode;
--   commit;
-- A fresh DB after this rollback is byte-identical to one with only 20260701310000/20260622000046
-- applied; every statement above is additive-DDL-reversal only, no existing row is touched.

begin;

-- ── 1) people_compensation — additive mode/unit columns (#388: hourly/daily/piece/seasonal). Existing
--    rows default to mode='hourly', unit=null — semantically IDENTICAL to their pre-migration meaning
--    (a single per-person rate, used exactly as lib/payroll.ts's computePayroll already treats it). ────
alter table public.people_compensation add column if not exists mode text not null default 'hourly';
alter table public.people_compensation
  drop constraint if exists people_compensation_mode_check;
alter table public.people_compensation
  add constraint people_compensation_mode_check
  check (mode in ('hourly', 'daily', 'piece', 'seasonal'));

alter table public.people_compensation add column if not exists unit text;
alter table public.people_compensation
  drop constraint if exists people_compensation_unit_check;
alter table public.people_compensation
  add constraint people_compensation_unit_check
  check (unit is null or unit in ('tree', 'box', 'crate', 'kg', 'bucket', 'bin', 'row'));

-- unit is set iff mode = 'piece' (a piece rate is meaningless without its unit; every other mode has no
-- unit at all — the rate itself already means "per hour" / "per day" / "per period").
alter table public.people_compensation
  drop constraint if exists people_compensation_piece_shape;
alter table public.people_compensation
  add constraint people_compensation_piece_shape
  check ((mode = 'piece') = (unit is not null));

-- contract_period_start/end are set iff mode = 'seasonal' (#394 follow-up: "seasonal rates must carry
-- explicit contract period bounds"). A seasonal rate is a fixed contract amount for ONE declared
-- calendar span — fn_close_payroll_run (section 10) resolves it ONLY when the close's own period is an
-- EXACT match to these bounds, never by inferring "the close period overlaps/fits inside the contract" —
-- so a mismatched close treats the rate as missing (fail-closed) rather than guessing a cadence.
alter table public.people_compensation add column if not exists contract_period_start date;
alter table public.people_compensation add column if not exists contract_period_end date;
alter table public.people_compensation
  drop constraint if exists people_compensation_seasonal_shape;
alter table public.people_compensation
  add constraint people_compensation_seasonal_shape
  check ((mode = 'seasonal') = (contract_period_start is not null and contract_period_end is not null));
alter table public.people_compensation
  drop constraint if exists people_compensation_seasonal_period_valid;
alter table public.people_compensation
  add constraint people_compensation_seasonal_period_valid
  check (contract_period_start is null or contract_period_end is null
         or contract_period_start <= contract_period_end);

-- one active rate per (person, mode) for every non-piece mode, and one per (person, mode, unit) for
-- piece (a person may be paid per-tree AND per-box in the same period). This is what makes "ambiguous
-- rate" structurally impossible — a second conflicting insert throws 23505, never silently picked one.
create unique index if not exists people_compensation_person_mode_uq
  on public.people_compensation(person_id, mode) where mode <> 'piece';
create unique index if not exists people_compensation_person_mode_unit_uq
  on public.people_compensation(person_id, mode, unit) where mode = 'piece';

-- ── 2) labor_logs — additive mode/quantity/unit columns. `hours` stays NOT NULL/unchanged for every
--    row (attendance is always recorded regardless of pay mode); quantity/unit are populated ONLY for
--    mode='piece' (the unit the piece count is measured in). Existing rows default to mode='hourly',
--    quantity=null, unit=null — an EXACT reinterpretation of their pre-migration meaning. ──────────────
alter table public.labor_logs add column if not exists mode text not null default 'hourly';
alter table public.labor_logs
  drop constraint if exists labor_logs_mode_check;
alter table public.labor_logs
  add constraint labor_logs_mode_check
  check (mode in ('hourly', 'daily', 'piece', 'seasonal'));

alter table public.labor_logs add column if not exists quantity numeric;
alter table public.labor_logs add column if not exists unit text;
alter table public.labor_logs
  drop constraint if exists labor_logs_unit_check;
alter table public.labor_logs
  add constraint labor_logs_unit_check
  check (unit is null or unit in ('tree', 'box', 'crate', 'kg', 'bucket', 'bin', 'row'));

alter table public.labor_logs
  drop constraint if exists labor_logs_piece_shape;
alter table public.labor_logs
  add constraint labor_logs_piece_shape
  check (
    (mode = 'piece' and quantity is not null and quantity > 0 and unit is not null)
    or (mode <> 'piece' and quantity is null and unit is null)
  );

-- ── 3) THE PER-ORG PAYROLL MUTEX — defined early (payroll_runs doesn't exist yet, but the key derives
--    from the org uuid alone, so it needs no table). Reused by BOTH `fn_close_payroll_run` (EXCLUSIVE,
--    section 10) and the labor_logs freeze trigger (SHARE, section 7) — the exact SHARE/EXCLUSIVE money-
--    writer/period-writer contract 20260726170000 established for the accounting ledger (its §0), reused
--    verbatim here: money writers (labor_logs inserts/updates/deletes) take SHARE — share never conflicts
--    with share, so ordinary concurrent labor logging is exactly as parallel as before this migration —
--    and the period writer (fn_close_payroll_run) takes EXCLUSIVE, which conflicts with every SHARE
--    holder. That is what makes "coordinate labor writes with close so late writes cannot escape" true: a
--    close cannot commit while any labor write for that org is still open, and no labor write can proceed
--    past its freeze check while a close is in flight. It is a TRANSACTION lock (`pg_advisory_xact_lock*`),
--    released by COMMIT or ROLLBACK with no unlock call, so an aborted caller can never strand it.
--    `pg_catalog`-qualified so an empty search_path cannot be tricked into resolving a shadowing function.
--    md5-derived (not hashtext) because its output is algorithm-defined, not a server-version detail.
create or replace function private.fn_payroll_run_mutex_key(p_org uuid)
returns bigint
language sql
immutable
parallel safe
set search_path = ''
as $$
  select ('x' || pg_catalog.substr(pg_catalog.md5(p_org::text), 1, 16))::bit(64)::bigint;
$$;
revoke execute on function private.fn_payroll_run_mutex_key(uuid) from public, anon, authenticated;
comment on function private.fn_payroll_run_mutex_key(uuid) is
  'Deterministic per-organization advisory-lock key (org UUID alone). labor_logs writes take it SHARE '
  '(fn_guard_labor_log_payroll_freeze); fn_close_payroll_run takes it EXCLUSIVE. #394 follow-up.';

-- ── 3B) people_compensation CLOSE COORDINATION (byte review fix — see the header's COMPENSATION-WRITE
--    COORDINATION note). Internal BEFORE INSERT/UPDATE/DELETE trigger that takes the SAME per-org mutex
--    SHARE `fn_guard_labor_log_payroll_freeze` takes, purely to serialize with `fn_close_payroll_run`'s
--    EXCLUSIVE acquisition — it raises NO exception and never reads payroll_runs, so it does NOT freeze
--    rate edits, before or after a close. Both OLD and NEW org are locked, deterministic (smaller-uuid-
--    first) order, exactly like the labor freeze trigger's own cross-org fix, for the same defense-in-
--    depth reason. SECURITY DEFINER + empty search_path (ADR-0006); no client EXECUTE — internal choke
--    point only, never called directly. ──────────────────────────────────────────────────────────────────
create or replace function public.fn_guard_people_compensation_payroll_coordination()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lock_org_1 uuid;
  v_lock_org_2 uuid;
begin
  if tg_op = 'DELETE' then
    v_lock_org_1 := old.org_id;
  elsif tg_op = 'INSERT' then
    v_lock_org_1 := new.org_id;
  elsif old.org_id = new.org_id then
    v_lock_org_1 := old.org_id;
  elsif old.org_id < new.org_id then
    v_lock_org_1 := old.org_id;
    v_lock_org_2 := new.org_id;
  else
    v_lock_org_1 := new.org_id;
    v_lock_org_2 := old.org_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(private.fn_payroll_run_mutex_key(v_lock_org_1));
  if v_lock_org_2 is not null then
    perform pg_catalog.pg_advisory_xact_lock_shared(private.fn_payroll_run_mutex_key(v_lock_org_2));
  end if;

  return coalesce(new, old);
end;
$$;
revoke execute on function public.fn_guard_people_compensation_payroll_coordination()
  from public, anon, authenticated;
create trigger guard_people_compensation_payroll_coordination
  before insert or update or delete on public.people_compensation
  for each row execute function public.fn_guard_people_compensation_payroll_coordination();

-- ── 4) payroll_runs — one row per CLOSED (org, period); immutable once written. `unique(id, org_id)`
--    supports the composite tenant FK from payroll_run_lines (the repo's established pattern, e.g.
--    20260726090000's reconciliation_batch_rows_id_org_id_uq). `unique(org_id, period_start,
--    period_end)` is the claim-first backstop the CONCURRENCY note above describes. ────────────────────
create table public.payroll_runs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organization(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  closed_by    uuid references auth.users(id),
  closed_at    timestamptz not null default now(),
  total_gross  numeric not null default 0 check (total_gross >= 0),
  constraint payroll_runs_period_valid check (period_start <= period_end),
  constraint payroll_runs_id_org_id_uq unique (id, org_id),
  constraint payroll_runs_org_period_uq unique (org_id, period_start, period_end)
);
create index payroll_runs_closed_by_idx on public.payroll_runs(closed_by);

alter table public.payroll_runs enable row level security;
alter table public.payroll_runs force  row level security;
create policy payroll_read on public.payroll_runs for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('payroll.read', org_id));
grant select on public.payroll_runs to authenticated;

-- ── 5) payroll_run_lines — one immutable snapshot line per (run, person, mode[, unit]). Composite
--    tenant FK to payroll_runs (run_id, org_id); plain FK to people (no cascade — a closed financial
--    snapshot must never silently disappear if a person row is ever removed) with a guard trigger below
--    proving same-org (mirrors labor_logs' own person_id guard, 20260701310000, since people carries no
--    supporting unique(id,org_id) anywhere in this schema yet). `gross = round(quantity*rate,2)` is
--    pinned as a CHECK, not just an RPC-time computation — "snapshot mode/rate/quantity/unit/gross
--    exactly" is a stored invariant, not merely an application promise. ─────────────────────────────────
create table public.payroll_run_lines (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organization(id) on delete cascade,
  run_id     uuid not null,
  person_id  uuid not null references public.people(id),
  mode       text not null check (mode in ('hourly', 'daily', 'piece', 'seasonal')),
  unit       text check (unit is null or unit in ('tree', 'box', 'crate', 'kg', 'bucket', 'bin', 'row')),
  quantity   numeric not null check (quantity > 0),
  rate       numeric not null check (rate > 0),
  gross      numeric not null check (gross >= 0),
  constraint payroll_run_lines_run_tenant_fk
    foreign key (run_id, org_id) references public.payroll_runs(id, org_id),
  constraint payroll_run_lines_piece_shape check ((mode = 'piece') = (unit is not null)),
  constraint payroll_run_lines_gross_exact check (gross = round(quantity * rate, 2))
);
-- one line per (run, person, mode, unit) — coalesce normalizes NULL unit so two hourly lines for the
-- same person in the same run can never silently coexist (Postgres treats NULL <> NULL in a plain
-- UNIQUE constraint; this index closes that gap).
create unique index payroll_run_lines_run_person_mode_unit_uq
  on public.payroll_run_lines(run_id, person_id, mode, coalesce(unit, ''));
create index payroll_run_lines_org_idx on public.payroll_run_lines(org_id);
create index payroll_run_lines_run_org_idx on public.payroll_run_lines(run_id, org_id);
create index payroll_run_lines_person_idx on public.payroll_run_lines(person_id);

create or replace function public.fn_guard_payroll_run_line_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.people p where p.id = new.person_id and p.org_id = new.org_id
  ) then
    raise exception 'payroll_run_lines: person_id belongs to another organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_guard_payroll_run_line_tenant() from public, anon, authenticated;
create trigger guard_payroll_run_line_tenant
  before insert on public.payroll_run_lines
  for each row execute function public.fn_guard_payroll_run_line_tenant();

alter table public.payroll_run_lines enable row level security;
alter table public.payroll_run_lines force  row level security;
create policy payroll_read on public.payroll_run_lines for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('payroll.read', org_id));
grant select on public.payroll_run_lines to authenticated;

-- ── 6) immutability, enforced through privileged paths too (FORCE RLS alone would not stop a
--    SECURITY DEFINER function owned by a bypassrls role) — mirrors the reconciliation baseline tables'
--    frozen-row hardening (20260726090000/20260726083000). Neither table has a bookkeeping-column
--    carve-out: every column is provenance, so ANY update or delete is rejected outright. ──────────────
create or replace function public.fn_immutable_payroll_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% rows are immutable and cannot be deleted', tg_table_name using errcode = '22023';
  end if;
  raise exception '% rows are immutable and cannot be updated', tg_table_name using errcode = '22023';
end;
$$;
revoke execute on function public.fn_immutable_payroll_row() from public, anon, authenticated;
create trigger immutable_payroll_runs
  before update or delete on public.payroll_runs
  for each row execute function public.fn_immutable_payroll_row();
create trigger immutable_payroll_run_lines
  before update or delete on public.payroll_run_lines
  for each row execute function public.fn_immutable_payroll_row();

-- ── 7) labor_logs FREEZE (#394 follow-up — "freeze labor_logs covered by a closed period against
--    insert/update/delete and coordinate labor writes with close so late writes cannot escape"). A
--    labor_logs row whose work_date falls inside a period this org has already closed can never be
--    inserted, updated, or deleted — checked against BOTH the OLD row (covers UPDATE/DELETE of an
--    already-priced row) and the NEW row (covers INSERT of a back-dated row, and UPDATE moving a row's
--    own work_date INTO a closed range). Takes the per-org mutex (section 3) in SHARE mode FIRST, before
--    its own read of payroll_runs — the SAME key `fn_close_payroll_run` takes EXCLUSIVE, so this check and
--    a concurrent close always serialize: either this write's transaction commits first and is included
--    in the close's aggregation, or it blocks until the close commits and is then rejected here (the
--    period is closed by the time it re-checks). SECURITY DEFINER + empty search_path (ADR-0006), same as
--    every other trigger function in this migration; no client EXECUTE (internal choke point only). ────
create or replace function public.fn_guard_labor_log_payroll_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lock_org_1 uuid;
  v_lock_org_2 uuid;
begin
  -- lock BOTH old.org_id and new.org_id (deterministic, smaller-uuid-first order) when an UPDATE
  -- rewrites org_id — never a single coalesced org (byte review fix, see the header's CROSS-ORG UPDATE
  -- note). An ordinary same-org write takes exactly one lock, unchanged.
  if tg_op = 'DELETE' then
    v_lock_org_1 := old.org_id;
  elsif tg_op = 'INSERT' then
    v_lock_org_1 := new.org_id;
  elsif old.org_id = new.org_id then
    v_lock_org_1 := old.org_id;
  elsif old.org_id < new.org_id then
    v_lock_org_1 := old.org_id;
    v_lock_org_2 := new.org_id;
  else
    v_lock_org_1 := new.org_id;
    v_lock_org_2 := old.org_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(private.fn_payroll_run_mutex_key(v_lock_org_1));
  if v_lock_org_2 is not null then
    perform pg_catalog.pg_advisory_xact_lock_shared(private.fn_payroll_run_mutex_key(v_lock_org_2));
  end if;

  -- OLD row checked against OLD's own org — never NEW's, even when this UPDATE also moves the row to a
  -- different org (that would let a row escape org A's closed period by "moving" it to org B).
  if tg_op in ('UPDATE', 'DELETE') and exists (
    select 1 from public.payroll_runs
     where org_id = old.org_id and old.work_date between period_start and period_end
  ) then
    raise exception 'labor_logs row is covered by a closed payroll run and is frozen' using errcode = '55000';
  end if;

  -- NEW row checked against NEW's own org — never OLD's.
  if tg_op in ('INSERT', 'UPDATE') and exists (
    select 1 from public.payroll_runs
     where org_id = new.org_id and new.work_date between period_start and period_end
  ) then
    raise exception 'labor_logs work_date falls inside an already-closed payroll period' using errcode = '55000';
  end if;

  return coalesce(new, old);
end;
$$;
revoke execute on function public.fn_guard_labor_log_payroll_freeze() from public, anon, authenticated;
create trigger guard_labor_log_payroll_freeze
  before insert or update or delete on public.labor_logs
  for each row execute function public.fn_guard_labor_log_payroll_freeze();

-- ── 8) audit — generic fn_audit (both tables carry a plain `id` PK, exactly like people_compensation's
--    own audit_people_compensation precedent, 20260622000046). The immutability triggers above are
--    BEFORE UPDATE/DELETE and always raise, so only INSERT ever actually reaches this AFTER trigger —
--    which is correct: a row that can never change needs only its creation audited. ─────────────────────
create trigger audit_payroll_run
  after insert or update or delete on public.payroll_runs
  for each row execute function public.fn_audit('payroll_run');
create trigger audit_payroll_run_line
  after insert or update or delete on public.payroll_run_lines
  for each row execute function public.fn_audit('payroll_run_line');

-- ── 9) audit_read re-emit: fold 'payroll_run'/'payroll_run_line' into the SAME confidential branch as
--    'people_compensation' (#394 note D — the wage-leak-via-audit_log vector must cover payroll_run rows
--    too, not just people_compensation). Re-emits the FULL current body (20260725201546) with ONLY that
--    addition — every existing branch/table name is preserved verbatim. ─────────────────────────────────
alter policy audit_read on public.audit_log
  using (
    org_id in (select public.user_org_ids())
    and (
      (
        entity_type is distinct from 'people_compensation'
        and entity_type not in (
          'sale', 'expense', 'custody_account', 'custody_movement', 'payment_request', 'payment_request_line',
          'account', 'journal_entry', 'journal_line', 'payment_request_funding', 'cost_center', 'offshoot_valuation',
          'buyer', 'sale_collection', 'accounting_period',
          'reconciliation_batch', 'reconciliation_evidence_item', 'reconciliation_batch_row',
          'payroll_run', 'payroll_run_line'
        )
      )
      or (
        entity_type in ('people_compensation', 'payroll_run', 'payroll_run_line')
        and public.authorize('payroll.read', org_id)
      )
      or (entity_type in ('sale', 'expense') and public.authorize('budget.write', org_id))
      or (
        entity_type in (
          'custody_account', 'custody_movement', 'payment_request', 'payment_request_line',
          'account', 'journal_entry', 'journal_line', 'payment_request_funding', 'cost_center', 'offshoot_valuation',
          'buyer', 'sale_collection', 'accounting_period',
          'reconciliation_batch', 'reconciliation_evidence_item', 'reconciliation_batch_row'
        )
        and org_id in (select private.finance_read_org_ids())
      )
    )
  );

-- ── 10) the close/report RPC (owner/accountant only, SECURITY DEFINER, idempotent + concurrency-safe). ─
-- (private.fn_payroll_run_mutex_key(uuid) is already defined in section 3 — shared with the labor_logs
-- freeze trigger, section 7 — and is NOT re-defined here.)
create or replace function private.fn_payroll_run_report(p_run_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'run_id', r.id,
    'org_id', r.org_id,
    'period_start', r.period_start,
    'period_end', r.period_end,
    'closed_by', r.closed_by,
    'closed_at', r.closed_at,
    'total_gross', r.total_gross,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', l.person_id, 'mode', l.mode, 'unit', l.unit,
        'quantity', l.quantity, 'rate', l.rate, 'gross', l.gross
      ) order by l.person_id, l.mode, l.unit)
        from public.payroll_run_lines l where l.run_id = r.id
    ), '[]'::jsonb)
  )
  from public.payroll_runs r
  where r.id = p_run_id
$$;
revoke execute on function private.fn_payroll_run_report(uuid) from public, anon, authenticated;

create or replace function public.fn_close_payroll_run(p_org uuid, p_period_start date, p_period_end date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_run_id       uuid;
  v_total        numeric;
  v_person_ids   uuid[]  := '{}';
  v_modes        text[]  := '{}';
  v_units        text[]  := '{}';
  v_quantities   numeric[] := '{}';
  v_rates        numeric[] := '{}';
  v_grosses      numeric[] := '{}';
  v_missing      text[]  := '{}';
  v_rate         numeric;
  v_qty          numeric;
  r              record;
begin
  if p_org is null or p_period_start is null or p_period_end is null then
    raise exception 'org, period_start and period_end are required' using errcode = '22023';
  end if;
  if p_period_start > p_period_end then
    raise exception 'invalid period: period_start (%) is after period_end (%)', p_period_start, p_period_end
      using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org payroll close' using errcode = '42501';
  end if;
  if not public.authorize('payroll.read', p_org) then
    raise exception 'forbidden: payroll.read (owner/accountant) is required' using errcode = '42501';
  end if;

  -- ▼▼ per-org mutex, EXCLUSIVE, taken BEFORE the idempotent-replay read (#394 note A / CONC-1 + the
  --    overlap follow-up: a concurrent second caller for the SAME org — same period OR a merely
  --    overlapping one — must block here, not race the insert/overlap-decision). ▼▼
  perform pg_catalog.pg_advisory_xact_lock(private.fn_payroll_run_mutex_key(p_org));
  -- ▲▲ end mutex ▲▲

  -- idempotent replay: an already-closed run for this EXACT org+period is never recomputed, and the
  -- state it closed against is never re-validated — a closed run stands even if later labor_logs writes
  -- would now fail validation. Sequential re-entry and the losing side of a real concurrent race both
  -- land here.
  select id into v_run_id from public.payroll_runs
   where org_id = p_org and period_start = p_period_start and period_end = p_period_end;
  if v_run_id is not null then
    return private.fn_payroll_run_report(v_run_id);
  end if;

  -- overlap reject (#394 follow-up): a period that overlaps an EXISTING closed run for this org (but is
  -- not the exact same period — that was already handled above) is refused outright. The overlapping days
  -- were already priced into the first run; closing again would double-price them. Runs under the SAME
  -- per-org EXCLUSIVE mutex acquired above, so two concurrent closers proposing overlapping-but-different
  -- periods cannot both pass this check.
  if exists (
    select 1 from public.payroll_runs
     where org_id = p_org
       and daterange(period_start, period_end, '[]') && daterange(p_period_start, p_period_end, '[]')
  ) then
    raise exception 'period % .. % overlaps an existing closed payroll run', p_period_start, p_period_end
      using errcode = '23505';
  end if;

  -- empty input: never close a vacuous period.
  if not exists (
    select 1 from public.labor_logs
     where org_id = p_org and work_date between p_period_start and p_period_end
  ) then
    raise exception 'no labor logs found for org % in period % .. %', p_org, p_period_start, p_period_end
      using errcode = '22023';
  end if;

  -- free-text crews: no scope key to resolve a rate against — fail the WHOLE close, never a partial one.
  if exists (
    select 1 from public.labor_logs
     where org_id = p_org and work_date between p_period_start and p_period_end and person_id is null
  ) then
    raise exception
      'free-text crew labor logs exist in this period — assign a person before closing payroll'
      using errcode = '22023';
  end if;

  -- cross-org reference: defense-in-depth re-verification (mirrors the reconciliation baseline tables'
  -- posture, 20260726090000) — never trust an upstream guard alone for a money-adjacent close.
  if exists (
    select 1
      from public.labor_logs ll
      join public.people p on p.id = ll.person_id
     where ll.org_id = p_org
       and ll.work_date between p_period_start and p_period_end
       and p.org_id <> p_org
  ) then
    raise exception 'cross-org person reference in labor_logs for this period' using errcode = '23514';
  end if;

  -- aggregate labor into (person, mode, unit) lines and resolve each against people_compensation.
  for r in (
    select ll.person_id, ll.mode, ll.unit,
           case ll.mode
             when 'hourly'   then sum(ll.hours)
             when 'daily'    then count(distinct ll.work_date)::numeric
             when 'piece'    then sum(ll.quantity)
             when 'seasonal' then 1::numeric
           end as quantity
      from public.labor_logs ll
     where ll.org_id = p_org
       and ll.work_date between p_period_start and p_period_end
       and ll.person_id is not null
     group by ll.person_id, ll.mode, ll.unit
     order by ll.person_id, ll.mode, ll.unit
  )
  loop
    -- seasonal is resolved ONLY on an EXACT match between this close's period and the rate's own
    -- declared contract_period_start/end (#394 follow-up) — never by checking overlap/containment, which
    -- would be inferring a cadence the rate never declared. Every other mode is unaffected by this clause.
    select pc.rate into v_rate
      from public.people_compensation pc
     where pc.org_id = p_org
       and pc.person_id = r.person_id
       and pc.mode = r.mode
       and pc.unit is not distinct from r.unit
       and (
         r.mode <> 'seasonal'
         or (pc.contract_period_start = p_period_start and pc.contract_period_end = p_period_end)
       );

    -- a zero/negative rate is invalid (non-negotiable #1, lib/payroll.ts): flag it, never pay it.
    if v_rate is null or v_rate <= 0 then
      v_missing := v_missing || format('%s:%s%s', r.person_id, r.mode, coalesce('/' || r.unit, ''));
      continue;
    end if;

    v_person_ids := v_person_ids || r.person_id;
    v_modes      := v_modes      || r.mode;
    v_units      := v_units      || r.unit;
    v_qty        := round(r.quantity, 2);
    v_quantities := v_quantities || v_qty;
    v_rates      := v_rates      || v_rate;
    v_grosses    := v_grosses    || round(v_qty * v_rate, 2);
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'missing or invalid rate for (person:mode/unit): %', array_to_string(v_missing, ', ')
      using errcode = '22023';
  end if;

  select coalesce(round(sum(g), 2), 0) into v_total from unnest(v_grosses) as g;

  -- claim-first: unique(org_id,period_start,period_end) is a second, independent backstop behind the
  -- mutex above. `on conflict do nothing` never raises — it only ever loses to a transaction that held
  -- (and released) the SAME mutex, so this branch existing is defense-in-depth, not the primary guard.
  insert into public.payroll_runs (org_id, period_start, period_end, closed_by, total_gross)
  values (p_org, p_period_start, p_period_end, v_uid, v_total)
  on conflict (org_id, period_start, period_end) do nothing
  returning id into v_run_id;

  if v_run_id is null then
    select id into v_run_id from public.payroll_runs
     where org_id = p_org and period_start = p_period_start and period_end = p_period_end;
    return private.fn_payroll_run_report(v_run_id);
  end if;

  insert into public.payroll_run_lines (org_id, run_id, person_id, mode, unit, quantity, rate, gross)
  select p_org, v_run_id, pid, m, u, q, rt, g
    from unnest(v_person_ids, v_modes, v_units, v_quantities, v_rates, v_grosses)
      as t(pid, m, u, q, rt, g);

  return private.fn_payroll_run_report(v_run_id);
end;
$$;
revoke execute on function public.fn_close_payroll_run(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_close_payroll_run(uuid, date, date) to authenticated;

comment on table public.payroll_runs is
  'SPEC-0006 slice 3: one immutable row per CLOSED (org,period). No payment execution — this snapshots '
  'gross pay for reporting only. Written exclusively by public.fn_close_payroll_run.';
comment on table public.payroll_run_lines is
  'SPEC-0006 slice 3: one immutable snapshot line per (run,person,mode[,unit]). mode/rate/quantity/unit/'
  'gross are frozen at close time — never recomputed on read.';
comment on column public.payroll_run_lines.gross is
  'round(quantity * rate, 2) — pinned as a CHECK constraint (payroll_run_lines_gross_exact), not merely '
  'an RPC-time computation.';

commit;
