-- Farm OS — RPW-1: Red Palm Weevil (سوسة النخيل الحمراء) pest-scouting slice.
--
-- SCOPE (first slice, deliberately simple — a logging/monitoring tool, NOT an automated alert system):
--   1) pest_traps        — the pheromone-trap register (location, install date, lure-change date, status).
--   2) pest_trap_catches — the weekly catch log per trap (checked_at, catch_count).
--   3) pest_incidents    — a free-text infestation-flag / response-action log, anchored to a trap and/or
--                          a palm asset (visual confirmation doesn't always happen at a trap).
-- "Needs lure change" (>90 days since lure_changed_at) and "overdue check" (no catch log in ~10 days) are
-- deliberately NOT a view here — no view exists anywhere yet in this codebase, and a SQL view over
-- RLS-scoped tables needs `security_invoker` (PG15+) to not silently bypass RLS as the view owner; with no
-- existing precedent to mirror, a plain app-layer query (lib/pest-scouting.ts) is the safer, testable,
-- YAGNI-honest choice per the task brief ("prefer a plain query over a materialized view").
--
-- ROLE-GATING DECISION: writes are gated to `op.execute` (owner/farm_manager/agri_engineer/supervisor),
-- NOT `structure.write` (owner/farm_manager only). Placing/checking a trap and logging a catch are FIELD
-- activities performed by the same roles who record any other field observation (fn_record_event,
-- fn_update_palm_status) — a supervisor walking the rows is exactly who should be able to log a catch
-- count or flag a suspected infestation without waiting on a farm_manager. `structure.write` stays
-- reserved for edits to the farm/sector/hawsha/line HIERARCHY itself, which a trap is not — it is placed
-- AT a structure node the same way `assets` (palms) reference one, not owned by it (mirrors assets'
-- nullable sector_id/hawsha_id/line_id with no ON DELETE clause, i.e. a reference, not ownership).
--
-- SECURITY: FORCE RLS + deny-by-default on all three tables; org-scoped reads for any org member; writes
-- additionally require authorize('op.execute', org_id) IN the WITH CHECK (defense-in-depth, mirrors
-- attachments/0082 and quantities/event_locations/0064 — NOT the older org-scoped-only pattern that let
-- PALM-STATUS-1/#238 slip through) PLUS every nullable location/trap/asset FK is validated same-org
-- directly in the WITH CHECK (mirrors 0064/0075's cross-org-FK closure) so a member cannot tag their own
-- org_id onto a row that references another org's structure node. Writes ALSO go through SECURITY DEFINER
-- RPCs (fn_save_trap / fn_update_trap / fn_log_trap_catch / fn_report_pest_incident) that re-derive the
-- org from the referenced row and re-check authorize() + cross-org membership (mirrors fn_update_palm_status
-- /0039, fn_record_event/0083) — the RLS policy is not relied on alone. Catches and incidents are
-- append-only logs (UPDATE/DELETE revoked); a trap can be corrected (status/lure_changed_at/notes) via
-- fn_update_trap, and "removed" replaces hard delete (same soft-removal posture as attachments/0082).
--
-- Audited via fn_audit (0008). No new `authorize()` permission needed — op.execute already exists.

-- ── 1) pest_traps — the trap register ───────────────────────────────────────────────────────────────────
create table public.pest_traps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  code text not null,
  label text not null,
  sector_id uuid references public.sectors(id),
  hawsha_id uuid references public.hawshat(id),
  line_id uuid references public.lines(id),
  installed_at date not null,
  lure_changed_at date,
  status text not null default 'active' check (status in ('active','removed')),
  notes text,
  created_at timestamptz not null default now()
);
create index pest_traps_org_idx on public.pest_traps(org_id);
-- one code per org (the human-facing trap label, e.g. "مصيدة ٣ - قطاع أ") — avoids silent duplicates.
create unique index pest_traps_org_code_uidx on public.pest_traps(org_id, code);
-- #229(b) covering-index convention (0096): every FK gets a leading-column index.
create index pest_traps_sector_idx on public.pest_traps(sector_id) where sector_id is not null;
create index pest_traps_hawsha_idx on public.pest_traps(hawsha_id) where hawsha_id is not null;
create index pest_traps_line_idx on public.pest_traps(line_id) where line_id is not null;

alter table public.pest_traps enable row level security;
alter table public.pest_traps force row level security;

create policy tenant_all on public.pest_traps for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('op.execute', org_id)
    and (sector_id is null or exists (
      select 1 from public.sectors s where s.id = pest_traps.sector_id and s.org_id = pest_traps.org_id))
    and (hawsha_id is null or exists (
      select 1 from public.hawshat h where h.id = pest_traps.hawsha_id and h.org_id = pest_traps.org_id))
    and (line_id is null or exists (
      select 1 from public.lines l where l.id = pest_traps.line_id and l.org_id = pest_traps.org_id))
  );

