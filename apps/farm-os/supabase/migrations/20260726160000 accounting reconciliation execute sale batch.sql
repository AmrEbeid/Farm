-- Accounting reconciliation SALE execution (append-only; extends the one execution path).
--
-- WHAT THIS SLICE ADDS. The expense executor (20260726150000) proved the shape: one owner-only,
-- whole-batch-atomic `fn_execute_reconciliation_batch(uuid)` with a single inner PL/pgSQL
-- subtransaction around every financial write. This migration RE-EMITS that same function so it
-- also executes reviewed, frozen `sales` rows — and therefore expense-only, sale-only, and MIXED
-- approved batches — without weakening any expense guarantee. There is deliberately no second
-- execution entry point.
--
-- THE HISTORICAL SALE CONTRACT IS *NOT* THE OPERATIONAL ONE. This is the single most important
-- fact in this file, and it is derived from repository bytes, not assumed:
--
--   * OPERATIONAL (live) sales, `fn_finalize_sale_price` (20260701500000 §7, re-emitted
--     20260708100000 F2): Dr 1200 ذمم مدينة / Cr 4000 إيرادات, i.e. revenue on credit, cleared
--     later by `fn_record_sale_collection` (Dr 1100 / Cr 1200). That path opens a receivable.
--
--   * HISTORICAL (reconciliation) sales are CASH-IN and open no receivable. The 7-year GL backfill
--     (20260707115445 SLICE 2) posted every historical sale as `Dr <cash> / Cr <TYPED revenue leaf
--     chosen by crop>`; 20260708110000 then reclassed that cash leg 1000 -> 1010 النقدية بالخزينة,
--     documenting the sale side verbatim as "162 lines +25,835,533 (all historical sales cash-in)"
--     and "Live sales post Dr 1200/Cr 4000 (never 1000)". 20260708090000 further moved three
--     ID-PINNED palm-tree disposals from 4010 to 4090.
--
--   The reconciliation executor therefore reproduces the HISTORICAL contract exactly:
--       Dr 1010 النقدية بالخزينة  /  Cr <typed revenue leaf by crop>
--   on the REVIEWED effective date. It never posts to receivable 1200, never posts to the PARENT
--   account 4000 (4000 is the parent of 4010..4090 — see 20260701440000 lines 667-687), never
--   fabricates a buyer, and never records a collection.
--
-- THE CROP -> REVENUE LEAF MAPPING is reproduced VERBATIM from 20260707115445 lines 145-153 in
-- `private.fn_reconciliation_historical_sale_revenue_code`. Its ordered CASE and its `else '4090'`
-- fallback ARE the established repository contract, so an unmatched crop failing closed to 4090 is
-- the documented behaviour, not an invention.
--
-- DELIBERATE BOUNDARY — THE PALM-TREE DISPOSAL EXCEPTION IS NOT REPRODUCIBLE. 20260708090000 moved
-- exactly three sales 4010 -> 4090 by PINNED sale_id, and says so in its own header: "Only the three
-- palm-TREE rows mis-posted to 4010. Pinned by sale_id", and "the rest is an accountant's policy
-- call, NOT decided here". There is therefore NO derivable rule that separates a palm-TREE disposal
-- from date-crop revenue, and this migration does not invent one: a reviewed crop matching the 4010
-- keywords maps to 4010, exactly as the established mapping says. Routing a genuine tree disposal to
-- 4090 stays a human review decision. This boundary is documented rather than guessed.
--
-- LIFECYCLE. `sales.payment_status` gains exactly two states, mirroring the expense executor's
-- proven pair: `historical_treasury` (posted, cash-settled at posting, immutable) and
-- `historical_reversed` (its journal reversed by a verified reconciliation correction, immutable and
-- excluded from revenue). Nothing overloads the existing operational triple
-- (unpaid/partially_collected/collected), so no operational report changes meaning.
--
-- THE BACKFILL IS PROOF-GATED, NOT HEURISTIC. Existing rows are relabelled `historical_treasury`
-- ONLY through `private.fn_reconciliation_sale_has_exact_historical_journal`, the single definition
-- of "the proven historical shape": finalized, positive total, ZERO sale_collections rows, EXACTLY
-- ONE `sale` journal for the sale, that entry posted and not itself a reversal, exactly two lines,
-- a 1010 debit equal to total, a typed-revenue-leaf credit equal to total, and entry_date equal to
-- the sale's economic date `coalesce(sale_date, created_at::date)`. The UPDATE runs THROUGH the new
-- BEFORE UPDATE guard (installed first, on purpose), so the guard and the backfill cannot disagree.
-- Counts are reported as NOTICEs and never hardcoded; a row that does not pass is left untouched and
-- surfaced as ambiguous. A final invariant aborts the migration if any `historical_treasury` row
-- fails the predicate. No tenant row count appears anywhere in reusable logic.
--
-- REPORT DEFECT CLOSED (narrowly). `fn_revenue_sales_report` (20260701510000 lines 76-79, 107-113)
-- computes `outstanding = total - Σ sale_collections` for EVERY finalized sale, so a historical
-- cash-in sale — finalized, fully settled, with zero collection rows by construction — is reported
-- as an outstanding receivable and ages into the A/R buckets. That is wrong for this contract. This
-- migration re-emits that function with exactly two changes: `historical_treasury` yields
-- `outstanding = 0`, and `historical_reversed` rows leave the report entirely. Every other row,
-- every operational as-of/aging behaviour, and every other key is byte-identical. No broader report
-- redesign is attempted here.
--
-- NO DATA IS STAGED OR EXECUTED BY THIS MIGRATION. No real reconciliation batch runs here.
--
-- ROLLBACK RUNBOOK (exact):
--   begin;
--   drop trigger if exists guard_historical_sale_collection on public.sale_collections;
--   drop trigger if exists guard_historical_treasury_sale_delete on public.sales;
--   drop trigger if exists guard_historical_treasury_sale on public.sales;
--   update public.sales set payment_status = 'collected'
--    where payment_status = 'historical_treasury';   -- reverses the proof-gated backfill only
--   -- (no row may be in 'historical_reversed' unless a reconciliation correction ran; reverse that
--   --  batch first, then re-run the line above.)
--   alter table public.sales drop constraint if exists sales_payment_status_check;
--   alter table public.sales add constraint sales_payment_status_check
--     check (payment_status in ('unpaid','partially_collected','collected'));
--   drop function if exists private.fn_guard_historical_sale_collection();
--   drop function if exists private.fn_guard_historical_treasury_sale_delete();
--   drop function if exists private.fn_guard_historical_treasury_sale();
--   drop function if exists private.fn_reconciliation_sale_has_exact_historical_journal(uuid);
--   drop function if exists private.fn_reconciliation_historical_sale_revenue_code(text);
--   drop function if exists private.fn_reconciliation_historical_revenue_codes();
--   -- re-emit public.fn_revenue_sales_report from 20260701510000 verbatim.
--   -- re-emit public.fn_execute_reconciliation_batch from 20260726150000 verbatim.
--   commit;

begin;

-- ── 1) lifecycle states ───────────────────────────────────────────────────────────────────────────
-- Additive only: the three operational states are preserved verbatim, so no existing row and no
-- operational transition changes meaning. Named exactly as PostgreSQL named the original inline
-- column CHECK in 20260701500000, matching the expenses_payment_status_check precedent.
alter table public.sales
  drop constraint if exists sales_payment_status_check;
alter table public.sales
  add constraint sales_payment_status_check
  check (
    payment_status in (
      'unpaid', 'partially_collected', 'collected',
      'historical_treasury', 'historical_reversed'
    )
  );

-- ── 2) the typed revenue leaves, and the established crop mapping ─────────────────────────────────
create or replace function private.fn_reconciliation_historical_revenue_codes()
returns text[]
language sql
immutable
set search_path = ''
as $$
  -- The six typed revenue leaves seeded under parent 4000 by 20260701440000 lines 682-687.
  -- 4000 itself is deliberately absent: it is the PARENT, and a historical sale never posts there.
  select array['4010', '4020', '4030', '4040', '4050', '4090']::text[];
$$;
revoke execute on function private.fn_reconciliation_historical_revenue_codes()
  from public, anon, authenticated;

