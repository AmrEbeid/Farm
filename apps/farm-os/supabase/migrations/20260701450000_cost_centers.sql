-- SPEC-0024 S-3 — مراكز التكلفة (cost centers): the "which business the money served" dimension.
--
-- A 2-level editable tree (land قطاع → enterprise مركز) parallel to — but independent of — the COA
-- accounts tree (S-1). An expense/journal line carries BOTH account_id (what the money was for) and
-- cost_center_id (which enterprise it served), so per-feddan / per-enterprise economics become possible
-- (issue #595 intercropping, #219 two-tier costing) without overloading the account tree.
--
-- Mirrors the S-1 backend posture: budget.write-gated RPCs, SECURITY DEFINER + search_path='', EXECUTE
-- locked to authenticated, RLS + FORCE RLS + audit, cycle-guarded depth ≤4, soft-delete (never DELETE),
-- and a per-org system «غير موزَّع» center as the honest-null allocation target (#1). NO authorize()
-- change (reuses budget.write). The real 18 Ebeid centers are Owner data → delivered via the import
-- template (S-9), NOT hard-seeded here (multi-tenant + non-negotiable #1).
begin;

-- ── 1) cost_centers table ─────────────────────────────────────────────────────────────────────────
create table if not exists public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  parent_id uuid references public.cost_centers(id),
  code text not null,
  name_ar text not null,
  sector_id uuid references public.sectors(id),          -- optional link to the physical land قطاع
  enterprise text,                                        -- نخيل / موالح / قشطة / بنجر / عام … (free label)
  area_feddan numeric check (area_feddan is null or area_feddan >= 0),
  is_system boolean not null default false,               -- «غير موزَّع» — rename-only, never archived
  sort_order int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (org_id, code)
);
create index if not exists cost_centers_org_code_idx on public.cost_centers(org_id, code);
create index if not exists cost_centers_parent_idx on public.cost_centers(parent_id);
create index if not exists cost_centers_sector_idx on public.cost_centers(sector_id);

alter table public.cost_centers enable row level security;
alter table public.cost_centers force row level security;
drop policy if exists tenant_read on public.cost_centers;
create policy tenant_read on public.cost_centers for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('finance.read', org_id));
grant select on public.cost_centers to authenticated;
revoke insert, update, delete on public.cost_centers from authenticated, anon;
drop trigger if exists audit_cost_center on public.cost_centers;
create trigger audit_cost_center after insert or update or delete on public.cost_centers
  for each row execute function public.fn_audit('cost_center');

-- Re-emit audit_read (latest: migration 20260701220000) adding 'cost_center' — an audited, finance.read-
-- restricted entity must be gated in audit_read too, or its audit rows leak to non-finance roles (the H2
-- wage-leak invariant class, tests/56). cost_center audit rows are gated behind finance.read, like account.
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
          'account','journal_entry','journal_line','payment_request_funding','cost_center'
        )
      )
      or (entity_type = 'people_compensation' and public.authorize('payroll.read', org_id))
      or (entity_type in ('sale','expense') and public.authorize('budget.write', org_id))
      or (
        entity_type in (
          'custody_account','custody_movement','payment_request','payment_request_line',
          'account','journal_entry','journal_line','payment_request_funding','cost_center'
        )
        and public.authorize('finance.read', org_id)
      )
    )
  );

-- ── 2) Dimension columns on expenses + journal_lines ────────────────────────────────────────────────
alter table public.expenses add column if not exists cost_center_id uuid references public.cost_centers(id);
create index if not exists expenses_cost_center_idx on public.expenses(cost_center_id);
grant update (cost_center_id) on public.expenses to authenticated;

alter table public.journal_lines add column if not exists cost_center_id uuid references public.cost_centers(id);
create index if not exists journal_lines_cost_center_idx on public.journal_lines(cost_center_id);

-- Guard: an expense's cost_center_id must be a same-org, active, LEAF center. NULL is allowed (unallocated).
create or replace function public.expense_cost_center_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cc_org uuid;
  v_cc_active boolean;
  v_has_active_child boolean;