-- created after the 0009 blanket grant → needs an explicit grant (mirrors attachments/0082).
grant select, insert, update on public.pest_traps to authenticated;
revoke delete on public.pest_traps from authenticated, anon;

create trigger audit_pest_trap after insert or update or delete on public.pest_traps
  for each row execute function public.fn_audit('pest_trap');

-- ── 2) pest_trap_catches — the weekly catch log (append-only) ──────────────────────────────────────────
create table public.pest_trap_catches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  trap_id uuid not null references public.pest_traps(id) on delete cascade,
  checked_at date not null,
  catch_count int not null check (catch_count >= 0),
  notes text,
  created_at timestamptz not null default now()
);
create index pest_trap_catches_org_idx on public.pest_trap_catches(org_id);
create index pest_trap_catches_trap_idx on public.pest_trap_catches(trap_id, checked_at desc);

alter table public.pest_trap_catches enable row level security;
alter table public.pest_trap_catches force row level security;

create policy tenant_all on public.pest_trap_catches for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('op.execute', org_id)
    and exists (
      select 1 from public.pest_traps t where t.id = pest_trap_catches.trap_id and t.org_id = pest_trap_catches.org_id)
  );

grant select, insert on public.pest_trap_catches to authenticated;
revoke update, delete on public.pest_trap_catches from authenticated, anon;

create trigger audit_pest_trap_catch after insert or update or delete on public.pest_trap_catches
  for each row execute function public.fn_audit('pest_trap_catch');

-- ── 3) pest_incidents — infestation flag / response-action log (append-only) ───────────────────────────
-- A simple log, NOT a workflow state machine (future scope): severity is an observation, response_action
-- is free text ("preventive drench scheduled" / "curative injection" / "palm removed" / …), recorded by
-- whoever is in the field when catches spike or a visual confirmation happens. Anchored to a trap and/or
-- a palm asset — a suspected infestation is often first seen ON a palm, not at a trap.
create table public.pest_incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  trap_id uuid references public.pest_traps(id),
  asset_id uuid references public.assets(id),
  reported_at date not null,
  severity text not null check (severity in ('watch','suspected','confirmed')),
  notes text,
  response_action text,
  created_at timestamptz not null default now(),
  constraint pest_incidents_anchor_chk check (trap_id is not null or asset_id is not null)
);
create index pest_incidents_org_idx on public.pest_incidents(org_id);
create index pest_incidents_trap_idx on public.pest_incidents(trap_id) where trap_id is not null;
create index pest_incidents_asset_idx on public.pest_incidents(asset_id) where asset_id is not null;

alter table public.pest_incidents enable row level security;
alter table public.pest_incidents force row level security;

create policy tenant_all on public.pest_incidents for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('op.execute', org_id)
    and (trap_id is null or exists (
      select 1 from public.pest_traps t where t.id = pest_incidents.trap_id and t.org_id = pest_incidents.org_id))
    and (asset_id is null or exists (
      select 1 from public.assets a where a.id = pest_incidents.asset_id and a.org_id = pest_incidents.org_id))
  );

grant select, insert on public.pest_incidents to authenticated;
revoke update, delete on public.pest_incidents from authenticated, anon;

create trigger audit_pest_incident after insert or update or delete on public.pest_incidents
  for each row execute function public.fn_audit('pest_incident');

-- ── RPCs — SECURITY DEFINER, op.execute gate IN the DB, cross-org guard, pinned search_path ────────────
-- (same pattern as fn_update_palm_status/0039, fn_record_event/0083)

create or replace function public.fn_save_trap(
  p_org uuid,
  p_code text,
  p_label text,
  p_installed_at date,
  p_sector_id uuid default null,
  p_hawsha_id uuid default null,
  p_line_id uuid default null,
  p_lure_changed_at date default null,
  p_notes text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_org is null then raise exception 'org_id required' using errcode = '22023'; end if;
  if p_code is null or btrim(p_code) = '' then raise exception 'trap code required' using errcode = '23502'; end if;
  if p_label is null or btrim(p_label) = '' then raise exception 'trap label required' using errcode = '23502'; end if;
  if p_installed_at is null then raise exception 'installed_at required' using errcode = '23502'; end if;

  if not public.authorize('op.execute', p_org) then
    raise exception 'forbidden: op.execute is required to register a trap' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and p_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org trap registration' using errcode = '42501'; end if;

  if p_sector_id is not null and not exists (
    select 1 from public.sectors s where s.id = p_sector_id and s.org_id = p_org) then
    raise exception 'sector % is not in this org', p_sector_id using errcode = '22023'; end if;
  if p_hawsha_id is not null and not exists (
    select 1 from public.hawshat h where h.id = p_hawsha_id and h.org_id = p_org) then
    raise exception 'hawsha % is not in this org', p_hawsha_id using errcode = '22023'; end if;
  if p_line_id is not null and not exists (
    select 1 from public.lines l where l.id = p_line_id and l.org_id = p_org) then
    raise exception 'line % is not in this org', p_line_id using errcode = '22023'; end if;

  insert into public.pest_traps(org_id, code, label, sector_id, hawsha_id, line_id, installed_at, lure_changed_at, notes)
  values (p_org, btrim(p_code), btrim(p_label), p_sector_id, p_hawsha_id, p_line_id, p_installed_at, p_lure_changed_at,
          nullif(btrim(coalesce(p_notes,'')),''))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'code', btrim(p_code));
