-- SPEC-0024 S-10 / SPEC-0018-EXT §4 — revenue: buyers + sales (delivery-before-price) + collections.
--
-- The core mechanic (Owner-described): a delivery can be recorded BEFORE its price is set. A pending sale
-- carries qty + crop + buyer but NULL unit_price/total and NEVER touches the ledger (honest-null #1: renders
-- «السعر لم يُحدد بعد», never a fabricated 0). fn_finalize_sale_price is the only path that sets the price and
-- posts the revenue journal (Dr ذمم مدينة / Cr إيرادات المبيعات). Collections clear the receivable
-- (Dr نقدية المبيعات / Cr ذمم مدينة) and payment_status is derived from Σ(collections), never caller-written.
--
-- crop + cost_center_id are stored on the sale as reporting DIMENSIONS (#595); the GL posts to summary
-- accounts, so revenue-by-crop / by-cost-center comes from grouping the sales table, not from per-crop GL
-- accounts (which keeps the ledger reconciled and avoids duplicating the COA seed).
--
-- Gate: reuses budget.write (owner/accountant) — the spec's proposed `sale.write` role set — with NO
-- authorize() change (avoids the re-emit union footgun). RPC-only, SECURITY DEFINER, search_path='',
-- EXECUTE-locked, RLS + FORCE RLS + audit, mirroring the expenses/custody pattern.
begin;

-- ── 1) buyers ───────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.buyers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  name text not null,
  buyer_type text not null default 'cash_customer' check (buyer_type in ('cash_customer','trader','company')),
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (org_id, name)
);
create index if not exists buyers_org_idx on public.buyers(org_id, name);
alter table public.buyers enable row level security;
alter table public.buyers force row level security;
drop policy if exists tenant_read on public.buyers;
create policy tenant_read on public.buyers for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('finance.read', org_id));
grant select on public.buyers to authenticated;
revoke insert, update, delete on public.buyers from authenticated, anon;
drop trigger if exists audit_buyer on public.buyers;
create trigger audit_buyer after insert or update or delete on public.buyers
  for each row execute function public.fn_audit('buyer');

-- ── 2) sales (mirrors expenses' shape; unit_price/total NULL while pending) ───────────────────────────
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  sale_date date,
  farm_id uuid references public.farms(id),
  sector_id uuid references public.sectors(id),
  hawsha_id uuid references public.hawshat(id),
  crop text not null,                                    -- reporting dimension, mandatory (#595)
  season text,                                           -- free label until SPEC-0021 season engine lands
  buyer_id uuid references public.buyers(id),
  cost_center_id uuid references public.cost_centers(id),-- reporting dimension (S-3)
  qty numeric check (qty is null or qty >= 0),
  unit text,
  unit_price numeric check (unit_price is null or unit_price >= 0),  -- NULL while price_status='pending'
  total numeric check (total is null or total >= 0),                -- NULL while pending; set at finalize
  price_status text not null default 'pending' check (price_status in ('pending','finalized')),
  delivery_date date,
  price_finalized_at timestamptz,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partially_collected','collected')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  -- a finalized sale MUST have a price; a pending sale MUST NOT (honest-null #1).
  constraint sales_price_consistency check (
    (price_status = 'finalized' and unit_price is not null and total is not null)
    or (price_status = 'pending' and unit_price is null and total is null)
  )
);
create index if not exists sales_org_date_idx on public.sales(org_id, sale_date desc);
create index if not exists sales_buyer_idx on public.sales(buyer_id);
create index if not exists sales_cost_center_idx on public.sales(cost_center_id);
create index if not exists sales_farm_idx on public.sales(farm_id);
create index if not exists sales_sector_idx on public.sales(sector_id);
create index if not exists sales_hawsha_idx on public.sales(hawsha_id);
alter table public.sales enable row level security;
alter table public.sales force row level security;
drop policy if exists tenant_read on public.sales;
create policy tenant_read on public.sales for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('finance.read', org_id));
grant select on public.sales to authenticated;
revoke insert, update, delete on public.sales from authenticated, anon;
drop trigger if exists audit_sale on public.sales;
create trigger audit_sale after insert or update or delete on public.sales
  for each row execute function public.fn_audit('sale');