create or replace function private.fn_reconciliation_historical_sale_revenue_code(p_crop text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- VERBATIM reproduction of the established mapping in 20260707115445 lines 145-153, including its
  -- branch ORDER (which is load-bearing: 'خرده|خشب|…' is tested before the date-crop keywords) and
  -- its documented `else '4090'` fallback. A null/blank crop falls through to that same fallback.
  select case
    when coalesce(p_crop, '') ~ 'خرده|خشب|سلك|خراطيم|مكن|الشفعه'                      then '4090'
    when coalesce(p_crop, '') ~ 'فسائل|فسيلة|فسيله'                                   then '4020'
    when coalesce(p_crop, '') ~ 'بنجر'                                                then '4040'
    when coalesce(p_crop, '') ~ 'برحي|بلح|تمور|خلاص|مجدول|زغلول|النخيل|نخيل'           then '4010'
    when coalesce(p_crop, '') ~ 'ذرة|قمح|فول|ثوم|بصل|شعير|برسيم|تقاوي|سيلاج|تبن|فلفل'  then '4050'
    when coalesce(p_crop, '') ~ 'برتقال|يوسفي|ليمون|كمثري|مانجو|تفاح|عنب|رمان|موركيت|خوخ|قشط|كافور|صيني|كلاله' then '4030'
    else '4090'
  end;
$$;
revoke execute on function private.fn_reconciliation_historical_sale_revenue_code(text)
  from public, anon, authenticated;

-- ── 3) ONE definition of "the proven historical direct-treasury sale" ─────────────────────────────
-- Used by the backfill, by the lifecycle guard, and by the executor's correction-eligibility check,
-- so those three can never disagree about what "already posted as historical cash-in" means. Every
-- clause is a fail-closed requirement.
--
-- SCOPE, stated precisely so it is not over-read: this proves a HISTORICAL JOURNAL WAS POSTED. It
-- deliberately does NOT require the revenue leaf to be `active` or childless. An archived account that
-- still carries postings is valid evidence — `fn_accounting_trial_balance` (20260708100000 F3) keeps
-- exactly such accounts precisely so an archived posted balance cannot vanish — and reversing such a
-- sale is still an exact inverse. The executor's ADDITION path is stricter (active + leaf) because it
-- is creating a NEW posting, which is a different question. Two different questions, two checks.
--
-- `TimeZone` is pinned because `created_at::date` is timezone-dependent: without it the same row would
-- classify differently depending on the caller's session zone, so the backfill, the guard and the
-- executor could disagree about one row. Pinning makes the predicate deterministic. A sale with a NULL
-- `sale_date` near a UTC day boundary may therefore fail to match a journal whose entry_date was
-- derived under another zone — that direction is fail-closed (left unclassified, never mis-labelled).
create or replace function private.fn_reconciliation_sale_has_exact_historical_journal(p_sale uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set "TimeZone" = 'UTC'
as $$
  select exists (
    select 1
      from public.sales s
      join public.journal_entries je
        on je.org_id = s.org_id
       and je.source_type = 'sale'
       and je.source_id = s.id
       and je.status = 'posted'
       and je.reversal_of is null
     where s.id = p_sale
       and s.price_status = 'finalized'
       and s.total is not null
       and s.total > 0
       -- the sale's own economic date, exactly as the backfill computed it (under the pinned UTC zone)
       and je.entry_date = coalesce(s.sale_date, (s.created_at at time zone 'UTC')::date)
       -- cash-in: no receivable was ever opened, so no collection may exist. The corresponding
       -- laundering route — deleting a collection row to orphan its posted Dr 1100 / Cr 1200 entry and
       -- make an operational receivable look like a historical cash sale — is closed at the source by
       -- the DELETE guard on public.sale_collections below, not guessed at here from amounts or dates.
       and not exists (
         select 1 from public.sale_collections c
          where c.sale_id = s.id and c.org_id = s.org_id
       )
       -- exactly ONE `sale` journal for this sale, in any status: an ambiguous or already
       -- re-posted/reversed target can never satisfy this
       and (
         select count(*) from public.journal_entries other
          where other.org_id = s.org_id
            and other.source_type = 'sale'
            and other.source_id = s.id
       ) = 1
       and (
         select count(*) from public.journal_lines jl
          where jl.journal_entry_id = je.id
       ) = 2
       -- Dr 1010 النقدية بالخزينة for the exact total
       and exists (
         select 1
           from public.journal_lines cash_line
           join public.accounts cash_account
             on cash_account.id = cash_line.account_id
            and cash_account.org_id = s.org_id
            and cash_account.code = '1010'
          where cash_line.journal_entry_id = je.id
            and cash_line.debit = s.total
            and cash_line.credit = 0
       )
       -- Cr one TYPED revenue leaf for the exact total (never the 4000 parent)
       and exists (
         select 1
           from public.journal_lines revenue_line
           join public.accounts revenue_account
             on revenue_account.id = revenue_line.account_id
            and revenue_account.org_id = s.org_id
          where revenue_line.journal_entry_id = je.id
            and revenue_account.account_type = 'revenue'
            and revenue_account.code = any (
              private.fn_reconciliation_historical_revenue_codes()
            )
            and revenue_line.credit = s.total
            and revenue_line.debit = 0
       )
  );
$$;
revoke execute on function private.fn_reconciliation_sale_has_exact_historical_journal(uuid)
  from public, anon, authenticated;

-- ── 4) sale lifecycle guard (mirrors private.fn_guard_historical_treasury_expense) ────────────────
create or replace function private.fn_guard_historical_treasury_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- INSERT can never claim a historical state. Both states are earned by a posted journal (or a
  -- verified reversal), and on INSERT no journal can reference a row that does not exist yet — so an
  -- insert-time claim is unprovable by construction. Leaving INSERT unguarded would also create an
  -- indelible row: the UPDATE guard freezes every field and the DELETE guard refuses removal, so an
  -- unprovable row could never be corrected or deleted. The executor always inserts through
  -- fn_save_sale (default `unpaid`) and promotes with a follow-up UPDATE, so nothing legitimate breaks.
  if tg_op = 'INSERT' then
    if new.payment_status in ('historical_treasury', 'historical_reversed') then
      raise exception 'a historical reconciliation sale state cannot be claimed on insert'
        using errcode = '22023';
    end if;
    return new;
  end if;

  -- A reversed historical sale is frozen except for `reversed_by_rollback_at`, the single column a
  -- future reconciliation-rollback executor stamps for bookkeeping.
  if old.payment_status = 'historical_reversed' then
    if to_jsonb(new) - array['reversed_by_rollback_at']::text[]
         is distinct from to_jsonb(old) - array['reversed_by_rollback_at']::text[] then
      raise exception 'reversed historical sale is immutable'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if new.payment_status in ('historical_treasury', 'historical_reversed')
     and new.payment_status is distinct from old.payment_status
     and to_jsonb(new) - array['payment_status']::text[]
       is distinct from to_jsonb(old) - array['payment_status']::text[] then
    raise exception 'historical reconciliation transition cannot alter sale fields'
      using errcode = '22023';
  end if;

  -- Claiming the posted state requires the proven direct-treasury journal to already exist.
  if new.payment_status = 'historical_treasury'
     and old.payment_status is distinct from 'historical_treasury' then
    if not private.fn_reconciliation_sale_has_exact_historical_journal(old.id) then
      raise exception 'historical treasury sale status requires a matching posted treasury journal'
        using errcode = '22023';
    end if;
  end if;

  -- Claiming the reversed state requires a verified reconciliation reversal of this sale's own
  -- original posted journal — never a bare status flip.
  if new.payment_status = 'historical_reversed'
     and old.payment_status is distinct from 'historical_reversed' then
    if not exists (
      select 1
        from public.reconciliation_action_links al
        join public.journal_entries reversal
          on reversal.id = al.journal_entry_id
        join public.journal_entries original
          on original.id = reversal.reversal_of
       where al.org_id = old.org_id
         and al.target_table = 'sales'
         and al.target_id = old.id
         and al.action_kind = 'correction_reversal'
         and original.org_id = old.org_id
         and original.source_type = 'sale'
         and original.source_id = old.id
    ) then
      raise exception 'historical reversed sale status requires a verified reconciliation reversal'
        using errcode = '22023';
    end if;
  end if;

  if old.payment_status is distinct from 'historical_treasury' then
    return new;
  end if;

  -- A posted historical sale is immutable in every business field: no re-pricing, no re-dating, no
  -- dimension edit, no crop/buyer change.
  if to_jsonb(new) - array['payment_status']::text[]
       is distinct from to_jsonb(old) - array['payment_status']::text[] then
    raise exception 'posted historical treasury sale is immutable'
      using errcode = '22023';
  end if;

  -- The only permitted exit is a reconciliation reversal — never a reroute into an operational
  -- collection state.
  if new.payment_status is distinct from old.payment_status
     and new.payment_status <> 'historical_reversed' then
    raise exception 'historical treasury sale reconciliation must be reversed, not rerouted'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.fn_guard_historical_treasury_sale()
  from public, anon, authenticated;

drop trigger if exists guard_historical_treasury_sale on public.sales;
create trigger guard_historical_treasury_sale
  before insert or update on public.sales
  for each row execute function private.fn_guard_historical_treasury_sale();

-- A posted or reversed historical reconciliation sale is the accounting evidence for a posted
-- journal; deleting it would silently orphan that journal, so DELETE is refused outright. Undoing a
-- reconciliation is a rollback (a new reversing entry), not a delete.
create or replace function private.fn_guard_historical_treasury_sale_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.payment_status in ('historical_treasury', 'historical_reversed') then
    raise exception 'historical reconciliation sale cannot be deleted'
      using errcode = '22023';
  end if;
  return old;
end;
$$;
revoke execute on function private.fn_guard_historical_treasury_sale_delete()
  from public, anon, authenticated;

drop trigger if exists guard_historical_treasury_sale_delete on public.sales;
create trigger guard_historical_treasury_sale_delete
  before delete on public.sales
  for each row execute function private.fn_guard_historical_treasury_sale_delete();

-- A historical sale was settled in cash at the moment it posted (Dr 1010). It has no receivable, so
-- a collection against it would credit ذمم مدينة 1200 with no matching posted debit — phantom cash.
-- Guarded at the collection row itself so no privileged path (including a SECURITY DEFINER RPC) can
-- open a second money path into a reconciliation sale.
create or replace function private.fn_guard_historical_sale_collection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- DELETE is the laundering route, not the collection route: `sale_collections` is the ONLY evidence
  -- the historical proof uses to rule out a receivable, yet a collection row can be removed while its
  -- posted Dr 1100 / Cr 1200 journal survives (the journal has no FK back to the row). Deleting a
  -- settled collection would therefore turn an operational receivable into a "proven" historical cash
  -- sale AND orphan real posted money. A collection that has posted is accounting evidence: it is
  -- undone by a reversing entry, never by a delete.
  if tg_op = 'DELETE' then
    if old.journal_entry_id is not null then
      raise exception 'a posted sale collection cannot be deleted'
        using errcode = '22023';
    end if;
    return old;
  end if;

  if exists (
    select 1 from public.sales s
     where s.id = new.sale_id
       and s.payment_status in ('historical_treasury', 'historical_reversed')
  ) then
    raise exception 'a historical reconciliation sale is already settled and cannot be collected'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.fn_guard_historical_sale_collection()
  from public, anon, authenticated;

drop trigger if exists guard_historical_sale_collection on public.sale_collections;
create trigger guard_historical_sale_collection
  before insert or update or delete on public.sale_collections
  for each row execute function private.fn_guard_historical_sale_collection();

-- ── 5) proof-gated classification of EXISTING exact historical direct-treasury sales ──────────────
-- Runs THROUGH the guard installed above, so "what the backfill relabels" and "what the guard
-- accepts" are the same predicate by construction. No row count is hardcoded; nothing is relabelled
-- on a heuristic; anything that does not pass is left untouched and surfaced.
do $$
declare
  v_eligible  int;
  v_ambiguous int;
