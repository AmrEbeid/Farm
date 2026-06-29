-- Farm OS — STAGE 7 (SPEC-0004): accounting framework — sales (revenue) + the #6 drawings classification.
-- Owner-ratified path 2026-06-27 ("build framework on synthetic, gated"). This adds the data model the
-- P&L needs: an explicit expense `kind` so owner DRAWINGS (مسحوبات) and capex are SEPARABLE from
-- operating expenses (non-negotiable #6 — never a free-text category), and a `sales` table for revenue.
-- The UI reads the P&L through a DB-side aggregate RPC so totals are not capped by PostgREST row limits.
--
-- GATE INTACT: the acceptance oracle is still the dual-run reconciliation of one closed season against
-- the real 7-yr Excel (real financials → Stage M / privacy review) — NOT in this migration. Money logic
-- ⇒ INDEPENDENT REVIEW REQUIRED before this reaches prod (CLAUDE.md). Writes gated on budget.write
-- (owner/accountant, migration 0001); pattern locked per 0044 (expenses) / 0021 / 0035.

-- ── 1) the #6 drawings classification on expenses. Default 'operating' so existing rows are unchanged;
-- drawings + capex are now FIRST-CLASS and excluded from the operating P&L (never a free-text category).
alter table public.expenses
  add column if not exists kind text not null default 'operating'
  check (kind in ('operating','drawing','capex'));

-- ── 2) sales (revenue) — crop × date, optional sector/season allocation. RLS org-scoped; writes gated on
-- budget.write (owner/accountant); audited; soft-delete (0027 posture). ──────────────────────────────
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  date date,
  crop text,
  sector_id uuid references public.sectors(id),
  qty numeric,
  unit text,
  unit_price numeric,
  total numeric not null default 0,
  buyer text,
  season text,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  archived boolean not null default false
);
create index sales_org_idx on public.sales(org_id) where archived = false;

alter table public.sales enable row level security;
alter table public.sales force row level security;

-- reads: budget.write authority only (owner/accountant) — financial revenue rows MUST NOT leak to other
-- org members via PostgREST (SPEC-0004 §3; isolation enforced in Postgres, not just the app layer). writes:
-- budget.write — same authority as expenses (0044). The NULL-tolerant parent-org predicate mirrors 0012.
create policy tenant_read on public.sales for select to authenticated
  using (
    org_id in (select public.user_org_ids())
    and public.authorize('budget.write', org_id)
  );

create policy tenant_write on public.sales for insert to authenticated
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('budget.write', org_id)
    and (sector_id is null or exists (select 1 from public.sectors s where s.id = sales.sector_id and s.org_id = sales.org_id))
  );

create policy tenant_update on public.sales for update to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('budget.write', org_id)
    and (sector_id is null or exists (select 1 from public.sectors s where s.id = sales.sector_id and s.org_id = sales.org_id))
  );

-- TABLE privileges for PostgREST (created after the 0009 blanket grant → grant explicitly; required by
-- the audit-leak invariant — an audited table must be fully readable by authenticated).
grant select, insert, update on public.sales to authenticated;
revoke delete on public.sales from authenticated, anon;

create trigger audit_sale after insert or update or delete on public.sales
  for each row execute function public.fn_audit('sale');