begin
  if new.cost_center_id is null then
    return new;
  end if;
  select org_id, active into v_cc_org, v_cc_active from public.cost_centers where id = new.cost_center_id;
  if v_cc_org is null then
    raise exception 'cost center % not found', new.cost_center_id using errcode = 'P0002';
  end if;
  if v_cc_org is distinct from new.org_id then
    raise exception 'forbidden: cross-org cost center' using errcode = '42501';
  end if;
  if not coalesce(v_cc_active, false) then
    raise exception 'cost center is inactive' using errcode = '22023';
  end if;
  select exists (
      select 1 from public.cost_centers child
       where child.parent_id = new.cost_center_id and child.org_id = new.org_id and child.active)
    into v_has_active_child;
  if v_has_active_child then
    raise exception 'cost center must be an active leaf' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function public.expense_cost_center_guard() from public, anon, authenticated;
drop trigger if exists expense_cost_center_guard on public.expenses;
create trigger expense_cost_center_guard
  before insert or update of cost_center_id, org_id on public.expenses
  for each row execute function public.expense_cost_center_guard();

-- ── 3) fn_save_cost_center — create / rename / re-parent (cycle-guarded, depth ≤4) ───────────────────
create or replace function public.fn_save_cost_center(
  p_id uuid,
  p_org uuid,
  p_parent_id uuid,
  p_code text,
  p_name_ar text,
  p_sector_id uuid default null,
  p_enterprise text default null,
  p_area_feddan numeric default null,
  p_sort_order int default null,
  p_active boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing record;
  v_org uuid;
  v_parent record;
  v_depth int;
  v_cycle boolean;
  v_id uuid;
  v_conflict uuid;
  v_candidate_org uuid;
  v_visible_org_count int;
  v_sector_org uuid;
begin
  if p_code is null or trim(p_code) = '' then raise exception 'cost center code required' using errcode = '23502'; end if;
  if p_name_ar is null or trim(p_name_ar) = '' then raise exception 'cost center name required' using errcode = '23502'; end if;
  if p_area_feddan is not null and p_area_feddan < 0 then
    raise exception 'area_feddan must be non-negative' using errcode = '22023';
  end if;

  if p_id is not null then
    select * into v_existing from public.cost_centers where id = p_id for update;
    if v_existing.id is null then raise exception 'cost center % not found', p_id using errcode = 'P0002'; end if;
    v_org := v_existing.org_id;
    if p_org is not null and p_org is distinct from v_org then
      raise exception 'forbidden: cost center org cannot change' using errcode = '42501';
    end if;
  else
    v_org := p_org;
    if v_org is null and p_parent_id is not null then
      select org_id into v_org from public.cost_centers where id = p_parent_id;
    end if;
    if v_org is null then
      v_visible_org_count := 0;
      for v_candidate_org in select org_id from public.user_org_ids() as visible_orgs(org_id) loop
        v_org := v_candidate_org;
        v_visible_org_count := v_visible_org_count + 1;
      end loop;
      if coalesce(v_visible_org_count, 0) <> 1 then v_org := null; end if;
    end if;
  end if;

  if v_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org cost center' using errcode = '42501';
  end if;
  if not public.authorize('budget.write', v_org) then
    raise exception 'forbidden: budget.write is required' using errcode = '42501';
  end if;

  -- Optional physical-land link must belong to the same org.
  if p_sector_id is not null then
    select org_id into v_sector_org from public.sectors where id = p_sector_id;
    if v_sector_org is null then raise exception 'sector % not found', p_sector_id using errcode = 'P0002'; end if;
    if v_sector_org is distinct from v_org then
      raise exception 'forbidden: cross-org sector link' using errcode = '42501';
    end if;
  end if;

  if p_parent_id is not null then
    select * into v_parent from public.cost_centers where id = p_parent_id and org_id = v_org;
    if v_parent.id is null then raise exception 'parent cost center % not found in org', p_parent_id using errcode = 'P0002'; end if;
    if not coalesce(v_parent.active, false) then raise exception 'parent cost center is inactive' using errcode = '22023'; end if;

    with recursive chain as (
      select id, parent_id, 1 as depth from public.cost_centers where id = p_parent_id
      union all
      select c.id, c.parent_id, ch.depth + 1
        from public.cost_centers c join chain ch on c.id = ch.parent_id
       where ch.depth < 16
    )
    select coalesce(max(depth), 0), coalesce(bool_or(id = p_id), false)
      into v_depth, v_cycle from chain;
    if coalesce(v_cycle, false) then raise exception 'cost center tree cycle detected' using errcode = '22023'; end if;
    if coalesce(v_depth, 0) >= 4 then raise exception 'cost center tree depth cannot exceed 4 levels' using errcode = '22023'; end if;
  end if;

  -- System center: rename + area/sort only; never re-parent or archive. Nested so v_existing (a RECORD)
  -- is only dereferenced on the edit path where it was actually SELECTed (plpgsql doesn't short-circuit
  -- field access on an unassigned record).
  if p_id is not null then
    if coalesce(v_existing.is_system, false) then
      if p_parent_id is distinct from v_existing.parent_id then
        raise exception 'system cost center cannot be re-parented' using errcode = '22023';
      end if;
      if coalesce(p_active, true) is false then
        raise exception 'system cost center cannot be archived' using errcode = '22023';
      end if;
      if trim(p_code) is distinct from v_existing.code then
        raise exception 'system cost center code cannot be changed' using errcode = '22023';
      end if;
    end if;
  end if;

  select id into v_conflict from public.cost_centers
   where org_id = v_org and code = trim(p_code) and (p_id is null or id <> p_id);
  if v_conflict is not null then
    raise exception 'cost center code already exists in this org: %', trim(p_code) using errcode = '23505';
  end if;

  if p_id is null then
    insert into public.cost_centers(org_id, parent_id, code, name_ar, sector_id, enterprise, area_feddan, sort_order, active)
    values (v_org, p_parent_id, trim(p_code), trim(p_name_ar), p_sector_id, nullif(trim(coalesce(p_enterprise, '')), ''),
            p_area_feddan, p_sort_order, coalesce(p_active, true))
    returning id into v_id;
  else
    update public.cost_centers
       set parent_id = p_parent_id,
           code = trim(p_code),
           name_ar = trim(p_name_ar),
           sector_id = p_sector_id,
           enterprise = nullif(trim(coalesce(p_enterprise, '')), ''),
           area_feddan = p_area_feddan,
           sort_order = p_sort_order,
           active = coalesce(p_active, true)
     where id = p_id
     returning id into v_id;
  end if;

  return jsonb_build_object('id', v_id);
end;
$$;
revoke execute on function public.fn_save_cost_center(uuid, uuid, uuid, text, text, uuid, text, numeric, int, boolean) from public, anon, authenticated;
grant execute on function public.fn_save_cost_center(uuid, uuid, uuid, text, text, uuid, text, numeric, int, boolean) to authenticated;

-- ── 4) fn_archive_cost_center — soft-delete the subtree (blocks any system node) ─────────────────────
create or replace function public.fn_archive_cost_center(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_has_system boolean;
  v_count int;
begin
  select org_id into v_org from public.cost_centers where id = p_id;
  if v_org is null then raise exception 'cost center % not found', p_id using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org cost center' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;

  with recursive subtree as (
    select id, is_system from public.cost_centers where id = p_id and org_id = v_org
    union all
    select c.id, c.is_system from public.cost_centers c join subtree s on c.parent_id = s.id where c.org_id = v_org
  )
  select coalesce(bool_or(is_system), false), count(*)::int into v_has_system, v_count from subtree;
  if v_has_system then raise exception 'system cost center cannot be archived' using errcode = '22023'; end if;

  with recursive subtree as (
    select id from public.cost_centers where id = p_id and org_id = v_org
    union all
    select c.id from public.cost_centers c join subtree s on c.parent_id = s.id where c.org_id = v_org
  )
  update public.cost_centers set active = false where id in (select id from subtree);

  return jsonb_build_object('id', p_id, 'archived_count', coalesce(v_count, 0));
end;
$$;
revoke execute on function public.fn_archive_cost_center(uuid) from public, anon, authenticated;
grant execute on function public.fn_archive_cost_center(uuid) to authenticated;

-- ── 5) fn_merge_cost_centers — repoint expenses + journal_lines, then archive source ─────────────────
create or replace function public.fn_merge_cost_centers(p_source uuid, p_target uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source record;
  v_target record;
  v_refs_expenses int := 0;
  v_refs_lines int := 0;
begin
  if p_source is null or p_target is null or p_source = p_target then
    raise exception 'source and target cost centers must be different' using errcode = '22023';
  end if;
  select * into v_source from public.cost_centers where id = p_source for update;
  select * into v_target from public.cost_centers where id = p_target for update;
  if v_source.id is null then raise exception 'source cost center % not found', p_source using errcode = 'P0002'; end if;
  if v_target.id is null then raise exception 'target cost center % not found', p_target using errcode = 'P0002'; end if;
  if v_source.org_id is distinct from v_target.org_id then raise exception 'cannot merge cost centers across orgs' using errcode = '42501'; end if;
  if v_source.org_id not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org cost center' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_source.org_id) then raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;
  if coalesce(v_source.is_system, false) then raise exception 'system cost center cannot be merged away' using errcode = '22023'; end if;
  if not coalesce(v_target.active, false) then raise exception 'target cost center is inactive' using errcode = '22023'; end if;
  if exists (select 1 from public.cost_centers where parent_id = p_source and active) then
    raise exception 'source cost center must be a leaf to merge' using errcode = '22023'; end if;
  if exists (select 1 from public.cost_centers where parent_id = p_target and active) then
    raise exception 'target cost center must be a leaf to merge' using errcode = '22023'; end if;

  update public.expenses set cost_center_id = p_target where cost_center_id = p_source;
  get diagnostics v_refs_expenses = row_count;
  update public.journal_lines set cost_center_id = p_target where cost_center_id = p_source;
  get diagnostics v_refs_lines = row_count;
  update public.cost_centers set active = false where id = p_source;

  return jsonb_build_object('source_id', p_source, 'target_id', p_target,
    'expenses_repointed', v_refs_expenses, 'journal_lines_repointed', v_refs_lines);
end;
$$;
revoke execute on function public.fn_merge_cost_centers(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_merge_cost_centers(uuid, uuid) to authenticated;

-- ── 6) Per-org system «غير موزَّع» center (the honest-null allocation target) ────────────────────────
create or replace function public.fn_seed_cost_center_defaults(p_org uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_org is null then return; end if;
  insert into public.cost_centers(org_id, code, name_ar, is_system, sort_order, active)
  values (p_org, 'CC-UNALLOC', 'غير موزَّع', true, 9999, true)
  on conflict (org_id, code) do update
     set name_ar = excluded.name_ar, is_system = true, active = true;
end;
$$;
revoke execute on function public.fn_seed_cost_center_defaults(uuid) from public, anon, authenticated;

create or replace function public.organization_seed_cost_center_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fn_seed_cost_center_defaults(new.id);
  return new;
end;
$$;
revoke execute on function public.organization_seed_cost_center_defaults() from public, anon, authenticated;
drop trigger if exists organization_seed_cost_center_defaults on public.organization;
create trigger organization_seed_cost_center_defaults
  after insert on public.organization
  for each row execute function public.organization_seed_cost_center_defaults();

do $$
declare v_org uuid;
begin
  for v_org in select id from public.organization loop
    perform public.fn_seed_cost_center_defaults(v_org);
  end loop;
end $$;

commit;