begin
  -- Driven by the PROOF, never by a prior status. Filtering on `payment_status = 'collected'` would be
  -- a silent no-op on data where the historical rows were imported with the column's `'unpaid'`
  -- default: in this repository the only writer of `'collected'` is fn_record_sale_collection, which
  -- requires a collection row, and a historical cash-in sale has none by construction. Selecting on
  -- the proof instead is also strictly safer — the predicate demands a Dr 1010 debit and zero
  -- collections, so an operational `'unpaid'` receivable (Dr 1200) can never be swept in.
  update public.sales s
     set payment_status = 'historical_treasury'
   where s.payment_status not in ('historical_treasury', 'historical_reversed')
     and private.fn_reconciliation_sale_has_exact_historical_journal(s.id);
  get diagnostics v_eligible = row_count;

  -- Rows that LOOK historical (a posted `sale` journal with a 1010 debit leg) but fail some part of
  -- the exact predicate. These are deliberately NOT touched — they need a human decision.
  select count(*) into v_ambiguous
    from public.sales s
   where s.payment_status <> 'historical_treasury'
     and exists (
       select 1
         from public.journal_entries je
         join public.journal_lines jl on jl.journal_entry_id = je.id
         join public.accounts a
           on a.id = jl.account_id and a.org_id = s.org_id and a.code = '1010'
        where je.org_id = s.org_id
          and je.source_type = 'sale'
          and je.source_id = s.id
          and je.status = 'posted'
          and jl.debit > 0
     )
     and not private.fn_reconciliation_sale_has_exact_historical_journal(s.id);

  raise notice
    'reconciliation sale classification: % row(s) proven historical direct-treasury, % ambiguous row(s) left untouched',
    v_eligible, v_ambiguous;
end $$;

-- Safety invariant, deliberately TWO-SIDED. The first half is soundness (nothing is labelled without
-- the proof). The second half is completeness, and it exists because a one-sided check passes
-- trivially when the backfill matches nothing: without it, a filter that silently relabels zero rows
-- looks identical to a clean database. Either direction aborts the migration.
do $$
declare
  v_unproven   int;
  v_unlabelled int;
begin
  select count(*) into v_unproven
    from public.sales s
   where s.payment_status = 'historical_treasury'
     and not private.fn_reconciliation_sale_has_exact_historical_journal(s.id);
  if v_unproven <> 0 then
    raise exception
      'historical sale classification invariant failed: % row(s) marked historical_treasury without the exact proven journal',
      v_unproven;
  end if;

  select count(*) into v_unlabelled
    from public.sales s
   where s.payment_status not in ('historical_treasury', 'historical_reversed')
     and private.fn_reconciliation_sale_has_exact_historical_journal(s.id);
  if v_unlabelled <> 0 then
    raise exception
      'historical sale classification invariant failed: % provably historical row(s) were left unclassified',
      v_unlabelled;
  end if;
end $$;

-- ── 6) narrow re-emit of the revenue / A-R report ─────────────────────────────────────────────────
-- VERBATIM from 20260701510000 except the two marked changes (▼▼ / ▲▲). Every other CTE, key,
-- ordering, aging bucket, and as-of behaviour is unchanged, so operational A/R reporting is
-- byte-identical for unpaid / partially_collected / collected sales.
create or replace function public.fn_revenue_sales_report(
  p_org uuid,
  p_period_start date default null,
  p_period_end date default null,
  p_as_of date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start date := coalesce(p_period_start, date_trunc('month', current_date)::date);
  v_end date := coalesce(p_period_end, current_date);
  v_as_of date := coalesce(p_as_of, coalesce(p_period_end, current_date));
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if v_start > v_end then
    raise exception 'period_start must be on or before period_end' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org revenue report' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  return (
    with sale_base as (
      select
        s.id as sale_id,
        coalesce(s.sale_date, s.delivery_date, s.created_at::date) as report_date,
        s.sale_date,
        s.delivery_date,
        s.crop,
        s.season,
        s.qty,
        s.unit,
        s.unit_price,
        s.total,
        s.price_status,
        s.payment_status,
        s.buyer_id,
        b.name as buyer_name,
        b.buyer_type,
        s.cost_center_id,
        cc.code as cost_center_code,
        cc.name_ar as cost_center_name,
        s.farm_id,
        f.name as farm_name,
        s.sector_id,
        sec.name as sector_name,
        s.hawsha_id,
        h.name as hawsha_name,
        coalesce(col.collected_to_as_of, 0) as collected_to_as_of,
        coalesce(col.collected_in_period, 0) as collected_in_period,
        case
          -- ▼▼ historical direct-treasury sale: cash-settled at posting (Dr 1010), so it never opens
          --    a receivable and can never age into A/R. Without this branch the generic
          --    `total - Σ collections` rule reports every historical cash-in sale as outstanding,
          --    because a historical sale has zero sale_collections rows BY CONSTRUCTION. ▼▼
          when s.payment_status = 'historical_treasury' then 0
          -- ▲▲ end historical branch — operational behaviour below is unchanged ▲▲
          when s.price_status = 'finalized' then greatest(coalesce(s.total, 0) - coalesce(col.collected_to_as_of, 0), 0)
          else null
        end as outstanding,
        greatest(0, v_as_of - coalesce(s.sale_date, s.delivery_date, s.created_at::date)) as age_days,
        case
          when greatest(0, v_as_of - coalesce(s.sale_date, s.delivery_date, s.created_at::date)) >= 60 then '60+'
          when greatest(0, v_as_of - coalesce(s.sale_date, s.delivery_date, s.created_at::date)) >= 30 then '30-59'
          else '0-29'
        end as aging_bucket
      from public.sales s
      left join public.buyers b on b.id = s.buyer_id and b.org_id = s.org_id
      left join public.cost_centers cc on cc.id = s.cost_center_id and cc.org_id = s.org_id
      left join public.farms f on f.id = s.farm_id and f.org_id = s.org_id
      left join public.sectors sec on sec.id = s.sector_id and sec.org_id = s.org_id
      left join public.hawshat h on h.id = s.hawsha_id and h.org_id = s.org_id
      left join lateral (
        select
          coalesce(sum(c.amount) filter (where c.occurred_at <= v_as_of), 0) as collected_to_as_of,
          coalesce(sum(c.amount) filter (where c.occurred_at between v_start and v_end), 0) as collected_in_period
        from public.sale_collections c
        where c.org_id = s.org_id
          and c.sale_id = s.id
      ) col on true
      where s.org_id = p_org
        -- ▼▼ a reconciliation-reversed sale's revenue journal is reversed, so it is not revenue, not
        --    a receivable, and not a period sale. It leaves the report entirely — the same treatment
        --    fn_owner_pnl_summary gives a `historical_reversed` expense (20260726150000). ▼▼
        and s.payment_status is distinct from 'historical_reversed'
        -- ▲▲ end reversal exclusion ▲▲
    ),
    period_sales as (
      select *
      from sale_base
      where report_date between v_start and v_end
    ),
    ar_rows as (
      select *
      from sale_base
      where price_status = 'finalized'
        and report_date <= v_as_of
        and coalesce(outstanding, 0) > 0
    ),
    by_buyer as (
      select
        buyer_id,
        coalesce(buyer_name, 'نقدي/غير محدد') as buyer_name,
        buyer_type,
        count(*)::int as sale_count,
        count(*) filter (where price_status = 'pending')::int as pending_count,
        coalesce(sum(qty), 0) as qty,
        coalesce(sum(total) filter (where price_status = 'finalized'), 0) as finalized_revenue,
        coalesce(sum(collected_in_period), 0) as collected_in_period,
        coalesce(sum(collected_to_as_of), 0) as collected_to_as_of,
        coalesce(sum(outstanding), 0) as outstanding
      from period_sales
      group by buyer_id, coalesce(buyer_name, 'نقدي/غير محدد'), buyer_type
    ),
    by_crop_season as (
      select
        crop,
        coalesce(season, 'غير محدد') as season,
        count(*)::int as sale_count,
        count(*) filter (where price_status = 'pending')::int as pending_count,
        coalesce(sum(qty), 0) as qty,
        coalesce(sum(total) filter (where price_status = 'finalized'), 0) as finalized_revenue,
        coalesce(sum(collected_in_period), 0) as collected_in_period,
        coalesce(sum(outstanding), 0) as outstanding
      from period_sales
      group by crop, coalesce(season, 'غير محدد')
    ),
    collections as (
      select
        c.id as collection_id,
        c.sale_id,
        c.occurred_at,
        c.amount,
        coalesce(b.name, 'نقدي/غير محدد') as buyer_name,
        s.crop,
        s.season,
        c.collected_by,
        c.note,
        c.journal_entry_id
      from public.sale_collections c
      join public.sales s on s.id = c.sale_id and s.org_id = c.org_id
      left join public.buyers b on b.id = s.buyer_id and b.org_id = s.org_id
      where c.org_id = p_org
        and c.occurred_at between v_start and v_end
      order by c.occurred_at desc, c.created_at desc, c.id
    )
    select jsonb_build_object(
      'period_start', v_start,
      'period_end', v_end,
      'as_of', v_as_of,
      'finalized_revenue', coalesce((select sum(total) from period_sales where price_status = 'finalized'), 0),
      'period_collections', coalesce((select sum(amount) from collections), 0),
      'outstanding_total', coalesce((select sum(outstanding) from ar_rows), 0),
      'over_30_amount', coalesce((select sum(outstanding) from ar_rows where age_days >= 30), 0),
      'over_30_count', coalesce((select count(*) from ar_rows where age_days >= 30), 0),
      'pending_count', coalesce((select count(*) from period_sales where price_status = 'pending'), 0),
      'pending_qty', coalesce((select sum(qty) from period_sales where price_status = 'pending'), 0),
      'sales', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'sale_id', sale_id,
            'report_date', report_date,
            'sale_date', sale_date,
            'delivery_date', delivery_date,
            'crop', crop,
            'season', season,
            'qty', qty,
            'unit', unit,
            'unit_price', unit_price,
            'total', total,
            'price_status', price_status,
            'payment_status', payment_status,
            'buyer_id', buyer_id,
            'buyer_name', buyer_name,
            'buyer_type', buyer_type,
            'cost_center_id', cost_center_id,
            'cost_center_code', cost_center_code,
            'cost_center_name', cost_center_name,
            'farm_id', farm_id,
            'farm_name', farm_name,
            'sector_id', sector_id,
            'sector_name', sector_name,
            'hawsha_id', hawsha_id,
            'hawsha_name', hawsha_name,
            'collected_to_as_of', collected_to_as_of,
            'collected_in_period', collected_in_period,
            'outstanding', outstanding
          )
          order by report_date desc, sale_id
        )
        from period_sales
      ), '[]'::jsonb),
      'by_buyer', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'buyer_id', buyer_id,
            'buyer_name', buyer_name,
            'buyer_type', buyer_type,
            'sale_count', sale_count,
            'pending_count', pending_count,
            'qty', qty,
            'finalized_revenue', finalized_revenue,
            'collected_in_period', collected_in_period,
            'collected_to_as_of', collected_to_as_of,
            'outstanding', outstanding
          )
          order by finalized_revenue desc, buyer_name
        )
        from by_buyer
      ), '[]'::jsonb),
      'by_crop_season', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'crop', crop,
            'season', season,
            'sale_count', sale_count,
            'pending_count', pending_count,
            'qty', qty,
            'finalized_revenue', finalized_revenue,
            'collected_in_period', collected_in_period,
            'outstanding', outstanding
          )
          order by finalized_revenue desc, crop, season
        )
        from by_crop_season
      ), '[]'::jsonb),
      'ar_rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'sale_id', sale_id,
            'report_date', report_date,
            'buyer_id', buyer_id,
            'buyer_name', buyer_name,
            'buyer_type', buyer_type,
            'crop', crop,
            'season', season,
            'total', total,
            'collected_to_as_of', collected_to_as_of,
            'outstanding', outstanding,
            'age_days', age_days,
            'aging_bucket', aging_bucket,
            'payment_status', payment_status
          )
          order by age_days desc, report_date asc, sale_id
        )
        from ar_rows
      ), '[]'::jsonb),
      'collections', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'collection_id', collection_id,
            'sale_id', sale_id,
            'occurred_at', occurred_at,
            'amount', amount,
            'buyer_name', buyer_name,
            'crop', crop,
            'season', season,
            'collected_by', collected_by,
            'note', note,
            'journal_entry_id', journal_entry_id
          )
          order by occurred_at desc, collection_id
        )
        from collections
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke execute on function public.fn_revenue_sales_report(uuid, date, date, date)
  from public, anon, authenticated;
