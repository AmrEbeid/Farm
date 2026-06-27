-- Farm OS — STAGE 3 (SPEC-0010): ad-hoc activity/event recording.
--
-- The event spine (farm_event + event_locations + quantities + event_status_history + event_followups,
-- migration 0004) exists, but the only writer is fn_execute_operation (executing a PLANNED op). These
-- RPCs add direct recording of an operation/inspection/issue/note against any node, status transitions,
-- and follow-ups — the Stage 3 acceptance. Same pattern as fn_execute_operation (0020) / the structure
-- RPCs: SECURITY DEFINER, op.execute gate IN the DB (so a non-field role can't record via direct REST),
-- cross-org guard, atomic, pinned search_path, revoked from public+anon, granted to authenticated.
--
-- ROLL-UP: event_locations carries farm/sector/hawsha/line columns and the 360 pages filter by their own
-- level, so fn_record_event populates the FULL ancestor chain (a hawsha event also sets its sector_id +
-- farm_id) — that is what makes a tree/line/hawsha event appear on the sector and farm files too. A palm
-- event additionally links the asset via event_assets.

-- ── 1) fn_record_event — create an event against a node, atomically with its location + status row ──
create or replace function public.fn_record_event(
  p_location_type text,
  p_location_id uuid,
  p_type text default 'operation',
  p_subtype text default null,
  p_status text default 'done',
  p_occurred_at timestamptz default null,
  p_note text default null,
  p_assigned_to uuid default null,
  p_qty_measure text default null,
  p_qty_value numeric default null,
  p_qty_label text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid; v_farm uuid; v_sector uuid; v_hawsha uuid; v_line uuid; v_asset uuid;
  v_event uuid; v_occ timestamptz := coalesce(p_occurred_at, now());
begin
  if p_location_type not in ('farm','sector','hawsha','line','palm') then
    raise exception 'invalid location type: %', p_location_type using errcode = '22023'; end if;
  if p_type not in ('operation','inspection','issue','note') then
    raise exception 'invalid event type: %', p_type using errcode = '22023'; end if;
  if p_status not in ('planned','reserved','ready','blocked','in_progress','done','abandoned','skipped') then
    raise exception 'invalid event status: %', p_status using errcode = '22023'; end if;

  -- resolve the org + the FULL ancestor chain from the node (not trusted from the client).
  if p_location_type = 'farm' then
    select org_id into v_org from public.farms where id = p_location_id; v_farm := p_location_id;
  elsif p_location_type = 'sector' then
    select org_id, farm_id into v_org, v_farm from public.sectors where id = p_location_id;
    v_sector := p_location_id;
  elsif p_location_type = 'hawsha' then
    select h.org_id, h.sector_id, s.farm_id into v_org, v_sector, v_farm
      from public.hawshat h join public.sectors s on s.id = h.sector_id where h.id = p_location_id;
    v_hawsha := p_location_id;
  elsif p_location_type = 'line' then
    select l.org_id, l.hawsha_id, h.sector_id, s.farm_id into v_org, v_hawsha, v_sector, v_farm
      from public.lines l join public.hawshat h on h.id = l.hawsha_id join public.sectors s on s.id = h.sector_id
      where l.id = p_location_id;
    v_line := p_location_id;
  else
    -- Derive sector + farm from the palm's HAWSHA chain (authoritative), not the denormalized
    -- assets.sector_id — so a palm event still rolls up to the sector/farm files even if a future bulk
    -- import left assets.sector_id inconsistent with its hawsha (review L2). org + line stay off the asset.
    select a.org_id, a.line_id, a.hawsha_id into v_org, v_line, v_hawsha
      from public.assets a where a.id = p_location_id and a.type = 'palm';
    if v_hawsha is not null then
      select h.sector_id, s.farm_id into v_sector, v_farm
        from public.hawshat h join public.sectors s on s.id = h.sector_id where h.id = v_hawsha;
    end if;
    v_asset := p_location_id;
  end if;
  if v_org is null then raise exception '% % not found', p_location_type, p_location_id using errcode = 'P0002'; end if;

  if not public.authorize('op.execute', v_org) then
    raise exception 'forbidden: op.execute is required to record an activity' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org activity record' using errcode = '42501'; end if;
  -- an assignee, if given, must be a person in the same org.
  if p_assigned_to is not null and not exists (
    select 1 from public.people p where p.id = p_assigned_to and p.org_id = v_org) then
    raise exception 'assignee % is not in this org', p_assigned_to using errcode = '22023'; end if;

  v_event := gen_random_uuid();
  insert into public.farm_event(id, org_id, type, subtype, status, occurred_at, notes, created_by, assigned_to_person_id)
  values (v_event, v_org, p_type, nullif(btrim(coalesce(p_subtype,'')),''), p_status, v_occ,
          nullif(btrim(coalesce(p_note,'')),''), (select auth.uid()), p_assigned_to);

  insert into public.event_locations(event_id, org_id, farm_id, sector_id, hawsha_id, line_id)
  values (v_event, v_org, v_farm, v_sector, v_hawsha, v_line);

  if v_asset is not null then
    insert into public.event_assets(event_id, asset_id, org_id) values (v_event, v_asset, v_org);
  end if;

  insert into public.event_status_history(org_id, event_id, status, changed_by)
  values (v_org, v_event, p_status, (select auth.uid()));

  -- optional DESCRIPTIVE quantity (a count/weight observation) — never moves stock (that is the planned
  -- fn_execute_operation path); inventory_adjustment stays 0.
  if p_qty_value is not null then
    insert into public.quantities(org_id, event_id, measure, value_num, label, inventory_adjustment)
    values (v_org, v_event, nullif(btrim(coalesce(p_qty_measure,'')),''), p_qty_value,
            nullif(btrim(coalesce(p_qty_label,'')),''), 0);
  end if;

  return jsonb_build_object('event_id', v_event, 'status', p_status);
end $$;

-- ── 2) fn_set_event_status — flip status + append history atomically ────────────────────────────────
create or replace function public.fn_set_event_status(
  p_event_id uuid,
  p_status text,
  p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.farm_event where id = p_event_id;
  if v_org is null then raise exception 'event % not found', p_event_id using errcode = 'P0002'; end if;
  if p_status not in ('planned','reserved','ready','blocked','in_progress','done','abandoned','skipped') then
    raise exception 'invalid event status: %', p_status using errcode = '22023'; end if;

  if not public.authorize('op.execute', v_org) then
    raise exception 'forbidden: op.execute is required' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org event status change' using errcode = '42501'; end if;

  update public.farm_event set status = p_status where id = p_event_id;
  insert into public.event_status_history(org_id, event_id, status, changed_by)
  values (v_org, p_event_id, p_status, (select auth.uid()));
  return jsonb_build_object('event_id', p_event_id, 'status', p_status);
end $$;

-- ── 3) fn_add_event_followup — schedule a follow-up on an event ──────────────────────────────────────
create or replace function public.fn_add_event_followup(
  p_event_id uuid,
  p_note text,
  p_due_at timestamptz default null,
  p_assigned_to uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_id uuid;
begin
  select org_id into v_org from public.farm_event where id = p_event_id;
  if v_org is null then raise exception 'event % not found', p_event_id using errcode = 'P0002'; end if;

  if not public.authorize('op.execute', v_org) then
    raise exception 'forbidden: op.execute is required' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org follow-up' using errcode = '42501'; end if;
  if p_assigned_to is not null and not exists (
    select 1 from public.people p where p.id = p_assigned_to and p.org_id = v_org) then
    raise exception 'assignee % is not in this org', p_assigned_to using errcode = '22023'; end if;
  if p_note is null or btrim(p_note) = '' then raise exception 'follow-up note required' using errcode = '23502'; end if;

  insert into public.event_followups(org_id, event_id, due_at, assigned_to_person_id, status, note)
  values (v_org, p_event_id, p_due_at, p_assigned_to, 'open', btrim(p_note))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'event_id', p_event_id);
end $$;

-- ── grants — revoke from public+anon, grant to authenticated only ───────────────────────────────────
do $$
declare sig text;
begin
  foreach sig in array array[
    'public.fn_record_event(text, uuid, text, text, text, timestamptz, text, uuid, text, numeric, text)',
    'public.fn_set_event_status(uuid, text, text)',
    'public.fn_add_event_followup(uuid, text, timestamptz, uuid)'
  ] loop
    execute format('revoke all on function %s from public', sig);
    execute format('revoke execute on function %s from anon', sig);
    execute format('grant execute on function %s to authenticated', sig);
  end loop;
end $$;
