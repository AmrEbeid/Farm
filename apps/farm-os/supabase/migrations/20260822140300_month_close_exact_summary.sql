-- Exact, fail-closed month-close checklist summary.
--
-- The page previously reduced unbounded PostgREST arrays and treated every query error as an
-- empty list. A server/default response cap or transient read error could therefore present a
-- false clean checklist. This read-only RPC computes the full active-org snapshot in the database,
-- applies one explicit as-of date, and reports missing expense amounts separately.
begin;

create or replace function public.fn_month_close_summary(
  p_org uuid,
  p_cutover date,
  p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pending_price_count bigint;
  v_undated_expense_count bigint;
  v_undated_expense_known_total numeric;
  v_undated_expense_unknown_count bigint;
  v_unrouted_count bigint;
  v_unrouted_known_total numeric;
  v_unrouted_unknown_count bigint;
  v_unclassified_count bigint;
  v_unclassified_known_total numeric;
  v_unclassified_unknown_count bigint;
  v_unallocated_count bigint;
  v_unallocated_known_total numeric;
  v_unallocated_unknown_count bigint;
  v_aged_receivable_count bigint;
  v_aged_receivable_total numeric;
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if p_cutover is null or p_as_of is null then
    raise exception 'close summary bounds required' using errcode = '23502';
  end if;
  if p_as_of < p_cutover then
    raise exception 'close summary as-of before cutover' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids())
     or not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: month close summary requires finance.read in this org'
      using errcode = '42501';
  end if;

  -- Expenses historically allowed a NULL business date and have no trustworthy creation timestamp.
  -- Their era therefore cannot be proven. Keep every active undated row explicit and blocking rather
  -- than silently assuming it belongs before the live cutover.
  select
    count(*),
    coalesce(sum(e.total) filter (where e.total is not null), 0),
    count(*) filter (where e.total is null)
    into
      v_undated_expense_count,
      v_undated_expense_known_total,
      v_undated_expense_unknown_count
    from public.expenses e
   where e.org_id = p_org
     and e.date is null
     and coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed');

  select
    count(*) filter (
      where e.payment_status is null
    ),
    coalesce(sum(e.total) filter (
      where e.payment_status is null and e.total is not null
    ), 0),
    count(*) filter (
      where e.payment_status is null and e.total is null
    ),
    count(*) filter (
      where e.account_id is null
        and coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')
    ),
    coalesce(sum(e.total) filter (
      where e.account_id is null and e.total is not null
        and coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')
    ), 0),
    count(*) filter (
      where e.account_id is null and e.total is null
        and coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')
    ),
    count(*) filter (
      where e.cost_center_id is null
        and coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')
    ),
    coalesce(sum(e.total) filter (
      where e.cost_center_id is null and e.total is not null
        and coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')
    ), 0),
    count(*) filter (
      where e.cost_center_id is null and e.total is null
        and coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')
    )
    into
      v_unrouted_count, v_unrouted_known_total, v_unrouted_unknown_count,
      v_unclassified_count, v_unclassified_known_total, v_unclassified_unknown_count,
      v_unallocated_count, v_unallocated_known_total, v_unallocated_unknown_count
    from public.expenses e
   where e.org_id = p_org
     and e.date between p_cutover and p_as_of;

  select count(*)
    into v_pending_price_count
    from public.sales s
   where s.org_id = p_org
     and s.price_status = 'pending'
     and coalesce(s.sale_date, s.delivery_date, (s.created_at at time zone 'UTC')::date)
         between p_cutover and p_as_of;

  with collected as (
    select c.sale_id, sum(c.amount) as amount
      from public.sale_collections c
     where c.org_id = p_org
       and c.occurred_at <= p_as_of
     group by c.sale_id
  ),
  aged as (
    select greatest(s.total - coalesce(c.amount, 0), 0) as outstanding
      from public.sales s
      left join collected c on c.sale_id = s.id
     where s.org_id = p_org
       and s.price_status = 'finalized'
       -- Current `collected` is deliberately NOT excluded: a collection dated after p_as_of may
       -- have changed today's status while the receivable was still open at this snapshot.
       and s.payment_status not in ('historical_treasury', 'historical_reversed')
       and coalesce(s.sale_date, s.delivery_date, (s.created_at at time zone 'UTC')::date)
           between p_cutover and (p_as_of - 30)
  )
  select count(*) filter (where outstanding > 0),
         coalesce(sum(outstanding) filter (where outstanding > 0), 0)
    into v_aged_receivable_count, v_aged_receivable_total
    from aged;

  return jsonb_build_object(
    'org_id', p_org,
    'cutover', p_cutover,
    'as_of', p_as_of,
    'pending_price_count', v_pending_price_count::text,
    'undated_expense_count', v_undated_expense_count::text,
    'undated_expense_known_total', v_undated_expense_known_total::text,
    'undated_expense_unknown_count', v_undated_expense_unknown_count::text,
    'unrouted_count', v_unrouted_count::text,
    'unrouted_known_total', v_unrouted_known_total::text,
    'unrouted_unknown_count', v_unrouted_unknown_count::text,
    'unclassified_count', v_unclassified_count::text,
    'unclassified_known_total', v_unclassified_known_total::text,
    'unclassified_unknown_count', v_unclassified_unknown_count::text,
    'unallocated_count', v_unallocated_count::text,
    'unallocated_known_total', v_unallocated_known_total::text,
    'unallocated_unknown_count', v_unallocated_unknown_count::text,
    'aged_receivable_count', v_aged_receivable_count::text,
    'aged_receivable_total', v_aged_receivable_total::text
  );
