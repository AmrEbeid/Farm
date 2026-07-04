-- SPEC-0024 S-7 — بنك الفسائل (offshoot bank): a PHYSICAL-quantity ledger for date-palm offshoots.
--
-- Tracks offshoot movements (produce = separated from a mother قطاع; plant = planted into a cost center;
-- sell = sold off; replant = used to replace a dead palm) as quantities only — NO money. The money side
-- of selling offshoots flows through the revenue path (S-10, crop=فسائل); this ledger is the physical
-- counterpart. An Owner-set valuation RANGE (low/high per unit) is stored for display/estimation only and
-- is NEVER posted as revenue (#1: an estimate is labelled «تقدير», not booked).
--
-- Read posture: offshoot_movements is org-readable (operational — the farm manager tracks the nursery, so
-- it is intentionally NOT finance-gated). offshoot_valuation is finance.read (it is a money estimate).
-- Writes: ledger via plan.write (owner/farm_manager — the FM runs the nursery); valuation via budget.write
-- (owner/accountant). NO authorize() change (reuses existing perms). RPC-only, SECURITY DEFINER,
-- search_path='', EXECUTE-locked, RLS + FORCE RLS + audit. Non-authoritative until Owner applies + merges.
begin;

-- ── 1) offshoot_movements (quantities; org-readable) ──────────────────────────────────────────────────
create table if not exists public.offshoot_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  movement_date date not null default current_date,
  movement_type text not null check (movement_type in ('produce','plant','sell','replant')),
  qty numeric not null check (qty > 0),
  source_cost_center_id uuid references public.cost_centers(id),   -- mother قطاع/enterprise (produce)
  dest_cost_center_id uuid references public.cost_centers(id),     -- where planted/replanted
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists offshoot_movements_org_date_idx on public.offshoot_movements(org_id, movement_date desc);
create index if not exists offshoot_movements_source_cc_idx on public.offshoot_movements(source_cost_center_id);
create index if not exists offshoot_movements_dest_cc_idx on public.offshoot_movements(dest_cost_center_id);
alter table public.offshoot_movements enable row level security;
alter table public.offshoot_movements force row level security;
drop policy if exists tenant_read on public.offshoot_movements;
create policy tenant_read on public.offshoot_movements for select to authenticated
  using (org_id in (select public.user_org_ids()));
grant select on public.offshoot_movements to authenticated;
revoke insert, update, delete on public.offshoot_movements from authenticated, anon;
drop trigger if exists audit_offshoot_movement on public.offshoot_movements;
create trigger audit_offshoot_movement after insert or update or delete on public.offshoot_movements
  for each row execute function public.fn_audit('offshoot_movement');

-- ── 2) offshoot_valuation (one row per org; finance.read) ─────────────────────────────────────────────
create table if not exists public.offshoot_valuation (
  id uuid primary key default gen_random_uuid(),                   -- fn_audit keys on new.id
  org_id uuid not null unique references public.organization(id) on delete cascade,
  low_per_unit numeric check (low_per_unit is null or low_per_unit >= 0),
  high_per_unit numeric check (high_per_unit is null or high_per_unit >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint offshoot_valuation_range check (low_per_unit is null or high_per_unit is null or low_per_unit <= high_per_unit)
);
alter table public.offshoot_valuation enable row level security;
alter table public.offshoot_valuation force row level security;
drop policy if exists tenant_read on public.offshoot_valuation;
create policy tenant_read on public.offshoot_valuation for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('finance.read', org_id));
grant select on public.offshoot_valuation to authenticated;
revoke insert, update, delete on public.offshoot_valuation from authenticated, anon;
drop trigger if exists audit_offshoot_valuation on public.offshoot_valuation;
create trigger audit_offshoot_valuation after insert or update or delete on public.offshoot_valuation
  for each row execute function public.fn_audit('offshoot_valuation');

-- ── 3) audit_read re-emit — gate 'offshoot_valuation' (finance.read; H2 leak invariant, tests/56) ─────
-- Re-emitted from the latest source (S-3 migration 20260701460000, which added 'cost_center'). offshoot_valuation
-- is finance-restricted so its audit rows must be gated; offshoot_movement is org-readable (not role-restricted)
-- so it stays in the open set and needs no gate.
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated
  using (
    org_id in (select public.user_org_ids())
    and (
      (
        entity_type is distinct from 'people_compensation'
        and entity_type not in (
          'sale','expense','custody_account','custody_movement','payment_request','payment_request_line',
          'account','journal_entry','journal_line','payment_request_funding','cost_center','offshoot_valuation'
        )
      )
      or (entity_type = 'people_compensation' and public.authorize('payroll.read', org_id))
      or (entity_type in ('sale','expense') and public.authorize('budget.write', org_id))
      or (
        entity_type in (
          'custody_account','custody_movement','payment_request','payment_request_line',
          'account','journal_entry','journal_line','payment_request_funding','cost_center','offshoot_valuation'
        )
        and public.authorize('finance.read', org_id)
      )
    )
  );