-- ── 3) sale_collections (partial receipts for A-R; Σ ≤ total) ─────────────────────────────────────────
create table if not exists public.sale_collections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  amount numeric not null check (amount > 0),
  occurred_at date not null default current_date,
  collected_by text,
  note text,
  journal_entry_id uuid references public.journal_entries(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists sale_collections_org_idx on public.sale_collections(org_id);
create index if not exists sale_collections_sale_idx on public.sale_collections(sale_id);
create index if not exists sale_collections_journal_idx on public.sale_collections(journal_entry_id);
alter table public.sale_collections enable row level security;
alter table public.sale_collections force row level security;
drop policy if exists tenant_read on public.sale_collections;
create policy tenant_read on public.sale_collections for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('finance.read', org_id));
grant select on public.sale_collections to authenticated;
revoke insert, update, delete on public.sale_collections from authenticated, anon;
drop trigger if exists audit_sale_collection on public.sale_collections;
create trigger audit_sale_collection after insert or update or delete on public.sale_collections
  for each row execute function public.fn_audit('sale_collection');

-- ── 4) audit_read re-emit — gate the new finance entities (H2 leak invariant, tests/56) ───────────────
-- Re-emitted from the latest source (offshoot bank migration 20260701470000, which added
-- 'offshoot_valuation'). Adds 'buyer' + 'sale_collection' to the finance.read gate; 'sale' is
-- already gated (budget.write) below.
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
          'account','journal_entry','journal_line','payment_request_funding','cost_center','offshoot_valuation',
          'buyer','sale_collection'
        )
      )
      or (entity_type = 'people_compensation' and public.authorize('payroll.read', org_id))
      or (entity_type in ('sale','expense') and public.authorize('budget.write', org_id))
      or (
        entity_type in (
          'custody_account','custody_movement','payment_request','payment_request_line',
          'account','journal_entry','journal_line','payment_request_funding','cost_center','offshoot_valuation',
          'buyer','sale_collection'
        )
        and public.authorize('finance.read', org_id)
      )
    )
  );