end;
$$;

revoke execute on function public.fn_month_close_summary(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.fn_month_close_summary(uuid, date, date)
  to authenticated;

-- Every source write attempts to join the established per-org period mutex in SHARE mode. It never
-- waits: a writer may already hold a source row before this BEFORE ROW trigger runs, so waiting
-- behind a queued close could recreate the row -> close -> mutex deadlock that the mutex protocol
-- removed. Existing writers keep their shared lock and close waits for them; a writer that arrives
-- after close is queued/active fails fast with 55P03 and can be retried after close finishes.
create or replace function private.fn_lock_month_close_source_write()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_old_org uuid;
  v_new_org uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_org := old.org_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new_org := new.org_id;
  end if;

  -- Direct PostgREST writes run this SECURITY INVOKER trigger as authenticated and must prove
  -- tenant membership before touching a mutex: a hostile foreign org_id must fail without becoming
  -- a cross-tenant timing/lock oracle. SECURITY DEFINER RPCs already authorize their organization
  -- before writing; they run this trigger as the owning role and still join the mutex below.
  if current_user = 'authenticated' then
    if (v_old_org is not null and (
      v_old_org not in (select public.user_org_ids())
      or not public.authorize('budget.write', v_old_org)
    )) or (v_new_org is not null and (
      v_new_org not in (select public.user_org_ids())
      or not public.authorize('budget.write', v_new_org)
    )) then
      raise exception 'forbidden: source write requires budget.write in every organization'
        using errcode = '42501';
    end if;
  end if;

  -- Organization moves are unsupported, but try both keys in stable text order. A failed second
  -- try aborts the transaction and releases the first xact lock automatically. Inline the exact
  -- private mutex-key expression because authenticated cannot execute the private helper.
  if v_old_org is not null and v_new_org is not null and v_old_org is distinct from v_new_org then
    if v_old_org::text < v_new_org::text then
      if not pg_catalog.pg_try_advisory_xact_lock_shared(
        ('x' || pg_catalog.substr(pg_catalog.md5(v_old_org::text), 1, 16))::bit(64)::bigint
      ) or not pg_catalog.pg_try_advisory_xact_lock_shared(
        ('x' || pg_catalog.substr(pg_catalog.md5(v_new_org::text), 1, 16))::bit(64)::bigint
      ) then
        raise exception 'month close is in progress; retry the source write'
          using errcode = '55P03';
      end if;
    else
      if not pg_catalog.pg_try_advisory_xact_lock_shared(
        ('x' || pg_catalog.substr(pg_catalog.md5(v_new_org::text), 1, 16))::bit(64)::bigint
      ) or not pg_catalog.pg_try_advisory_xact_lock_shared(
        ('x' || pg_catalog.substr(pg_catalog.md5(v_old_org::text), 1, 16))::bit(64)::bigint
      ) then
        raise exception 'month close is in progress; retry the source write'
          using errcode = '55P03';
      end if;
    end if;
  elsif not pg_catalog.pg_try_advisory_xact_lock_shared(
      ('x' || pg_catalog.substr(
        pg_catalog.md5(coalesce(v_new_org, v_old_org)::text), 1, 16
      ))::bit(64)::bigint
    ) then
      raise exception 'month close is in progress; retry the source write'
        using errcode = '55P03';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function private.fn_lock_month_close_source_write()
  from public, anon, authenticated;

drop trigger if exists month_close_source_mutex on public.expenses;
create trigger month_close_source_mutex
before insert or update or delete on public.expenses
for each row execute function private.fn_lock_month_close_source_write();

drop trigger if exists month_close_source_mutex on public.sales;
create trigger month_close_source_mutex
before insert or update or delete on public.sales
for each row execute function private.fn_lock_month_close_source_write();

drop trigger if exists month_close_source_mutex on public.sale_collections;
create trigger month_close_source_mutex
before insert or update or delete on public.sale_collections
for each row execute function private.fn_lock_month_close_source_write();

-- The released expense-payment reversal locks expense/journal rows before its nested journal
-- reversal joins the accounting-period mutex. Wrap that exact implementation so the organization
-- SHARE lock is acquired first and never waits behind a queued/active close. Moving the released
-- function preserves its body and dependencies byte-for-byte; the public signature becomes a
-- small lock-order guard and the implementation is no longer directly executable by API roles.
do $move_released_reversal$
begin
  if pg_catalog.to_regprocedure(
    'private.fn_reverse_expense_payment_after_month_close_lock(uuid,uuid,text,text,date)'
  ) is null then
    if pg_catalog.to_regprocedure(
      'public.fn_reverse_expense_payment(uuid,uuid,text,text,date)'
    ) is null then
      raise exception 'released fn_reverse_expense_payment prerequisite is missing';
    end if;

    execute 'alter function public.fn_reverse_expense_payment(uuid, uuid, text, text, date) set schema private';
    execute 'alter function private.fn_reverse_expense_payment(uuid, uuid, text, text, date) '
      || 'rename to fn_reverse_expense_payment_after_month_close_lock';
  end if;
end;
$move_released_reversal$;

revoke all on function private.fn_reverse_expense_payment_after_month_close_lock(
  uuid, uuid, text, text, date
) from public, anon, authenticated;

create or replace function public.fn_reverse_expense_payment(
  p_expense uuid,
  p_expected_movement uuid,
  p_outcome text,
  p_reason text,
  p_reversal_date date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_expense is null then
    raise exception 'expense required' using errcode = '23502';
  end if;

  -- Read only the organization before taking any row lock. Cross-org and missing expenses retain
  -- the released P0002 posture; permission checks happen before the advisory lock so it cannot be
  -- used as a tenant timing oracle.
  select expense.org_id
    into v_org
    from public.expenses expense
   where expense.id = p_expense
     and expense.org_id in (select public.user_org_ids());
  if v_org is null then
    raise exception 'expense % not found', p_expense using errcode = 'P0002';
  end if;
  if not public.authorize('custody.write', v_org)
     or not public.authorize('budget.write', v_org) then
    raise exception 'forbidden: custody.write and budget.write are required' using errcode = '42501';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock_shared(
    ('x' || pg_catalog.substr(pg_catalog.md5(v_org::text), 1, 16))::bit(64)::bigint
  ) then
    raise exception 'month close is in progress; retry the expense reversal'
      using errcode = '55P03';
  end if;

  return private.fn_reverse_expense_payment_after_month_close_lock(
    p_expense,
    p_expected_movement,
    p_outcome,
    p_reason,
    p_reversal_date
  );
end;
$$;

revoke all on function public.fn_reverse_expense_payment(uuid, uuid, text, text, date)
  from public, anon, authenticated;
grant execute on function public.fn_reverse_expense_payment(uuid, uuid, text, text, date)
  to authenticated;

-- Re-emit the current close function from 20260726170000 with one added readiness gate. The
-- existing exclusive per-org mutex now serializes against every source mutation above as well as
-- journal posting and reconciliation rollback.
create or replace function public.fn_close_accounting_period(
  p_org uuid,
  p_period_start date,
  p_period_end date,
  p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_readiness jsonb;
  v_blocker_count bigint;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_period_start is null or p_period_end is null then
    raise exception 'period bounds required' using errcode = '23502'; end if;
  if p_period_end < p_period_start then
    raise exception 'period end before start' using errcode = '22023'; end if;
  if p_period_end > (pg_catalog.now() at time zone 'Africa/Cairo')::date then
    raise exception 'period end cannot be after the current Cairo business date'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.organization_member
     where user_id = (select auth.uid()) and org_id = p_org and role in ('owner', 'accountant')
  ) then
    raise exception 'forbidden: only the owner or accountant may close a period' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(private.fn_accounting_period_mutex_key(p_org));

  if exists (
    select 1 from public.accounting_periods
     where org_id = p_org and status = 'locked'
       and daterange(period_start, period_end, '[]') && daterange(p_period_start, p_period_end, '[]')
  ) then
    raise exception 'period overlaps an existing locked period' using errcode = '23505';
  end if;

  -- The imported archive before 2026-07-01 is deliberately outside the live close checklist.
  -- Any period ending in the live era must close every unresolved live-era blocker through its
  -- own end date. Calling the read RPC here reuses the same role/tenant/date semantics as the UI.
  if p_period_end >= date '2026-07-01' then
    v_readiness := public.fn_month_close_summary(p_org, date '2026-07-01', p_period_end);
    v_blocker_count :=
      (v_readiness->>'pending_price_count')::bigint
      + (v_readiness->>'undated_expense_count')::bigint
      + (v_readiness->>'unrouted_count')::bigint
      + (v_readiness->>'unclassified_count')::bigint
      + (v_readiness->>'unallocated_count')::bigint;
    if v_blocker_count > 0 then
      raise exception 'month close blockers remain: %', v_blocker_count using errcode = '55000';
    end if;
  end if;

  insert into public.accounting_periods(org_id, period_start, period_end, status, note)
  values (p_org, p_period_start, p_period_end, 'locked', p_note)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.fn_close_accounting_period(uuid, date, date, text)
  from public, anon;
grant execute on function public.fn_close_accounting_period(uuid, date, date, text)
  to authenticated;

-- Narrow remediation path for the explicit undated-expense blocker. It may fill a missing date
-- exactly once, and never inside a period that is already locked.
create or replace function public.fn_set_missing_expense_date(
  p_org uuid,
  p_expense uuid,
  p_date date)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_current_date date;
begin
  if p_org is null or p_expense is null or p_date is null then
    raise exception 'organization, expense, and date are required' using errcode = '23502';
  end if;
  if p_org not in (select public.user_org_ids())
     or not public.authorize('budget.write', p_org) then
    raise exception 'forbidden: budget.write is required for this expense'
      using errcode = '42501';
  end if;

  select e.date
    into v_current_date
    from public.expenses e
   where e.id = p_expense
     and e.org_id = p_org
   for update;
  if not found then
    raise exception 'expense not found' using errcode = 'P0002';
  end if;
  if v_current_date is not null then
    raise exception 'expense already has a date' using errcode = '55000';
  end if;
  if exists (
    select 1
      from public.accounting_periods p
     where p.org_id = p_org
       and p.status = 'locked'
       and p_date between p.period_start and p.period_end
  ) then
    raise exception 'expense date falls inside a locked accounting period'
      using errcode = '55000';
  end if;

  update public.expenses
     set date = p_date
   where id = p_expense
     and org_id = p_org
     and date is null;
  if not found then
    raise exception 'expense date changed concurrently' using errcode = '40001';
  end if;
  return p_expense;
end;
$$;

revoke all on function public.fn_set_missing_expense_date(uuid, uuid, date)
  from public, anon;
grant execute on function public.fn_set_missing_expense_date(uuid, uuid, date)
  to authenticated;

commit;