-- ── 4) fn_record_offshoot_movement (plan.write — owner/farm_manager run the nursery) ──────────────────
create or replace function public.fn_record_offshoot_movement(
  p_org uuid, p_movement_type text, p_qty numeric,
  p_movement_date date default current_date,
  p_source_cost_center_id uuid default null,
  p_dest_cost_center_id uuid default null,
  p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_src_org uuid; v_dst_org uuid; v_dst_active boolean; v_dst_system boolean; v_dst_child boolean;
begin
  if coalesce(p_movement_type,'') not in ('produce','plant','sell','replant') then
    raise exception 'invalid movement_type: %', p_movement_type using errcode = '22023'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'qty must be positive' using errcode = '22023'; end if;
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org offshoot movement' using errcode = '42501'; end if;
  if not public.authorize('plan.write', p_org) then raise exception 'forbidden: plan.write is required (owner/farm_manager)' using errcode = '42501'; end if;

  if p_source_cost_center_id is not null then
    select org_id into v_src_org from public.cost_centers where id = p_source_cost_center_id;
    if v_src_org is distinct from p_org then raise exception 'forbidden: cross-org source cost center' using errcode = '42501'; end if;
  end if;

  -- plant/replant land offshoots into a specific cost center → require an active leaf destination.
  if p_movement_type in ('plant','replant') then
    if p_dest_cost_center_id is null then
      raise exception 'a % movement requires a destination cost center', p_movement_type using errcode = '23502'; end if;
    select org_id, active, is_system into v_dst_org, v_dst_active, v_dst_system
      from public.cost_centers where id = p_dest_cost_center_id;
    if v_dst_org is distinct from p_org then raise exception 'forbidden: cross-org destination cost center' using errcode = '42501'; end if;
    if not coalesce(v_dst_active,false) then raise exception 'destination cost center is inactive' using errcode = '22023'; end if;
    if coalesce(v_dst_system,false) then raise exception 'destination cost center must not be a system center' using errcode = '22023'; end if;
    select exists(select 1 from public.cost_centers c where c.parent_id = p_dest_cost_center_id and c.active) into v_dst_child;
    if v_dst_child then raise exception 'destination cost center must be an active leaf' using errcode = '22023'; end if;
  elsif p_dest_cost_center_id is not null then
    -- produce/sell don't plant anywhere; reject a stray destination to keep the ledger honest.
    raise exception 'a % movement must not carry a destination cost center', p_movement_type using errcode = '22023';
  end if;

  insert into public.offshoot_movements(org_id, movement_date, movement_type, qty, source_cost_center_id, dest_cost_center_id, note)
  values (p_org, coalesce(p_movement_date, current_date), p_movement_type, p_qty, p_source_cost_center_id, p_dest_cost_center_id,
          nullif(trim(coalesce(p_note,'')),''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'movement_type', p_movement_type, 'qty', p_qty);
end $$;
revoke execute on function public.fn_record_offshoot_movement(uuid, text, numeric, date, uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.fn_record_offshoot_movement(uuid, text, numeric, date, uuid, uuid, text) to authenticated;

-- ── 5) fn_set_offshoot_valuation (budget.write — owner/accountant set the money estimate) ─────────────
create or replace function public.fn_set_offshoot_valuation(p_org uuid, p_low numeric, p_high numeric)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org valuation' using errcode = '42501'; end if;
  if not public.authorize('budget.write', p_org) then raise exception 'forbidden: budget.write is required (owner/accountant)' using errcode = '42501'; end if;
  if p_low is not null and p_low < 0 then raise exception 'low_per_unit must be non-negative' using errcode = '22023'; end if;
  if p_high is not null and p_high < 0 then raise exception 'high_per_unit must be non-negative' using errcode = '22023'; end if;
  if p_low is not null and p_high is not null and p_low > p_high then
    raise exception 'low_per_unit must not exceed high_per_unit' using errcode = '22023'; end if;

  insert into public.offshoot_valuation(org_id, low_per_unit, high_per_unit, updated_at, updated_by)
  values (p_org, p_low, p_high, now(), (select auth.uid()))
  on conflict (org_id) do update set low_per_unit = excluded.low_per_unit, high_per_unit = excluded.high_per_unit,
    updated_at = now(), updated_by = (select auth.uid());
  return jsonb_build_object('org_id', p_org, 'low_per_unit', p_low, 'high_per_unit', p_high);
end $$;
revoke execute on function public.fn_set_offshoot_valuation(uuid, numeric, numeric) from public, anon, authenticated;
grant  execute on function public.fn_set_offshoot_valuation(uuid, numeric, numeric) to authenticated;

commit;