-- ── 5) fn_save_buyer ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_save_buyer(
  p_id uuid, p_org uuid, p_name text, p_buyer_type text default 'cash_customer',
  p_phone text default null, p_active boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_id uuid;
begin
  if p_name is null or trim(p_name) = '' then raise exception 'buyer name required' using errcode = '23502'; end if;
  if coalesce(p_buyer_type,'cash_customer') not in ('cash_customer','trader','company') then
    raise exception 'invalid buyer_type: %', p_buyer_type using errcode = '22023'; end if;
  if p_id is not null then
    select org_id into v_org from public.buyers where id = p_id;
    if v_org is null then raise exception 'buyer % not found', p_id using errcode = 'P0002'; end if;
  else
    v_org := p_org;
  end if;
  if v_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org buyer' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;

  if p_id is null then
    insert into public.buyers(org_id, name, buyer_type, phone, active)
    values (v_org, trim(p_name), coalesce(p_buyer_type,'cash_customer'), nullif(trim(coalesce(p_phone,'')),''), coalesce(p_active,true))
    returning id into v_id;
  else
    update public.buyers set name = trim(p_name), buyer_type = coalesce(p_buyer_type,'cash_customer'),
      phone = nullif(trim(coalesce(p_phone,'')),''), active = coalesce(p_active,true) where id = p_id
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.fn_save_buyer(uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
grant  execute on function public.fn_save_buyer(uuid, uuid, text, text, text, boolean) to authenticated;

-- ── 6) fn_save_sale — create/update a PENDING sale (crop mandatory; never posts a journal) ────────────
create or replace function public.fn_save_sale(
  p_id uuid, p_org uuid, p_sale_date date, p_crop text,
  p_buyer_id uuid default null, p_cost_center_id uuid default null,
  p_farm_id uuid default null, p_sector_id uuid default null, p_hawsha_id uuid default null,
  p_season text default null, p_qty numeric default null, p_unit text default null,
  p_delivery_date date default null, p_notes text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid; v_id uuid; v_price_status text; v_buyer_org uuid; v_cc_org uuid; v_cc_active boolean; v_cc_child boolean;
  v_farm_org uuid; v_sector_org uuid; v_sector_farm uuid; v_hawsha_org uuid; v_hawsha_sector uuid;
begin
  if p_crop is null or trim(p_crop) = '' then raise exception 'crop required (reporting dimension)' using errcode = '23502'; end if;
  if p_qty is not null and p_qty < 0 then raise exception 'qty must be non-negative' using errcode = '22023'; end if;

  if p_id is not null then
    select org_id, price_status into v_org, v_price_status from public.sales where id = p_id for update;
    if v_org is null then raise exception 'sale % not found', p_id using errcode = 'P0002'; end if;
    if v_price_status = 'finalized' then
      raise exception 'a finalized sale is immutable; record a correcting entry instead' using errcode = '22023'; end if;
  else
    v_org := p_org;
  end if;
  if v_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org sale' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;

  if p_buyer_id is not null then
    select org_id into v_buyer_org from public.buyers where id = p_buyer_id;
    if v_buyer_org is distinct from v_org then raise exception 'forbidden: cross-org buyer' using errcode = '42501'; end if;
  end if;
  if p_cost_center_id is not null then
    select org_id, active into v_cc_org, v_cc_active from public.cost_centers where id = p_cost_center_id;
    if v_cc_org is distinct from v_org then raise exception 'forbidden: cross-org cost center' using errcode = '42501'; end if;
    if not coalesce(v_cc_active,false) then raise exception 'cost center is inactive' using errcode = '22023'; end if;
    select exists(select 1 from public.cost_centers c where c.parent_id = p_cost_center_id and c.active) into v_cc_child;
    if v_cc_child then raise exception 'cost center must be an active leaf' using errcode = '22023'; end if;
  end if;
  if p_farm_id is not null then
    select org_id into v_farm_org from public.farms where id = p_farm_id;
    if v_farm_org is distinct from v_org then raise exception 'forbidden: cross-org farm' using errcode = '42501'; end if;
  end if;
  if p_sector_id is not null then
    select org_id, farm_id into v_sector_org, v_sector_farm from public.sectors where id = p_sector_id;
    if v_sector_org is distinct from v_org then raise exception 'forbidden: cross-org sector' using errcode = '42501'; end if;
    if p_farm_id is not null and v_sector_farm is distinct from p_farm_id then
      raise exception 'sector does not belong to the selected farm' using errcode = '22023';
    end if;
  end if;
  if p_hawsha_id is not null then
    select org_id, sector_id into v_hawsha_org, v_hawsha_sector from public.hawshat where id = p_hawsha_id;
    if v_hawsha_org is distinct from v_org then raise exception 'forbidden: cross-org hawsha' using errcode = '42501'; end if;
    if p_sector_id is not null and v_hawsha_sector is distinct from p_sector_id then
      raise exception 'hawsha does not belong to the selected sector' using errcode = '22023';
    end if;
  end if;

  if p_id is null then
    insert into public.sales(org_id, sale_date, crop, season, buyer_id, cost_center_id, farm_id, sector_id, hawsha_id,
      qty, unit, delivery_date, notes, price_status)
    values (v_org, p_sale_date, trim(p_crop), nullif(trim(coalesce(p_season,'')),''), p_buyer_id, p_cost_center_id,
      p_farm_id, p_sector_id, p_hawsha_id, p_qty, nullif(trim(coalesce(p_unit,'')),''), p_delivery_date,
      nullif(trim(coalesce(p_notes,'')),''), 'pending')
    returning id into v_id;
  else
    update public.sales set sale_date = p_sale_date, crop = trim(p_crop), season = nullif(trim(coalesce(p_season,'')),''),
      buyer_id = p_buyer_id, cost_center_id = p_cost_center_id, farm_id = p_farm_id, sector_id = p_sector_id,
      hawsha_id = p_hawsha_id, qty = p_qty, unit = nullif(trim(coalesce(p_unit,'')),''), delivery_date = p_delivery_date,
      notes = nullif(trim(coalesce(p_notes,'')),'') where id = p_id
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id, 'price_status', 'pending');
end $$;
revoke execute on function public.fn_save_sale(uuid, uuid, date, text, uuid, uuid, uuid, uuid, uuid, text, numeric, text, date, text) from public, anon, authenticated;
grant  execute on function public.fn_save_sale(uuid, uuid, date, text, uuid, uuid, uuid, uuid, uuid, text, numeric, text, date, text) to authenticated;

-- ── 7) fn_finalize_sale_price — set price + post revenue (Dr ذمم مدينة / Cr إيرادات المبيعات) ─────────
create or replace function public.fn_finalize_sale_price(p_sale uuid, p_unit_price numeric)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid; v_qty numeric; v_status text; v_total numeric; v_ar uuid; v_rev uuid; v_journal uuid;
begin
  if p_unit_price is null or p_unit_price < 0 then raise exception 'unit_price must be non-negative' using errcode = '22023'; end if;
  select org_id, qty, price_status into v_org, v_qty, v_status from public.sales where id = p_sale for update;
  if v_org is null then raise exception 'sale % not found', p_sale using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org sale' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;
  if v_status = 'finalized' then raise exception 'sale price already finalized' using errcode = '22023'; end if;
  if v_qty is null or v_qty <= 0 then raise exception 'set a positive qty before finalizing the price' using errcode = '22023'; end if;

  v_total := round(v_qty * p_unit_price, 2);
  update public.sales
     set unit_price = p_unit_price, total = v_total, price_status = 'finalized', price_finalized_at = now()
   where id = p_sale;

  -- Post revenue at finalize (a pending sale never touched the ledger — cash-method discipline #7, symmetric to expenses).
  v_ar  := public.fn_ensure_account(v_org, '1200', 'ذمم مدينة (عملاء)', 'asset', 'debit');
  v_rev := public.fn_ensure_account(v_org, '4000', 'إيرادات المبيعات', 'revenue', 'credit');
  v_journal := public.fn_post_two_line_journal(
    v_org, current_date, 'sale', p_sale, 'إثبات إيراد بيع عند تحديد السعر',
    v_ar, v_rev, v_total, 'ذمم مدينة على العميل', 'إيراد مبيعات', null, null, null, null);

  return jsonb_build_object('id', p_sale, 'total', v_total, 'price_status', 'finalized', 'journal_entry_id', v_journal);
end $$;
revoke execute on function public.fn_finalize_sale_price(uuid, numeric) from public, anon, authenticated;
grant  execute on function public.fn_finalize_sale_price(uuid, numeric) to authenticated;

-- ── 8) fn_record_sale_collection — partial receipt; clears A-R; derives payment_status ────────────────
create or replace function public.fn_record_sale_collection(
  p_sale uuid, p_amount numeric, p_occurred_at date default current_date,
  p_collected_by text default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid; v_status text; v_total numeric; v_collected numeric; v_new_total numeric;
  v_cash uuid; v_ar uuid; v_id uuid; v_journal uuid; v_pay text;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'collection amount must be positive' using errcode = '22023'; end if;
  select org_id, price_status, total into v_org, v_status, v_total from public.sales where id = p_sale for update;
  if v_org is null then raise exception 'sale % not found', p_sale using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org sale' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;
  if v_status <> 'finalized' then raise exception 'cannot collect on a pending-price sale; finalize the price first' using errcode = '22023'; end if;

  select coalesce(sum(amount),0) into v_collected from public.sale_collections where sale_id = p_sale;
  v_new_total := v_collected + p_amount;
  if v_new_total > coalesce(v_total,0) then
    raise exception 'collection exceeds the outstanding receivable (total %, already collected %)', v_total, v_collected using errcode = '22023';
  end if;

  insert into public.sale_collections(org_id, sale_id, amount, occurred_at, collected_by, note)
  values (v_org, p_sale, p_amount, coalesce(p_occurred_at, current_date), nullif(trim(coalesce(p_collected_by,'')),''), nullif(trim(coalesce(p_note,'')),''))
  returning id into v_id;

  -- Clear the receivable: Dr نقدية المبيعات / Cr ذمم مدينة.
  v_cash := public.fn_ensure_account(v_org, '1100', 'نقدية المبيعات', 'asset', 'debit');
  v_ar   := public.fn_ensure_account(v_org, '1200', 'ذمم مدينة (عملاء)', 'asset', 'debit');
  v_journal := public.fn_post_two_line_journal(
    v_org, coalesce(p_occurred_at, current_date), 'sale_collection', v_id, 'تحصيل من عميل',
    v_cash, v_ar, p_amount, 'نقدية محصّلة', 'سداد ذمم مدينة', null, null, null, null);
  update public.sale_collections set journal_entry_id = v_journal where id = v_id;

  -- Refresh payment_status from Σ(collections); the caller never supplies it and no running balance is stored.
  v_pay := case when v_new_total >= coalesce(v_total,0) then 'collected'
                when v_new_total > 0 then 'partially_collected' else 'unpaid' end;
  update public.sales set payment_status = v_pay where id = p_sale;

  return jsonb_build_object('id', v_id, 'collected_total', v_new_total, 'payment_status', v_pay, 'journal_entry_id', v_journal);
end $$;
revoke execute on function public.fn_record_sale_collection(uuid, numeric, date, text, text) from public, anon, authenticated;
grant  execute on function public.fn_record_sale_collection(uuid, numeric, date, text, text) to authenticated;

commit;
