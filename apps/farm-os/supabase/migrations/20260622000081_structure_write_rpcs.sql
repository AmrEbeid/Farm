-- Farm OS — STRUCT-1: editable farm structure, part 2 — RBAC + CRUD RPCs.
-- See docs/RESEARCH-farm-structure-crud-2026-06-26.md (D3, D4).
--
-- Adds a `structure.write` permission (owner/farm_manager) and the SECURITY DEFINER RPCs the app uses
-- to create/edit/remove sectors, hawshat, lines and palms. Every RPC follows the established pattern
-- (fn_update_palm_status 0039 / fn_add_plan_operation 0038): resolve the row's org, enforce the role
-- gate IN THE DATABASE via authorize('structure.write', v_org) — so the gate can't be bypassed by a
-- direct PostgREST call — guard against cross-org/anon, validate, mutate, return jsonb. Locked down
-- per 0021/0035: pinned empty search_path, schema-qualified, revoked from public+anon, granted to
-- authenticated only. authorize() reads the caller's JWT GUC, which SECURITY DEFINER does NOT change,
-- so the *caller's* permission in v_org is evaluated even though the body runs as the definer.

-- ── 1) add `structure.write` to the org-scoped authorize overload. The 1-arg authorize(text) was
-- DELIBERATELY DROPPED by migration 0035 (AUTHZ-2 #181) — an org-less check lets a multi-org user pass a
-- permission earned in ANY org — so it is NOT re-created here; only the 2-arg (perm, org) form is extended.
create or replace function public.authorize(perm text, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_member m
    where m.user_id = (select auth.uid())
      and m.org_id = p_org
      and ( (perm = 'pr.approve'      and m.role = 'owner')
         or (perm = 'plan.write'      and m.role in ('owner','farm_manager'))
         or (perm = 'op.execute'      and m.role in ('owner','farm_manager','agri_engineer','supervisor'))
         or (perm = 'inventory.write' and m.role in ('owner','farm_manager','storekeeper'))
         or (perm = 'budget.write'    and m.role in ('owner','accountant'))
         or (perm = 'payroll.read'    and m.role in ('owner','accountant'))
         or (perm = 'structure.write' and m.role in ('owner','farm_manager')) )
  )
$$;

-- ── 2) gate the structure tables' direct-REST writes on structure.write (defense-in-depth) ──────────
-- These three kept the original org-scoped-only tenant_all from 0003 (only assets/expenses/event_*
-- were hardened later). The app writes them ONLY through the definer RPCs below (which bypass RLS),
-- so this closes the direct-PostgREST hole — a non-structure role (storekeeper/accountant) could
-- otherwise PATCH a sector/hawsha/line. Also add the NULL-tolerant same-org parent predicate that
-- 0012 added to assets/expenses but these tables missed (cross-org reference integrity).
drop policy if exists tenant_all on public.sectors;
create policy tenant_all on public.sectors for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('structure.write', org_id)
    and (farm_id is null or exists (select 1 from public.farms f where f.id = sectors.farm_id and f.org_id = sectors.org_id))
  );

drop policy if exists tenant_all on public.hawshat;
create policy tenant_all on public.hawshat for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('structure.write', org_id)
    and (sector_id is null or exists (select 1 from public.sectors s where s.id = hawshat.sector_id and s.org_id = hawshat.org_id))
  );

drop policy if exists tenant_all on public.lines;
create policy tenant_all on public.lines for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('structure.write', org_id)
    and (hawsha_id is null or exists (select 1 from public.hawshat h where h.id = lines.hawsha_id and h.org_id = lines.org_id))
  );

-- ── helper macro inlined per-RPC: the gate + cross-org guard (kept explicit for auditability) ───────