grant execute on function public.fn_revenue_sales_report(uuid, date, date, date)
  to authenticated;

-- ── 7) the one execution path, extended to sales and mixed batches ────────────────────────────────
-- Re-emitted from 20260726150000. Every expense guarantee is preserved verbatim: owner-only +
-- org-scoped authz, approved+frozen revalidation under locks, payload-hash drift detection, the
-- single inner subtransaction, retryable-SQLSTATE re-raise, redacted failure metadata, the
-- execution ledger's cross-batch double-execution guard, baseline serialization, postflight
-- aggregate/journal/snapshot invariants, and the exact-inverse reversal proof. The additions are the
-- `sales` domain branch and the sales half of every baseline/postflight check.
--
-- LOCK ORDER (deterministic, and identical for an expense-only, sale-only, or mixed batch):
--   batch -> batch rows (by evidence_item_id) -> cash 1010 -> revenue leaves (by id)
--   -> correction target expenses (by id) -> their journals (by id) -> their lines (by id)
--   -> correction target sales (by id)    -> their journals (by id) -> their lines (by id)
-- Cash 1010 is taken FIRST by every batch of every shape, so it remains the single serialization
-- point two concurrent executions contend on, exactly as the expense slice proved.
create or replace function public.fn_execute_reconciliation_batch(p_batch_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_status text;
  v_failure boolean := false;
  v_failure_code text;
  v_sqlstate text;
  v_last_safe_row_locator uuid;
  v_cash_account uuid;
  v_expenses_count integer;
  v_expenses_total numeric;
  v_sales_count integer;
  v_sales_total numeric;
  v_journal_count integer;
  v_row_hash_set jsonb;
  v_journal_hash_set jsonb;
  v_new_expense_id uuid;
  v_new_sale_id uuid;
  v_new_journal_id uuid;
  v_original_journal_id uuid;
  v_reversal_journal_id uuid;
  v_ledger_id uuid;
  v_executed_count integer := 0;
  v_skipped_count integer := 0;
  v_expected_expenses_total numeric := 0;
  v_expected_expenses_count integer := 0;
  v_expected_sales_total numeric := 0;
  v_expected_sales_count integer := 0;
  v_actual_expenses_total numeric := 0;
  v_actual_expenses_count integer := 0;
  v_actual_sales_total numeric := 0;
  v_actual_sales_count integer := 0;
  v_expected_posted_journal_delta integer := 0;
  v_dimension_id uuid;
  v_revenue_account uuid;
  v_effective_date date;
  v_matched_production_date date;
  v_result jsonb;
  v_zero_value_skip boolean;
  r record;
  v_evidence record;
  v_batch_row public.reconciliation_batch_rows%rowtype;
begin
  if p_batch_id is null then
    raise exception 'batch id required' using errcode = '23502';
  end if;

  select b.org_id, b.status
    into v_org, v_status
    from public.reconciliation_batches b
   where b.id = p_batch_id
   for update;

  if v_org is null then
    raise exception 'reconciliation batch not found' using errcode = 'P0002';
  end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org reconciliation batch' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.organization_member m
     where m.org_id = v_org
       and m.user_id = v_uid
       and m.role = 'owner'
  ) or not public.authorize('reconciliation.write', v_org) then
    raise exception 'forbidden: only an owner may execute reconciliation' using errcode = '42501';
  end if;

  if v_status in ('executed', 'failed', 'rolled_back') then
    return jsonb_build_object(
      'batch_id', p_batch_id,
      'status', v_status,
      'idempotent', true
    );
  end if;
  if v_status <> 'approved' then
    raise exception 'only an approved reconciliation batch may execute' using errcode = '22023';
  end if;

  update public.reconciliation_batches
     set status = 'executing',
         result_summary = null
   where id = p_batch_id;

  begin
    if exists (
      select 1
        from public.reconciliation_batch_rows br
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
         and (
           br.review_state <> 'frozen'
           or br.frozen is distinct from true
           or br.payload_hash is null
         )
    ) then
      raise exception 'included rows must be frozen' using errcode = '22023';
    end if;

    -- Expense-only, sale-only, and MIXED approved batches all execute inside this one
    -- subtransaction. Any other target domain still fails closed.
    if exists (
      select 1
        from public.reconciliation_batch_rows br
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
         and (
           br.target_table is null
           or br.target_table not in ('expenses', 'sales')
         )
    ) then
      raise exception 'reconciliation execution supports only expense and sale rows'
        using errcode = '22023';
    end if;

    for v_batch_row in
      select br.*
        from public.reconciliation_batch_rows br
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
       order by br.evidence_item_id
       for update
    loop
      if private.fn_reconciliation_execution_payload_hash(v_batch_row)
           is distinct from v_batch_row.payload_hash then
        v_last_safe_row_locator := v_batch_row.id;
        raise exception 'frozen payload drift' using errcode = '23514';
      end if;
    end loop;

    select a.id
      into v_cash_account
      from public.accounts a
     where a.org_id = v_org
       and a.code = '1010'
       and a.active
     for update;
    if v_cash_account is null then
      raise exception 'cash posting account is unavailable' using errcode = '23514';
    end if;

    -- Take the typed revenue leaves in id order, and ONLY when the batch actually contains a sales
    -- row. Taking them unconditionally would widen an expense-only batch's lock footprint for no
    -- expense-side benefit, and every extra account row held for a whole transaction is another edge
    -- against any path that locks accounts in a different order (e.g. fn_merge_accounts, which locks
    -- source-then-target by ARGUMENT order, not id order). Determinism is preserved: two concurrent
    -- SALE batches still take the same set in the same id order, and cash 1010 above is still taken
    -- first by every batch of every shape, so it remains the single serialization point.
    if exists (
      select 1
        from public.reconciliation_batch_rows br
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
         and br.target_table = 'sales'
    ) then
      perform 1
        from public.accounts a
       where a.org_id = v_org
         and a.account_type = 'revenue'
         and a.code = any (private.fn_reconciliation_historical_revenue_codes())
       order by a.id
       for update;
    end if;

    perform 1
      from public.reconciliation_batch_rows br
      join public.expenses e
        on e.id = br.corrects_expense_id
       and e.org_id = br.org_id
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_expense_id is not null
     order by e.id
     for update of e;

    perform 1
      from public.reconciliation_batch_rows br
      join public.journal_entries je
        on je.org_id = br.org_id
       and je.source_type = 'expense'
       and je.source_id = br.corrects_expense_id
       and je.status = 'posted'
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_expense_id is not null
     order by je.id
     for update of je;

    perform 1
      from public.reconciliation_batch_rows br
      join public.journal_entries je
        on je.org_id = br.org_id
       and je.source_type = 'expense'
       and je.source_id = br.corrects_expense_id
       and je.status = 'posted'
      join public.journal_lines jl on jl.journal_entry_id = je.id
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_expense_id is not null
     order by jl.id
     for update of jl;

    perform 1
      from public.reconciliation_batch_rows br
      join public.sales s
        on s.id = br.corrects_sale_id
       and s.org_id = br.org_id
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_sale_id is not null
     order by s.id
     for update of s;

    perform 1
      from public.reconciliation_batch_rows br
      join public.journal_entries je
        on je.org_id = br.org_id
       and je.source_type = 'sale'
       and je.source_id = br.corrects_sale_id
       and je.status = 'posted'
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_sale_id is not null
     order by je.id
     for update of je;

    perform 1
      from public.reconciliation_batch_rows br
      join public.journal_entries je
        on je.org_id = br.org_id
       and je.source_type = 'sale'
       and je.source_id = br.corrects_sale_id
       and je.status = 'posted'
      join public.journal_lines jl on jl.journal_entry_id = je.id
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_sale_id is not null
     order by jl.id
     for update of jl;

    select count(*)::integer, coalesce(sum(e.total), 0)
      into v_expenses_count, v_expenses_total
      from public.expenses e
     where e.org_id = v_org;

    select count(*)::integer, coalesce(sum(coalesce(s.total, 0)), 0)
      into v_sales_count, v_sales_total
      from public.sales s
     where s.org_id = v_org;

    select count(*)::integer
      into v_journal_count
      from public.journal_entries je
     where je.org_id = v_org
       and je.status = 'posted';

    -- Every baseline row carries its own `target_table` tag, so the sales and expenses halves of the
    -- postflight drift check can never be compared against the wrong domain.
    select coalesce(jsonb_agg(entry order by (entry->>'id')::uuid), '[]'::jsonb)
      into v_row_hash_set
      from (
        select jsonb_build_object(
          'id', e.id,
          'target_table', 'expenses',
          'original_payment_status', e.payment_status,
          'hash', encode(sha256(convert_to(jsonb_build_object(
            'id', e.id,
            'org_id', e.org_id,
            'date', e.date,
            'farm_id', e.farm_id,
            'sector_id', e.sector_id,
            'hawsha_id', e.hawsha_id,
            'event_id', e.event_id,
            'plan_id', e.plan_id,
            'category', e.category,
            'description', e.description,
            'supplier_id', e.supplier_id,
            'qty', e.qty,
            'unit', e.unit,
            'unit_price', e.unit_price,
            'total', e.total,
            'payment_method', e.payment_method,
            'recorded_by', e.recorded_by,
            'approved_by', e.approved_by,
            'status', e.status,
            'payment_status', 'historical_reversed',
            'paid_by', e.paid_by,
            'kind', e.kind,
            'account_id', e.account_id,
            'cost_center_id', e.cost_center_id,
            'corrects_expense_id', e.corrects_expense_id,
            'reversed_by_rollback_at', e.reversed_by_rollback_at
          )::text, 'UTF8')), 'hex')
        ) as entry
          from public.reconciliation_batch_rows br
          join public.expenses e
            on e.id = br.corrects_expense_id
           and e.org_id = br.org_id
         where br.batch_id = p_batch_id
           and br.disposition = 'include'
           and br.corrects_expense_id is not null
        union all
        select jsonb_build_object(
          'id', s.id,
          'target_table', 'sales',
          'original_payment_status', s.payment_status,
          -- Hashed over the WHOLE row with only `payment_status` overridden to its expected
          -- post-execution value, rather than a hand-listed column subset: a subset silently stops
          -- covering any column added to public.sales later, and this hash IS the tamper detector.
          -- jsonb key order is canonical, so the digest is stable.
          'hash', encode(sha256(convert_to((
            to_jsonb(s) || jsonb_build_object('payment_status', 'historical_reversed')
          )::text, 'UTF8')), 'hex')
        ) as entry
          from public.reconciliation_batch_rows br
          join public.sales s
            on s.id = br.corrects_sale_id
           and s.org_id = br.org_id
         where br.batch_id = p_batch_id
           and br.disposition = 'include'
           and br.corrects_sale_id is not null
      ) baseline_rows;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', je.id,
        'hash', encode(sha256(convert_to(jsonb_build_object(
          'id', je.id,
          'entry_date', je.entry_date,
          'source_type', je.source_type,
          'source_id', je.source_id,
          'source_sequence', je.source_sequence,
          'status', je.status,
          'lines', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', line.id,
              'line_ordinal', line.line_ordinal,
              'account_id', line.account_id,
              'debit', line.debit,
              'credit', line.credit,
              'cost_center_id', line.cost_center_id,
              'expense_id', line.expense_id
            ) order by line.line_ordinal), '[]'::jsonb)
              from (
                select jl.*, row_number() over (order by jl.id)::integer as line_ordinal
                  from public.journal_lines jl
                 where jl.journal_entry_id = je.id
              ) line
          )
        )::text, 'UTF8')), 'hex')
      ) order by je.id
    ), '[]'::jsonb)
      into v_journal_hash_set
      from public.journal_entries je
     where je.org_id = v_org
       and je.status = 'posted'
       and (
         (
           je.source_type = 'expense'
           and exists (
             select 1 from public.reconciliation_batch_rows br
              where br.batch_id = p_batch_id
                and br.disposition = 'include'
                and br.corrects_expense_id = je.source_id
           )
         )
         or (
           je.source_type = 'sale'
           and exists (
             select 1 from public.reconciliation_batch_rows br
              where br.batch_id = p_batch_id
                and br.disposition = 'include'
                and br.corrects_sale_id = je.source_id
           )
         )
       );

    insert into public.reconciliation_baselines(
      org_id, batch_id, expenses_count, expenses_total, sales_count, sales_total,
      journal_entries_count, row_hash_set, journal_hash_set
    )
    values (
      v_org, p_batch_id, v_expenses_count, v_expenses_total, v_sales_count, v_sales_total,
      v_journal_count, v_row_hash_set, v_journal_hash_set
    );

    for r in
      select je.*
        from public.journal_entries je
       where je.org_id = v_org
         and je.status = 'posted'
         and (
           (
             je.source_type = 'expense'
             and exists (
               select 1 from public.reconciliation_batch_rows br
                where br.batch_id = p_batch_id
                  and br.disposition = 'include'
                  and br.corrects_expense_id = je.source_id
             )
           )
           or (
             je.source_type = 'sale'
             and exists (
               select 1 from public.reconciliation_batch_rows br
                where br.batch_id = p_batch_id
                  and br.disposition = 'include'
                  and br.corrects_sale_id = je.source_id
             )
           )
         )
       order by je.id
       for update of je
    loop
      insert into public.reconciliation_baseline_journal_headers(
        org_id, batch_id, original_journal_entry_id, entry_date, source_type,
        source_id, source_sequence, description, status, posted_at, posted_by,
        reversal_of, canonical_hash
      )
      values (
        r.org_id, p_batch_id, r.id, r.entry_date, r.source_type,
        r.source_id, r.source_sequence, r.description, r.status, r.posted_at,
        r.posted_by, r.reversal_of,
        encode(sha256(convert_to(jsonb_build_object(
          'original_journal_entry_id', r.id,
          'entry_date', r.entry_date,
          'source_type', r.source_type,
          'source_id', r.source_id,
          'source_sequence', r.source_sequence,
          'description', r.description,
          'status', r.status,
          'posted_at', r.posted_at,
          'posted_by', r.posted_by,
          'reversal_of', r.reversal_of
        )::text, 'UTF8')), 'hex')
      )
      returning id into v_ledger_id;

      insert into public.reconciliation_baseline_journal_lines(
        org_id, baseline_journal_header_id, original_journal_line_id,
        line_ordinal, account_id, debit, credit, description, cost_center_id,
        custody_account_id, custody_movement_id, expense_id,
        payment_request_id, canonical_hash
      )
      select
        line.org_id, v_ledger_id, line.id, line.line_ordinal, line.account_id,
        line.debit, line.credit, line.description, line.cost_center_id,
        line.custody_account_id, line.custody_movement_id, line.expense_id,
        line.payment_request_id,
        encode(sha256(convert_to(jsonb_build_object(
          'original_journal_line_id', line.id,
          'line_ordinal', line.line_ordinal,
          'account_id', line.account_id,
          'debit', line.debit,
          'credit', line.credit,
          'description', line.description,
          'cost_center_id', line.cost_center_id,
          'custody_account_id', line.custody_account_id,
          'custody_movement_id', line.custody_movement_id,
          'expense_id', line.expense_id,
          'payment_request_id', line.payment_request_id
        )::text, 'UTF8')), 'hex')
        from (
          select jl.*, row_number() over (order by jl.id)::integer as line_ordinal
            from public.journal_lines jl
           where jl.journal_entry_id = r.id
        ) line
       order by line.line_ordinal;
    end loop;

    for v_batch_row in
      select br.*
        from public.reconciliation_batch_rows br
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
       order by br.evidence_item_id
       for update
    loop
      v_last_safe_row_locator := v_batch_row.id;
      v_zero_value_skip := false;

      select l.id
        into v_ledger_id
        from public.reconciliation_execution_ledger l
       where l.evidence_item_id = v_batch_row.evidence_item_id
         and l.status = 'executed'
       for update;

      if v_ledger_id is not null then
        update public.reconciliation_batch_rows
           set execution_result = 'skipped',
               execution_error = null
         where id = v_batch_row.id;
        v_skipped_count := v_skipped_count + 1;
        continue;
      end if;

      select ei.source_amount, ei.source_date_parsed, ei.classification,
             ei.invalid_calendar_quality_flag
        into v_evidence
        from public.reconciliation_evidence_items ei
       where ei.id = v_batch_row.evidence_item_id
         and ei.org_id = v_org;

      -- Amount is validated identically for both domains: present, non-negative, exact to 2 dp.
      if v_evidence.source_amount is null
        or v_evidence.source_amount < 0
        or round(v_evidence.source_amount, 2)
             is distinct from v_evidence.source_amount
      then
        raise exception 'source amount or date is not executable' using errcode = '23514';
      end if;

      if v_batch_row.target_table = 'expenses' then
        -- ── expense domain (20260726150000 semantics, unchanged) ────────────────────────────────
        if v_evidence.source_date_parsed is null
          or coalesce(v_evidence.invalid_calendar_quality_flag, false)
        then
          raise exception 'source amount or date is not executable' using errcode = '23514';
        end if;
        v_effective_date := v_evidence.source_date_parsed;

        select a.id
          into v_dimension_id
          from public.accounts a
         where a.id = v_batch_row.expense_account_id
           and a.org_id = v_org
           and a.active
           and a.kind = v_batch_row.expense_kind
           and not exists (
             select 1
               from public.accounts child
              where child.parent_id = a.id
                and child.org_id = v_org
                and child.active
           )
         for update;
        if v_dimension_id is null then
          raise exception 'reviewed expense account is not executable' using errcode = '23514';
        end if;
        if v_batch_row.expense_cost_center_id is not null and not exists (
          select 1 from public.cost_centers c
           where c.id = v_batch_row.expense_cost_center_id and c.org_id = v_org
        ) then
          raise exception 'reviewed cost center is not executable' using errcode = '23514';
        end if;
        if v_batch_row.expense_supplier_id is not null and not exists (
          select 1 from public.suppliers s
           where s.id = v_batch_row.expense_supplier_id and s.org_id = v_org
        ) then
          raise exception 'reviewed supplier is not executable' using errcode = '23514';
        end if;
      else
        -- ── sale domain ─────────────────────────────────────────────────────────────────────────
        -- The reviewed effective date governs (that is precisely why sale_effective_date and
        -- sale_historical_date_decision exist on the batch row), so — unlike the expense path — an
        -- unparseable source date is not automatically fatal: it is fatal unless the reviewer
        -- explicitly took the manual-override decision.
        if v_batch_row.sale_historical_date_decision is null
          or v_batch_row.sale_effective_date is null
        then
          raise exception 'reviewed sale effective date decision is required' using errcode = '23514';
        end if;
        if (
          v_evidence.source_date_parsed is null
          or coalesce(v_evidence.invalid_calendar_quality_flag, false)
        ) and v_batch_row.sale_historical_date_decision is distinct from 'manual_override' then
          raise exception 'source amount or date is not executable' using errcode = '23514';
        end if;
        if v_batch_row.sale_historical_date_decision = 'use_source_text_date'
          and v_batch_row.sale_effective_date is distinct from v_evidence.source_date_parsed
        then
          raise exception 'reviewed sale effective date does not match the source date'
            using errcode = '23514';
        end if;
        if v_batch_row.sale_historical_date_decision = 'use_matched_production_date' then
          if v_batch_row.corrects_sale_id is null then
            raise exception 'a matched production date requires a correction target'
              using errcode = '23514';
          end if;
          select coalesce(t.sale_date, t.created_at::date)
            into v_matched_production_date
            from public.sales t
           where t.id = v_batch_row.corrects_sale_id
             and t.org_id = v_org;
          if v_matched_production_date is null
            or v_batch_row.sale_effective_date is distinct from v_matched_production_date
          then
            raise exception 'reviewed sale effective date does not match the matched production date'
              using errcode = '23514';
          end if;
        end if;
        if v_batch_row.sale_historical_date_decision = 'manual_override'
          and nullif(trim(coalesce(v_batch_row.review_reason, '')), '') is null
        then
          raise exception 'a manual sale date override requires a review reason'
            using errcode = '23514';
        end if;
        v_effective_date := v_batch_row.sale_effective_date;

        -- The reviewed money must reconcile to the evidence exactly — the reviewed total IS the
        -- source amount, and quantity x unit price must reproduce it to the cent.
        if v_batch_row.sale_recorded_total is distinct from v_evidence.source_amount then
          raise exception 'reviewed sale total does not match the source amount'
            using errcode = '23514';
        end if;
        -- Quantity x unit price must reproduce the amount, but only to within one cent: a legitimate
        -- 2-dp sheet row can be a cent off its own product (7.5 x 1333.33 = 9,999.98 against a
        -- recorded 10,000.00). The authoritative posted figure is always `source_amount`; this is a
        -- sanity cross-check on the reviewed decomposition, not a second source of truth.
        if abs(
             round(coalesce(v_batch_row.sale_quantity, 0)
                   * coalesce(v_batch_row.sale_unit_price, 0), 2)
             - v_evidence.source_amount
           ) > 0.01 then
          raise exception 'reviewed sale quantity and unit price do not reconcile to the source amount'
            using errcode = '23514';
        end if;
        if nullif(trim(coalesce(v_batch_row.sale_crop, '')), '') is null then
          raise exception 'reviewed sale crop is required' using errcode = '23514';
        end if;

        -- Deterministic crop -> typed revenue leaf, re-resolved and re-validated at EXECUTION time
        -- so a leaf archived after review fails the batch instead of silently posting.
        select a.id
          into v_revenue_account
          from public.accounts a
         where a.org_id = v_org
           and a.code = private.fn_reconciliation_historical_sale_revenue_code(v_batch_row.sale_crop)
           and a.account_type = 'revenue'
           and a.active
           and not exists (
             select 1
               from public.accounts child
              where child.parent_id = a.id
                and child.org_id = v_org
                and child.active
           )
         for update;
        if v_revenue_account is null then
          raise exception 'reviewed sale revenue account is not executable' using errcode = '23514';
        end if;

        if v_batch_row.sale_buyer_id is not null and not exists (
          select 1 from public.buyers b
           where b.id = v_batch_row.sale_buyer_id and b.org_id = v_org and b.active
        ) then
          raise exception 'reviewed buyer is not executable' using errcode = '23514';
        end if;
        if v_batch_row.sale_cost_center_id is not null and not exists (
          select 1 from public.cost_centers c
           where c.id = v_batch_row.sale_cost_center_id
             and c.org_id = v_org
             and c.active
             and not exists (
               select 1 from public.cost_centers child
                where child.parent_id = c.id and child.active
             )
        ) then
          raise exception 'reviewed sale cost center is not executable' using errcode = '23514';
        end if;
        if v_batch_row.sale_farm_id is not null and not exists (
          select 1 from public.farms f
           where f.id = v_batch_row.sale_farm_id and f.org_id = v_org
        ) then
          raise exception 'reviewed sale farm is not executable' using errcode = '23514';
        end if;
        if v_batch_row.sale_sector_id is not null and not exists (
          select 1 from public.sectors sec
           where sec.id = v_batch_row.sale_sector_id
             and sec.org_id = v_org
             and sec.farm_id = v_batch_row.sale_farm_id
        ) then
          raise exception 'reviewed sale sector is not executable' using errcode = '23514';
        end if;
        if v_batch_row.sale_hawsha_id is not null and not exists (
          select 1 from public.hawshat h
           where h.id = v_batch_row.sale_hawsha_id
             and h.org_id = v_org
             and h.sector_id = v_batch_row.sale_sector_id
        ) then
          raise exception 'reviewed sale hawsha is not executable' using errcode = '23514';
        end if;
      end if;

      if v_batch_row.corrects_expense_id is not null then
        if exists (
          select 1
            from public.expenses target
           where target.id = v_batch_row.corrects_expense_id
             and (
               target.payment_status is not null
               and target.payment_status <> 'historical_treasury'
             )
        ) or exists (
          select 1
            from public.custody_movements movement
           where movement.expense_id = v_batch_row.corrects_expense_id
        ) or exists (
          select 1
            from public.payment_request_lines request_line
           where request_line.expense_id = v_batch_row.corrects_expense_id
        ) or exists (
          select 1
            from public.journal_entries payment_journal
           where payment_journal.org_id = v_org
             and payment_journal.source_type = 'expense_payment'
             and payment_journal.source_id = v_batch_row.corrects_expense_id
        ) then
          raise exception 'correction target has another payment path'
            using errcode = '23514';
        end if;

        select je.id
          into v_original_journal_id
          from public.journal_entries je
         where je.org_id = v_org
           and je.source_type = 'expense'
           and je.source_id = v_batch_row.corrects_expense_id
           and je.status = 'posted'
         order by je.source_sequence desc
         limit 1
         for update;
        if v_original_journal_id is null then
          raise exception 'correction target has no posted journal' using errcode = '23514';
        end if;
        if not exists (
          select 1
            from public.expenses target
           where target.id = v_batch_row.corrects_expense_id
             and target.org_id = v_org
             and target.total > 0
             and target.account_id is not null
             and (
               select count(*)
                 from public.journal_lines line
                where line.journal_entry_id = v_original_journal_id
             ) = 2
             and exists (
               select 1
                 from public.journal_lines debit_line
                where debit_line.journal_entry_id = v_original_journal_id
                  and debit_line.account_id = target.account_id
                  and debit_line.expense_id = target.id
                  and debit_line.debit = target.total
                  and debit_line.credit = 0
             )
             and exists (
               select 1
                 from public.journal_lines cash_line
                 join public.accounts cash_account
                   on cash_account.id = cash_line.account_id
                  and cash_account.org_id = target.org_id
                  and cash_account.code = '1010'
                where cash_line.journal_entry_id = v_original_journal_id
                  and cash_line.expense_id = target.id
                  and cash_line.debit = 0
                  and cash_line.credit = target.total
             )
        ) then
          raise exception 'correction target expense and journal do not match'
            using errcode = '23514';
        end if;

        v_reversal_journal_id := public.fn_reverse_journal_entry(
          p_entry => v_original_journal_id,
          p_reason => coalesce(
            nullif(v_batch_row.review_reason, ''),
            'approved reconciliation correction'
          ),
          p_reversal_date => v_effective_date
        );
        insert into public.reconciliation_action_links(
          org_id, batch_id, batch_row_id, action_kind, target_table,
          target_id, journal_entry_id
        )
        values (
          v_org, p_batch_id, v_batch_row.id, 'correction_reversal',
          'expenses', v_batch_row.corrects_expense_id, v_reversal_journal_id
        );
        update public.expenses
           set payment_status = 'historical_reversed'
         where id = v_batch_row.corrects_expense_id
           and org_id = v_org;
        v_expected_posted_journal_delta :=
          v_expected_posted_journal_delta - 1;
      end if;

      if v_batch_row.corrects_sale_id is not null then
        -- Eligibility is the PROVEN historical shape and nothing else. Requiring
        -- payment_status = 'historical_treasury' rejects an operational A/R sale, a
        -- collected/partially-collected sale, and an already-reversed target in one clause; the
        -- helper independently re-proves the Dr 1010 / Cr typed-revenue-leaf journal, the exact
        -- total and economic date, the single-journal/two-line shape, and the absence of any
        -- collection row. Nothing here is heuristic.
        if not exists (
          select 1
            from public.sales target
           where target.id = v_batch_row.corrects_sale_id
             and target.org_id = v_org
             and target.payment_status = 'historical_treasury'
        ) then
          raise exception 'correction target sale is not an eligible historical treasury sale'
            using errcode = '23514';
        end if;
        if exists (
          select 1
            from public.sale_collections collection
           where collection.sale_id = v_batch_row.corrects_sale_id
        ) then
          raise exception 'correction target has another collection path'
            using errcode = '23514';
        end if;

        select je.id
          into v_original_journal_id
          from public.journal_entries je
         where je.org_id = v_org
           and je.source_type = 'sale'
           and je.source_id = v_batch_row.corrects_sale_id
           and je.status = 'posted'
         order by je.source_sequence desc
         limit 1
         for update;
        if v_original_journal_id is null then
          raise exception 'correction target has no posted journal' using errcode = '23514';
        end if;
        if not private.fn_reconciliation_sale_has_exact_historical_journal(
             v_batch_row.corrects_sale_id
           ) then
          raise exception 'correction target sale and journal do not match'
            using errcode = '23514';
        end if;

        v_reversal_journal_id := public.fn_reverse_journal_entry(
          p_entry => v_original_journal_id,
          p_reason => coalesce(
            nullif(v_batch_row.review_reason, ''),
            'approved reconciliation correction'
          ),
          p_reversal_date => v_effective_date
        );
        insert into public.reconciliation_action_links(
          org_id, batch_id, batch_row_id, action_kind, target_table,
          target_id, journal_entry_id
        )
        values (
          v_org, p_batch_id, v_batch_row.id, 'correction_reversal',
          'sales', v_batch_row.corrects_sale_id, v_reversal_journal_id
        );
        update public.sales
           set payment_status = 'historical_reversed'
         where id = v_batch_row.corrects_sale_id
           and org_id = v_org;
        v_expected_posted_journal_delta :=
          v_expected_posted_journal_delta - 1;
      end if;

      if v_evidence.source_amount = 0 then
        -- A zero-value addition posts nothing: it is an acknowledged no-op, so it is
        -- reported as skipped (and claimed in the ledger so it cannot be replayed).
        -- A zero-value correction still reverses a real journal, so it stays executed.
        v_zero_value_skip := v_batch_row.corrects_expense_id is null
                         and v_batch_row.corrects_sale_id is null;
        if v_zero_value_skip then
          insert into public.reconciliation_action_links(
            org_id, batch_id, batch_row_id, action_kind
          )
          values (v_org, p_batch_id, v_batch_row.id, 'zero_value_noop');
        end if;
        update public.reconciliation_batch_rows
           set execution_result = case
                 when v_zero_value_skip then 'skipped' else 'reversed'
               end,
               execution_error = null
         where id = v_batch_row.id;
      elsif v_batch_row.target_table = 'expenses' then
        if v_batch_row.expense_payment_decision is distinct from 'routed_now' then
          raise exception 'positive historical expense must be routed to treasury'
            using errcode = '23514';
        end if;

        v_result := public.fn_save_expense(
          p_id => null,
          p_org => v_org,
          p_date => v_effective_date,
          p_category => v_batch_row.expense_category,
          p_total => v_evidence.source_amount,
          p_description => v_batch_row.expense_description,
          p_supplier_id => v_batch_row.expense_supplier_id,
          p_kind => v_batch_row.expense_kind,
          p_account_id => v_batch_row.expense_account_id,
          p_cost_center_id => v_batch_row.expense_cost_center_id
        );
        v_new_expense_id := (v_result->>'id')::uuid;
        if v_new_expense_id is null then
          raise exception 'expense save returned no id' using errcode = '23514';
        end if;

        if v_batch_row.corrects_expense_id is not null then
          update public.expenses
             set corrects_expense_id = v_batch_row.corrects_expense_id
           where id = v_new_expense_id
             and org_id = v_org;
        end if;

        v_new_journal_id := public.fn_post_two_line_journal(
          p_org => v_org,
          p_entry_date => v_effective_date,
          p_source_type => 'expense',
          p_source_id => v_new_expense_id,
          p_description => left(coalesce(v_batch_row.expense_description, ''), 500),
          p_debit_account => v_batch_row.expense_account_id,
          p_credit_account => v_cash_account,
          p_amount => v_evidence.source_amount,
          p_expense => v_new_expense_id
        );

        update public.expenses
           set payment_status = 'historical_treasury'
         where id = v_new_expense_id
           and org_id = v_org;

        insert into public.reconciliation_action_links(
          org_id, batch_id, batch_row_id, action_kind, target_table,
          target_id, journal_entry_id
        )
        values (
          v_org, p_batch_id, v_batch_row.id,
          case when v_batch_row.corrects_expense_id is null
            then 'addition' else 'correction_replacement' end,
          'expenses', v_new_expense_id, v_new_journal_id
        );

        update public.reconciliation_batch_rows
           set execution_result = case
                 when v_batch_row.corrects_expense_id is null then 'posted'
                 else 'reversed'
               end,
               execution_error = null
         where id = v_batch_row.id;

        v_expected_expenses_total :=
          v_expected_expenses_total + v_evidence.source_amount;
        v_expected_expenses_count := v_expected_expenses_count + 1;
        v_expected_posted_journal_delta :=
          v_expected_posted_journal_delta + 1;
      else
        -- Positive historical SALE addition/replacement. The economic row is created through the
        -- existing fn_save_sale contract (so every crop/dimension rule it owns still applies), then
        -- priced and posted as the PROVEN historical cash-in entry. fn_finalize_sale_price is
        -- deliberately NOT used: it posts the OPERATIONAL Dr 1200 / Cr 4000 receivable entry, which
        -- would fabricate a receivable that this evidence proves was never opened.
        v_result := public.fn_save_sale(
          p_id => null,
          p_org => v_org,
          p_sale_date => v_effective_date,
          p_crop => v_batch_row.sale_crop,
          p_buyer_id => v_batch_row.sale_buyer_id,
          p_cost_center_id => v_batch_row.sale_cost_center_id,
          p_farm_id => v_batch_row.sale_farm_id,
          p_sector_id => v_batch_row.sale_sector_id,
          p_hawsha_id => v_batch_row.sale_hawsha_id,
          p_season => v_batch_row.sale_season,
          p_qty => v_batch_row.sale_quantity,
          p_unit => v_batch_row.sale_unit,
          p_delivery_date => v_batch_row.sale_delivery_date,
          p_notes => v_batch_row.sale_notes
        );
        v_new_sale_id := (v_result->>'id')::uuid;
        if v_new_sale_id is null then
          raise exception 'sale save returned no id' using errcode = '23514';
        end if;

        update public.sales
           set unit_price = v_batch_row.sale_unit_price,
               total = v_evidence.source_amount,
               price_status = 'finalized',
               price_finalized_at = now(),
               corrects_sale_id = v_batch_row.corrects_sale_id
         where id = v_new_sale_id
           and org_id = v_org;

        v_new_journal_id := public.fn_post_two_line_journal(
          p_org => v_org,
          p_entry_date => v_effective_date,
          p_source_type => 'sale',
          p_source_id => v_new_sale_id,
          p_description => left(coalesce(v_batch_row.sale_crop, ''), 500),
          p_debit_account => v_cash_account,
          p_credit_account => v_revenue_account,
          p_amount => v_evidence.source_amount
        );

        update public.sales
           set payment_status = 'historical_treasury'
         where id = v_new_sale_id
           and org_id = v_org;

        insert into public.reconciliation_action_links(
          org_id, batch_id, batch_row_id, action_kind, target_table,
          target_id, journal_entry_id
        )
        values (
          v_org, p_batch_id, v_batch_row.id,
          case when v_batch_row.corrects_sale_id is null
            then 'addition' else 'correction_replacement' end,
          'sales', v_new_sale_id, v_new_journal_id
        );

        update public.reconciliation_batch_rows
           set execution_result = case
                 when v_batch_row.corrects_sale_id is null then 'posted'
                 else 'reversed'
               end,
               execution_error = null
         where id = v_batch_row.id;

        v_expected_sales_total :=
          v_expected_sales_total + v_evidence.source_amount;
        v_expected_sales_count := v_expected_sales_count + 1;
        v_expected_posted_journal_delta :=
          v_expected_posted_journal_delta + 1;
      end if;

      select l.id
        into v_ledger_id
        from public.reconciliation_execution_ledger l
       where l.evidence_item_id = v_batch_row.evidence_item_id
         and l.status = 'unexecuted'
       order by l.id
       limit 1
       for update;

      if v_ledger_id is null then
        insert into public.reconciliation_execution_ledger(
          org_id, evidence_item_id, status, executed_by_batch_row_id, executed_at
        )
        values (
          v_org, v_batch_row.evidence_item_id, 'executed',
          v_batch_row.id, now()
        );
      else
        update public.reconciliation_execution_ledger
           set status = 'executed',
               executed_by_batch_row_id = v_batch_row.id,
               executed_at = now(),
               reversed_at = null
         where id = v_ledger_id;
      end if;

      if v_zero_value_skip then
        v_skipped_count := v_skipped_count + 1;
      else
        v_executed_count := v_executed_count + 1;
      end if;
    end loop;

    select count(*)::integer, coalesce(sum(e.total), 0)
      into v_actual_expenses_count, v_actual_expenses_total
      from public.reconciliation_action_links al
      join public.expenses e
        on al.target_table = 'expenses'
       and al.target_id = e.id
       and e.org_id = al.org_id
     where al.batch_id = p_batch_id
       and al.action_kind in ('addition', 'correction_replacement');

    select count(*)::integer, coalesce(sum(coalesce(s.total, 0)), 0)
      into v_actual_sales_count, v_actual_sales_total
      from public.reconciliation_action_links al
      join public.sales s
        on al.target_table = 'sales'
       and al.target_id = s.id
       and s.org_id = al.org_id
     where al.batch_id = p_batch_id
       and al.action_kind in ('addition', 'correction_replacement');

    if v_actual_expenses_count is distinct from v_expected_expenses_count
      or round(v_actual_expenses_total, 2)
           is distinct from round(v_expected_expenses_total, 2)
      or v_actual_sales_count is distinct from v_expected_sales_count
      or round(v_actual_sales_total, 2)
           is distinct from round(v_expected_sales_total, 2)
    then
      raise exception 'domain postflight mismatch' using errcode = '23514';
    end if;

    if (
      select count(*) from public.expenses e where e.org_id = v_org
    ) is distinct from v_expenses_count + v_expected_expenses_count
      or round((
        select coalesce(sum(e.total), 0)
          from public.expenses e
         where e.org_id = v_org
      ), 2) is distinct from round(
        v_expenses_total + v_expected_expenses_total, 2
      )
      or (
        select count(*) from public.sales s where s.org_id = v_org
      ) is distinct from v_sales_count + v_expected_sales_count
      or round((
        select coalesce(sum(coalesce(s.total, 0)), 0)
          from public.sales s
         where s.org_id = v_org
      ), 2) is distinct from round(
        v_sales_total + v_expected_sales_total, 2
      )
      or (
        select count(*)
          from public.journal_entries je
         where je.org_id = v_org
           and je.status = 'posted'
      ) is distinct from v_journal_count + v_expected_posted_journal_delta
    then
      raise exception 'organization accounting baseline delta mismatch'
        using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_action_links al
        join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id
       where al.batch_id = p_batch_id
       group by al.journal_entry_id
      having round(sum(jl.debit), 2) is distinct from round(sum(jl.credit), 2)
    ) then
      raise exception 'journal postflight mismatch' using errcode = '23514';
    end if;

    if exists (
      select 1
        from jsonb_array_elements(v_row_hash_set) baseline_row
        join public.expenses e on e.id = (baseline_row->>'id')::uuid
       where baseline_row->>'target_table' = 'expenses'
         and (
           baseline_row->>'hash' is distinct from encode(sha256(convert_to(jsonb_build_object(
             'id', e.id,
             'org_id', e.org_id,
             'date', e.date,
             'farm_id', e.farm_id,
             'sector_id', e.sector_id,
             'hawsha_id', e.hawsha_id,
             'event_id', e.event_id,
             'plan_id', e.plan_id,
             'category', e.category,
             'description', e.description,
             'supplier_id', e.supplier_id,
             'qty', e.qty,
             'unit', e.unit,
             'unit_price', e.unit_price,
             'total', e.total,
             'payment_method', e.payment_method,
             'recorded_by', e.recorded_by,
             'approved_by', e.approved_by,
             'status', e.status,
             'payment_status', e.payment_status,
             'paid_by', e.paid_by,
             'kind', e.kind,
             'account_id', e.account_id,
             'cost_center_id', e.cost_center_id,
             'corrects_expense_id', e.corrects_expense_id,
             'reversed_by_rollback_at', e.reversed_by_rollback_at
           )::text, 'UTF8')), 'hex')
           or e.payment_status is distinct from 'historical_reversed'
         )
    ) or exists (
      select 1
        from jsonb_array_elements(v_row_hash_set) baseline_row
        join public.sales s on s.id = (baseline_row->>'id')::uuid
       where baseline_row->>'target_table' = 'sales'
         and (
           baseline_row->>'hash' is distinct from encode(sha256(convert_to(
             to_jsonb(s)::text, 'UTF8')), 'hex')
           or s.payment_status is distinct from 'historical_reversed'
         )
    ) then
      raise exception 'correction target changed during execution' using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_action_links reversal
        join public.journal_entries reversal_entry
          on reversal_entry.id = reversal.journal_entry_id
        join public.reconciliation_baseline_journal_headers original
          on original.batch_id = reversal.batch_id
         and original.source_id = reversal.target_id
       where reversal.batch_id = p_batch_id
         and reversal.action_kind = 'correction_reversal'
         and (
           reversal_entry.reversal_of is distinct from original.original_journal_entry_id
           or not exists (
             select 1
               from public.journal_entries original_entry
              where original_entry.id = original.original_journal_entry_id
                and original_entry.status = 'reversed'
           )
         )
    ) then
      raise exception 'correction reversal linkage mismatch' using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_baseline_journal_headers baseline
        left join public.journal_entries original
          on original.id = baseline.original_journal_entry_id
       where baseline.batch_id = p_batch_id
         and (
           original.id is null
           or original.org_id is distinct from baseline.org_id
           or original.entry_date is distinct from baseline.entry_date
           or original.source_type is distinct from baseline.source_type
           or original.source_id is distinct from baseline.source_id
           or original.source_sequence is distinct from baseline.source_sequence
           or original.description is distinct from baseline.description
           or original.status is distinct from 'reversed'
           or original.posted_at is distinct from baseline.posted_at
           or original.posted_by is distinct from baseline.posted_by
           or original.reversal_of is distinct from baseline.reversal_of
         )
    ) then
      raise exception 'original journal header changed during correction'
        using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_baseline_journal_lines baseline_line
        join public.reconciliation_baseline_journal_headers baseline_header
          on baseline_header.id = baseline_line.baseline_journal_header_id
        left join public.journal_lines original_line
          on original_line.id = baseline_line.original_journal_line_id
       where baseline_header.batch_id = p_batch_id
         and (
           original_line.id is null
           or original_line.org_id is distinct from baseline_line.org_id
           or original_line.journal_entry_id
                is distinct from baseline_header.original_journal_entry_id
           or original_line.account_id is distinct from baseline_line.account_id
           or original_line.debit is distinct from baseline_line.debit
           or original_line.credit is distinct from baseline_line.credit
           or original_line.description is distinct from baseline_line.description
           or original_line.cost_center_id is distinct from baseline_line.cost_center_id
           or original_line.custody_account_id is distinct from baseline_line.custody_account_id
           or original_line.custody_movement_id is distinct from baseline_line.custody_movement_id
           or original_line.expense_id is distinct from baseline_line.expense_id
           or original_line.payment_request_id is distinct from baseline_line.payment_request_id
         )
    ) or exists (
      select 1
        from public.reconciliation_baseline_journal_headers baseline_header
       where baseline_header.batch_id = p_batch_id
         and (
           select count(*) from public.journal_lines original_line
            where original_line.journal_entry_id =
                  baseline_header.original_journal_entry_id
         ) is distinct from (
           select count(*) from public.reconciliation_baseline_journal_lines baseline_line
            where baseline_line.baseline_journal_header_id = baseline_header.id
         )
    ) then
      raise exception 'original journal lines changed during correction'
        using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_action_links reversal
        join public.reconciliation_baseline_journal_headers baseline_header
          on baseline_header.batch_id = reversal.batch_id
         and baseline_header.source_id = reversal.target_id
       where reversal.batch_id = p_batch_id
         and reversal.action_kind = 'correction_reversal'
         and (
           exists (
             (
               select account_id, credit, debit, cost_center_id,
                      custody_account_id, custody_movement_id, expense_id,
                      payment_request_id
                 from public.reconciliation_baseline_journal_lines
                where baseline_journal_header_id = baseline_header.id
               except all
               select account_id, debit, credit, cost_center_id,
                      custody_account_id, custody_movement_id, expense_id,
                      payment_request_id
                 from public.journal_lines
                where journal_entry_id = reversal.journal_entry_id
             )
             union all
             (
               select account_id, debit, credit, cost_center_id,
                      custody_account_id, custody_movement_id, expense_id,
                      payment_request_id
                 from public.journal_lines
                where journal_entry_id = reversal.journal_entry_id
               except all
               select account_id, credit, debit, cost_center_id,
                      custody_account_id, custody_movement_id, expense_id,
                      payment_request_id
                 from public.reconciliation_baseline_journal_lines
                where baseline_journal_header_id = baseline_header.id
             )
           )
         )
    ) then
      raise exception 'reversal journal is not the exact inverse of its snapshot'
        using errcode = '23514';
    end if;

  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      -- Retryable concurrency failures are NOT a verdict on the batch. Persisting one as terminal
      -- `failed` would strand a perfectly valid approved batch on a transient
      -- serialization/deadlock/lock-timeout error. Re-raise instead: the outer transaction
      -- (including the `executing` status write) rolls back and the batch is left
      -- `approved`, so the owner can simply retry.
      if v_sqlstate in ('40001', '40P01', '55P03') then
        raise;
      end if;
      v_failure := true;
      v_failure_code := case
        when v_sqlstate = '55000' then 'locked_period'
        when v_sqlstate in ('23503', '23505', '23514') then 'integrity_check'
        when v_sqlstate in ('22023', '23502') then 'invalid_state'
        else 'execution_failed'
      end;
  end;

  if v_failure then
    update public.reconciliation_batches
       set status = 'failed',
           result_summary = jsonb_build_object(
             'failure_code', v_failure_code,
             'safe_locator', v_last_safe_row_locator
           )
     where id = p_batch_id;
    return jsonb_build_object(
      'batch_id', p_batch_id,
      'status', 'failed',
      'failure_code', v_failure_code,
      'safe_locator', v_last_safe_row_locator
    );
  end if;

  update public.reconciliation_batches
     set status = 'executed',
         result_summary = jsonb_build_object(
           'executed_rows', v_executed_count,
           'skipped_rows', v_skipped_count
         )
   where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'executed',
    'executed_rows', v_executed_count,
    'skipped_rows', v_skipped_count
  );
end;
$$;

revoke execute on function public.fn_execute_reconciliation_batch(uuid)
  from public, anon;
grant execute on function public.fn_execute_reconciliation_batch(uuid)
  to authenticated;

comment on function public.fn_execute_reconciliation_batch(uuid) is
  'Owner-only, whole-batch atomic expense and historical-sale reconciliation execution.';

comment on column public.sales.payment_status is
  'unpaid | partially_collected | collected (operational A/R lifecycle) plus '
  'historical_treasury | historical_reversed (reconciliation-created direct-treasury sales, '
  'Dr 1010 / Cr typed revenue leaf, cash-settled at posting and never collectible).';

commit;