-- ── 3a) fn_save_sale — upsert a revenue record (budget.write) ────────────────────────────────────────
create or replace function public.fn_save_sale(
  p_id uuid,
  p_org uuid,
  p_date date default null,
  p_crop text default null,
  p_sector_id uuid default null,
  p_qty numeric default null,
  p_unit text default null,
  p_unit_price numeric default null,
  p_total numeric default 0,
  p_buyer text default null,
  p_season text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_id uuid;
begin
  if p_id is not null then
    select org_id into v_org from public.sales where id = p_id;
    if v_org is null then raise exception 'sale % not found', p_id using errcode = 'P0002'; end if;
  else
    if p_org is null then raise exception 'org required to create a sale' using errcode = '23502'; end if;
    v_org := p_org;
  end if;

  if not public.authorize('budget.write', v_org) then
    raise exception 'forbidden: budget.write is required (owner/accountant)' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org sale' using errcode = '42501'; end if;

  if coalesce(p_total, 0) < 0 or coalesce(p_qty, 0) < 0 or coalesce(p_unit_price, 0) < 0 then
    raise exception 'sale amounts must be non-negative' using errcode = '22023'; end if;
  -- the sector (if given) must belong to the sale's org (cross-org integrity).
  if p_sector_id is not null and not exists (
       select 1 from public.sectors s where s.id = p_sector_id and s.org_id = v_org) then
    raise exception 'sector % is not in this org', p_sector_id using errcode = '42501'; end if;

  if p_id is not null then
    update public.sales set date = p_date, crop = p_crop, sector_id = p_sector_id, qty = p_qty,
      unit = p_unit, unit_price = p_unit_price, total = coalesce(p_total, 0), buyer = p_buyer,
      season = p_season where id = p_id;
    v_id := p_id;
  else
    insert into public.sales(org_id, date, crop, sector_id, qty, unit, unit_price, total, buyer, season, recorded_by)
    values (v_org, p_date, p_crop, p_sector_id, p_qty, p_unit, p_unit_price, coalesce(p_total, 0), p_buyer, p_season, (select auth.uid()))
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- ── 3b) fn_set_expense_kind — classify an expense as operating/drawing/capex (#6; budget.write) ───────
create or replace function public.fn_set_expense_kind(
  p_id uuid,
  p_kind text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.expenses where id = p_id;
  if v_org is null then raise exception 'expense % not found', p_id using errcode = 'P0002'; end if;

  if not public.authorize('budget.write', v_org) then
    raise exception 'forbidden: budget.write is required (owner/accountant)' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org expense change' using errcode = '42501'; end if;

  if coalesce(p_kind, '') not in ('operating','drawing','capex') then
    raise exception 'invalid expense kind: %', p_kind using errcode = '22023'; end if;

  update public.expenses set kind = p_kind where id = p_id;
  return jsonb_build_object('id', p_id, 'kind', p_kind);
end $$;

-- ── 3c) fn_accounting_pnl_summary — DB-side aggregate for uncapped P&L totals (budget.write) ─────────
create or replace function public.fn_accounting_pnl_summary(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_revenue numeric := 0;
  v_operating numeric := 0;
  v_drawings numeric := 0;
  v_capex numeric := 0;
  v_by_category jsonb := '[]'::jsonb;
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;

  if not public.authorize('budget.write', p_org) then
    raise exception 'forbidden: budget.write is required (owner/accountant)' using errcode = '42501';
  end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and p_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org accounting summary' using errcode = '42501';
  end if;

  select coalesce(sum(s.total) filter (where s.total >= 0), 0)
    into v_revenue
    from public.sales s
   where s.org_id = p_org
     and s.archived = false;

  select
    coalesce(sum(e.total) filter (where e.kind = 'operating' and e.total >= 0), 0),
    coalesce(sum(e.total) filter (where e.kind = 'drawing' and e.total >= 0), 0),
    coalesce(sum(e.total) filter (where e.kind = 'capex' and e.total >= 0), 0)
    into v_operating, v_drawings, v_capex
    from public.expenses e
   where e.org_id = p_org;

  select coalesce(
    jsonb_agg(jsonb_build_object('category', c.category, 'operating', c.operating) order by c.category),
    '[]'::jsonb
  )
    into v_by_category
    from (
      select
        coalesce(nullif(e.category, ''), 'غير مصنّف') as category,
        round(sum(e.total)::numeric, 2) as operating
        from public.expenses e
       where e.org_id = p_org
         and e.kind = 'operating'
         and e.total >= 0
       group by 1
    ) c;

  return jsonb_build_object(
    'revenue', round(v_revenue, 2),
    'operatingExpenses', round(v_operating, 2),
    'drawings', round(v_drawings, 2),
    'capex', round(v_capex, 2),
    'netOperating', round(v_revenue - v_operating, 2),
    'byCategory', v_by_category
  );
end $$;

revoke all     on function public.fn_save_sale(uuid, uuid, date, text, uuid, numeric, text, numeric, numeric, text, text) from public;
revoke execute on function public.fn_save_sale(uuid, uuid, date, text, uuid, numeric, text, numeric, numeric, text, text) from anon;
grant  execute on function public.fn_save_sale(uuid, uuid, date, text, uuid, numeric, text, numeric, numeric, text, text) to authenticated;
revoke all     on function public.fn_set_expense_kind(uuid, text) from public;
revoke execute on function public.fn_set_expense_kind(uuid, text) from anon;
grant  execute on function public.fn_set_expense_kind(uuid, text) to authenticated;
revoke all     on function public.fn_accounting_pnl_summary(uuid) from public;
revoke execute on function public.fn_accounting_pnl_summary(uuid) from anon;
grant  execute on function public.fn_accounting_pnl_summary(uuid) to authenticated;

-- ── 4) gate `sale` audit rows on budget.write (mirror the base-table read rule onto the audit log) ───
-- sales' base read is now budget.write-only (owner/accountant), but fn_audit('sale') mirrors the FULL
-- before/after row into audit_log, whose audit_read is org-scoped — so without this, any org member could
-- read revenue out of audit_log, re-opening the exact leak the SELECT gate closes (the #270 H2 wage class,
-- pinned by test 56). Re-emit audit_read adding a `sale` arm alongside the existing people_compensation
-- one; every other entity_type is unchanged (org-scoped). `is distinct from` is NULL-safe.
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated
  using (
    org_id in (select public.user_org_ids())
    and (
      entity_type is distinct from 'people_compensation'
      or public.authorize('payroll.read', org_id)
    )
    and (
      entity_type is distinct from 'sale'
      or public.authorize('budget.write', org_id)
    )
  );