-- ── 3a) fn_save_sector — create (p_id null) or edit (p_id set) ───────────────────────────────────
create or replace function public.fn_save_sector(
  p_id uuid,
  p_farm_id uuid,
  p_name text,
  p_code text,
  p_crop text default null,
  p_area_feddan numeric default null,
  p_planting_date date default null,
  p_notes text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_farm uuid; v_id uuid;
begin
  if p_id is not null then
    select s.org_id, s.farm_id into v_org, v_farm from public.sectors s where s.id = p_id;
    if v_org is null then raise exception 'sector % not found', p_id using errcode = 'P0002'; end if;
  else
    if p_farm_id is null then raise exception 'farm_id required to create a sector' using errcode = '23502'; end if;
    select f.org_id into v_org from public.farms f where f.id = p_farm_id;
    if v_org is null then raise exception 'farm % not found', p_farm_id using errcode = 'P0002'; end if;
    v_farm := p_farm_id;
  end if;

  if not public.authorize('structure.write', v_org) then
    raise exception 'forbidden: structure.write is required' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org structure change' using errcode = '42501'; end if;

  if p_name is null or btrim(p_name) = '' then raise exception 'name required' using errcode = '23502'; end if;
  if p_code is null or btrim(p_code) = '' then raise exception 'code required' using errcode = '23502'; end if;

  if p_id is not null then
    update public.sectors set name = btrim(p_name), code = btrim(p_code), crop = p_crop,
      area_feddan = p_area_feddan, planting_date = p_planting_date, notes = p_notes where id = p_id;
    v_id := p_id;
  else
    insert into public.sectors(org_id, farm_id, name, code, crop, area_feddan, planting_date, notes)
    values (v_org, v_farm, btrim(p_name), btrim(p_code), p_crop, p_area_feddan, p_planting_date, p_notes)
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- ── 3b) fn_save_hawsha ────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_save_hawsha(
  p_id uuid,
  p_sector_id uuid,
  p_name text,
  p_code text,
  p_area_qirat numeric default null,
  p_row_count int default null,
  p_palm_count_barhi int default null,
  p_palm_count_male int default null,
  p_planting_date date default null,
  p_notes text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_sector uuid; v_id uuid;
begin
  if p_id is not null then
    select h.org_id, h.sector_id into v_org, v_sector from public.hawshat h where h.id = p_id;
    if v_org is null then raise exception 'hawsha % not found', p_id using errcode = 'P0002'; end if;
  else
    if p_sector_id is null then raise exception 'sector_id required to create a hawsha' using errcode = '23502'; end if;
    select s.org_id into v_org from public.sectors s where s.id = p_sector_id;
    if v_org is null then raise exception 'sector % not found', p_sector_id using errcode = 'P0002'; end if;
    v_sector := p_sector_id;
  end if;

  if not public.authorize('structure.write', v_org) then
    raise exception 'forbidden: structure.write is required' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org structure change' using errcode = '42501'; end if;

  if p_name is null or btrim(p_name) = '' then raise exception 'name required' using errcode = '23502'; end if;
  if p_code is null or btrim(p_code) = '' then raise exception 'code required' using errcode = '23502'; end if;
  if coalesce(p_palm_count_barhi, 0) < 0 or coalesce(p_palm_count_male, 0) < 0 or coalesce(p_row_count, 0) < 0 then
    raise exception 'counts must be non-negative' using errcode = '22023'; end if;

  if p_id is not null then
    -- coalesce the canonical registry counts: an omitted/cleared param must NOT erase the headline
    -- 4,380/299 (non-negotiable #5/#1). Pass an explicit 0 to zero a count, never an omission.
    update public.hawshat set name = btrim(p_name), code = btrim(p_code), area_qirat = p_area_qirat,
      row_count = p_row_count,
      palm_count_barhi = coalesce(p_palm_count_barhi, palm_count_barhi),
      palm_count_male  = coalesce(p_palm_count_male,  palm_count_male),
      planting_date = p_planting_date, notes = p_notes where id = p_id;
    v_id := p_id;
  else
    insert into public.hawshat(org_id, sector_id, name, code, area_qirat, row_count,
      palm_count_barhi, palm_count_male, planting_date, notes)
    values (v_org, v_sector, btrim(p_name), btrim(p_code), p_area_qirat, p_row_count,
      p_palm_count_barhi, p_palm_count_male, p_planting_date, p_notes)
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- ── 3c) fn_save_line ──────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_save_line(
  p_id uuid,
  p_hawsha_id uuid,
  p_line_no int,
  p_line_code text default null,
  p_palm_count int default null,
  p_direction text default null,
  p_notes text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_hawsha uuid; v_id uuid;
begin
  if p_id is not null then
    select l.org_id, l.hawsha_id into v_org, v_hawsha from public.lines l where l.id = p_id;
    if v_org is null then raise exception 'line % not found', p_id using errcode = 'P0002'; end if;
  else
    if p_hawsha_id is null then raise exception 'hawsha_id required to create a line' using errcode = '23502'; end if;
    select h.org_id into v_org from public.hawshat h where h.id = p_hawsha_id;
    if v_org is null then raise exception 'hawsha % not found', p_hawsha_id using errcode = 'P0002'; end if;
    v_hawsha := p_hawsha_id;
  end if;

  if not public.authorize('structure.write', v_org) then
    raise exception 'forbidden: structure.write is required' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org structure change' using errcode = '42501'; end if;

  if p_line_no is null then raise exception 'line_no required' using errcode = '23502'; end if;
  if coalesce(p_palm_count, 0) < 0 then raise exception 'palm_count must be non-negative' using errcode = '22023'; end if;

  if p_id is not null then
    update public.lines set line_no = p_line_no, line_code = p_line_code, palm_count = p_palm_count,
      direction = p_direction, notes = p_notes where id = p_id;
    v_id := p_id;
  else
    insert into public.lines(org_id, hawsha_id, line_no, line_code, palm_count, direction, notes)
    values (v_org, v_hawsha, p_line_no, p_line_code, p_palm_count, p_direction, p_notes)
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- ── 3d) fn_save_palm — create/edit a single palm's IDENTITY (status stays fn_update_palm_status) ───
create or replace function public.fn_save_palm(
  p_id uuid,
  p_hawsha_id uuid,
  p_line_id uuid default null,
  p_name text default null,
  p_variety text default null,
  p_sex text default null,
  p_id_tag text default null,
  p_planting_date date default null,
  p_health_status text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_hawsha uuid; v_sector uuid; v_id uuid; v_palm_org uuid;
begin
  if p_id is not null then
    -- capture the palm's OWN org; the guard below authorizes against IT, not the (possibly other-org) target hawsha.
    select a.org_id, a.hawsha_id into v_palm_org, v_hawsha from public.assets a where a.id = p_id and a.type = 'palm';
    if v_palm_org is null then raise exception 'palm % not found', p_id using errcode = 'P0002'; end if;
    if p_hawsha_id is not null then v_hawsha := p_hawsha_id; end if;
  else
    if p_hawsha_id is null then raise exception 'hawsha_id required to create a palm' using errcode = '23502'; end if;
    v_hawsha := p_hawsha_id;
  end if;
  -- the hawsha is the anchor; derive the org + sector from it (keeps the location rollup consistent).
  select h.org_id, h.sector_id into v_org, v_sector from public.hawshat h where h.id = v_hawsha;
  if v_org is null then raise exception 'hawsha % not found', v_hawsha using errcode = 'P0002'; end if;

  -- EDIT must not re-parent a palm across orgs: the target hawsha must belong to the palm's OWN org.
  -- Without this, authorize() below runs against the TARGET org, letting a B-member hijack an A-palm.
  if p_id is not null and v_org is distinct from v_palm_org then
    raise exception 'forbidden: cannot move palm % across organizations', p_id using errcode = '42501'; end if;

  if not public.authorize('structure.write', v_org) then
    raise exception 'forbidden: structure.write is required' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org structure change' using errcode = '42501'; end if;

  if p_sex is not null and p_sex not in ('male', 'female') then
    raise exception 'invalid sex: %', p_sex using errcode = '22023'; end if;
  -- if a line is given it must belong to the same hawsha (same-org + correct parent).
  if p_line_id is not null and not exists (
    select 1 from public.lines l where l.id = p_line_id and l.hawsha_id = v_hawsha and l.org_id = v_org) then
    raise exception 'line % is not in hawsha %', p_line_id, v_hawsha using errcode = '22023'; end if;

  if p_id is not null then
    update public.assets set hawsha_id = v_hawsha, sector_id = v_sector, line_id = p_line_id,
      name = p_name, variety = p_variety, sex = p_sex, id_tag = p_id_tag,
      planting_date = p_planting_date, health_status = p_health_status
      where id = p_id and org_id = v_org;
    v_id := p_id;
  else
    insert into public.assets(org_id, type, status, hawsha_id, sector_id, line_id, name, variety, sex,
      id_tag, planting_date, health_status)
    values (v_org, 'palm', 'active', v_hawsha, v_sector, p_line_id, p_name, p_variety, p_sex,
      p_id_tag, p_planting_date, p_health_status)
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- ── 3e) fn_archive_structure — soft-delete / restore, CASCADING to descendants ─────────────────────
create or replace function public.fn_archive_structure(
  p_type text,
  p_id uuid,
  p_archived boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_at timestamptz; v_now timestamptz;
begin
  if p_type not in ('sector', 'hawsha', 'line', 'palm') then
    raise exception 'invalid structure type: %', p_type using errcode = '22023'; end if;

  if    p_type = 'sector' then select org_id, archived_at into v_org, v_at from public.sectors where id = p_id;
  elsif p_type = 'hawsha' then select org_id, archived_at into v_org, v_at from public.hawshat where id = p_id;
  elsif p_type = 'line'   then select org_id, archived_at into v_org, v_at from public.lines   where id = p_id;
  else                         select org_id, archived_at into v_org, v_at from public.assets  where id = p_id; end if;
  if v_org is null then raise exception '% % not found', p_type, p_id using errcode = 'P0002'; end if;

  if not public.authorize('structure.write', v_org) then
    raise exception 'forbidden: structure.write is required' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org structure change' using errcode = '42501'; end if;

  -- Soft-delete cascades DOWN so a removed sector hides its hawshat/lines/palms. Every row is preserved
  -- (events + palm_status_history intact). RESTORE is provenance-aware: it un-archives only the rows
  -- stamped in the SAME cascade (matching archived_at), so it never resurrects a descendant that was
  -- removed independently BEFORE the parent was — the documented soft-delete-cascade restore hazard.
  if p_archived then
    -- One stamp per cascade (clock_timestamp → two archives in the same txn differ); only touch rows
    -- not already archived, so an earlier independent removal keeps its own stamp.
    v_now := clock_timestamp();
    if p_type = 'sector' then
      update public.sectors set archived = true, archived_at = v_now where id = p_id and not archived;
      update public.hawshat set archived = true, archived_at = v_now where sector_id = p_id and not archived;
      update public.lines   set archived = true, archived_at = v_now
        where hawsha_id in (select id from public.hawshat where sector_id = p_id) and not archived;
      -- archive palms by sector_id OR via a hawsha under the sector (a palm with null sector_id but a
      -- hawsha in this sector — e.g. a future bulk import — must still cascade-archive with its parent).
      update public.assets  set archived = true, archived_at = v_now
        where (sector_id = p_id or hawsha_id in (select id from public.hawshat where sector_id = p_id))
          and not archived;
    elsif p_type = 'hawsha' then
      update public.hawshat set archived = true, archived_at = v_now where id = p_id and not archived;
      update public.lines   set archived = true, archived_at = v_now where hawsha_id = p_id and not archived;
      update public.assets  set archived = true, archived_at = v_now where hawsha_id = p_id and not archived;
    elsif p_type = 'line' then
      update public.lines  set archived = true, archived_at = v_now where id = p_id and not archived;
      update public.assets set archived = true, archived_at = v_now where line_id = p_id and not archived;
    else
      update public.assets set archived = true, archived_at = v_now where id = p_id and not archived;
    end if;
  else
    -- Guard (M1): don't un-archive a node whose immediate parent is still archived — that would orphan
    -- it as VISIBLE under a removed parent (the per-level reads filter archived=false). Restore the
    -- parent first. (A sector's parent is the farm, which this RPC never archives, so no sector guard.)
    if p_type = 'hawsha' and exists (
      select 1 from public.hawshat h join public.sectors s on s.id = h.sector_id
      where h.id = p_id and s.archived) then
      raise exception 'restore the parent sector first' using errcode = 'PT001';
    elsif p_type = 'line' and exists (
      select 1 from public.lines l join public.hawshat h on h.id = l.hawsha_id
      where l.id = p_id and h.archived) then
      raise exception 'restore the parent hawsha first' using errcode = 'PT001';
    elsif p_type = 'palm' and exists (
      select 1 from public.assets a join public.hawshat h on h.id = a.hawsha_id
      where a.id = p_id and h.archived) then
      raise exception 'restore the parent hawsha first' using errcode = 'PT001';
    end if;

    -- Restore the node, then ONLY descendants archived in the same cascade as it (archived_at = v_at).
    if p_type = 'sector' then
      update public.sectors set archived = false, archived_at = null where id = p_id;
      if v_at is not null then
        update public.hawshat set archived = false, archived_at = null where sector_id = p_id and archived_at = v_at;
        update public.lines   set archived = false, archived_at = null
          where hawsha_id in (select id from public.hawshat where sector_id = p_id) and archived_at = v_at;
        update public.assets  set archived = false, archived_at = null where sector_id = p_id and archived_at = v_at;
      end if;
    elsif p_type = 'hawsha' then
      update public.hawshat set archived = false, archived_at = null where id = p_id;
      if v_at is not null then
        update public.lines  set archived = false, archived_at = null where hawsha_id = p_id and archived_at = v_at;
        update public.assets set archived = false, archived_at = null where hawsha_id = p_id and archived_at = v_at;
      end if;
    elsif p_type = 'line' then
      update public.lines  set archived = false, archived_at = null where id = p_id;
      if v_at is not null then
        update public.assets set archived = false, archived_at = null where line_id = p_id and archived_at = v_at;
      end if;
    else
      update public.assets set archived = false, archived_at = null where id = p_id;
    end if;
  end if;

  return jsonb_build_object('type', p_type, 'id', p_id, 'archived', p_archived);
end $$;

-- ── 4) grants — revoke from public+anon, grant to authenticated only (0021/0035 posture) ────────────
do $$
declare sig text;
begin
  foreach sig in array array[
    'public.fn_save_sector(uuid, uuid, text, text, text, numeric, date, text)',
    'public.fn_save_hawsha(uuid, uuid, text, text, numeric, int, int, int, date, text)',
    'public.fn_save_line(uuid, uuid, int, text, int, text, text)',
    'public.fn_save_palm(uuid, uuid, uuid, text, text, text, text, date, text)',
    'public.fn_archive_structure(text, uuid, boolean)'
  ] loop
    execute format('revoke all on function %s from public', sig);
    execute format('revoke execute on function %s from anon', sig);
    execute format('grant execute on function %s to authenticated', sig);
  end loop;
end $$;