end $$;

create or replace function public.fn_update_trap(
  p_trap_id uuid,
  p_lure_changed_at date default null,
  p_status text default null,
  p_notes text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.pest_traps where id = p_trap_id;
  if v_org is null then raise exception 'trap % not found', p_trap_id using errcode = 'P0002'; end if;

  if not public.authorize('op.execute', v_org) then
    raise exception 'forbidden: op.execute is required' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org trap update' using errcode = '42501'; end if;

  if p_status is not null and p_status not in ('active','removed') then
    raise exception 'invalid trap status: %', p_status using errcode = '22023'; end if;

  update public.pest_traps
     set lure_changed_at = coalesce(p_lure_changed_at, lure_changed_at),
         status = coalesce(p_status, status),
         notes = case when p_notes is not null then nullif(btrim(p_notes), '') else notes end
   where id = p_trap_id;

  return jsonb_build_object('id', p_trap_id);
end $$;

create or replace function public.fn_log_trap_catch(
  p_trap_id uuid,
  p_checked_at date,
  p_catch_count int,
  p_notes text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_id uuid;
begin
  select org_id into v_org from public.pest_traps where id = p_trap_id;
  if v_org is null then raise exception 'trap % not found', p_trap_id using errcode = 'P0002'; end if;

  if not public.authorize('op.execute', v_org) then
    raise exception 'forbidden: op.execute is required to log a trap catch' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org trap catch' using errcode = '42501'; end if;

  if p_checked_at is null then raise exception 'checked_at required' using errcode = '23502'; end if;
  if p_catch_count is null or p_catch_count < 0 then
    raise exception 'invalid catch_count: %', p_catch_count using errcode = '22023'; end if;

  insert into public.pest_trap_catches(org_id, trap_id, checked_at, catch_count, notes)
  values (v_org, p_trap_id, p_checked_at, p_catch_count, nullif(btrim(coalesce(p_notes,'')),''))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'trap_id', p_trap_id);
end $$;

create or replace function public.fn_report_pest_incident(
  p_reported_at date,
  p_severity text,
  p_trap_id uuid default null,
  p_asset_id uuid default null,
  p_notes text default null,
  p_response_action text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_org2 uuid; v_id uuid;
begin
  if p_trap_id is null and p_asset_id is null then
    raise exception 'either a trap or a palm asset is required to anchor a pest incident' using errcode = '22023'; end if;
  if p_reported_at is null then raise exception 'reported_at required' using errcode = '23502'; end if;
  if p_severity is null or p_severity not in ('watch','suspected','confirmed') then
    raise exception 'invalid incident severity: %', p_severity using errcode = '22023'; end if;

  if p_trap_id is not null then
    select org_id into v_org from public.pest_traps where id = p_trap_id;
    if v_org is null then raise exception 'trap % not found', p_trap_id using errcode = 'P0002'; end if;
  end if;
  if p_asset_id is not null then
    select org_id into v_org2 from public.assets where id = p_asset_id and type = 'palm';
    if v_org2 is null then raise exception 'palm asset % not found', p_asset_id using errcode = 'P0002'; end if;
    if v_org is not null and v_org2 is distinct from v_org then
      raise exception 'trap and palm asset belong to different orgs' using errcode = '22023'; end if;
    v_org := coalesce(v_org, v_org2);
  end if;

  if not public.authorize('op.execute', v_org) then
    raise exception 'forbidden: op.execute is required to report a pest incident' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org pest incident' using errcode = '42501'; end if;

  insert into public.pest_incidents(org_id, trap_id, asset_id, reported_at, severity, notes, response_action)
  values (v_org, p_trap_id, p_asset_id, p_reported_at, p_severity,
          nullif(btrim(coalesce(p_notes,'')),''), nullif(btrim(coalesce(p_response_action,'')),''))
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end $$;

do $$
declare sig text;
begin
  foreach sig in array array[
    'public.fn_save_trap(uuid, text, text, date, uuid, uuid, uuid, date, text)',
    'public.fn_update_trap(uuid, date, text, text)',
    'public.fn_log_trap_catch(uuid, date, int, text)',
    'public.fn_report_pest_incident(date, text, uuid, uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public', sig);
    execute format('revoke execute on function %s from anon', sig);
    execute format('grant execute on function %s to authenticated', sig);
  end loop;
end $$;
