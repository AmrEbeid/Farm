-- Farm OS — structure CRUD integrity fixes (#516). Three decision-free one-line corrections, each RPC
-- re-emitted VERBATIM from 0081 except the noted change. The canonical registry counts are untouched.
--
-- (1) fn_archive_structure restore (sector branch): the ARCHIVE predicate archives palms by
--     `sector_id = p_id OR hawsha_id in (hawshat under sector)`, but the RESTORE only un-archived by
--     `sector_id = p_id`, so a palm with null sector_id but a hawsha under the sector (the bulk-import case)
--     was archived on sector-remove but never restored → stranded. Mirror the archive predicate in restore.
-- (2) fn_save_hawsha: `row_count = p_row_count` erased row_count when the field is blanked; coalesce it (as
--     the palm counts already are) so an omitted param can't wipe it.
-- (3) fn_save_hawsha / fn_save_line create: reject an archived parent (parallel to 0089's palm-move guard)
--     so you can't create a live node under a hidden parent.
--
-- Grants are preserved by create-or-replace. Validation: pgTAP 82/89 (unchanged behavior) + new 107
-- (define-check-first for all three). Applied to prod migrate-first with a function-def re-probe.

-- ── fn_save_hawsha: coalesce row_count (2) + archived-parent guard on create (3) ──────────────────────
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
declare v_org uuid; v_sector uuid; v_id uuid; v_parent_archived boolean;
begin
  if p_id is not null then
    select h.org_id, h.sector_id into v_org, v_sector from public.hawshat h where h.id = p_id;
    if v_org is null then raise exception 'hawsha % not found', p_id using errcode = 'P0002'; end if;
  else
    if p_sector_id is null then raise exception 'sector_id required to create a hawsha' using errcode = '23502'; end if;
    select s.org_id, s.archived into v_org, v_parent_archived from public.sectors s where s.id = p_sector_id;
    if v_org is null then raise exception 'sector % not found', p_sector_id using errcode = 'P0002'; end if;
    if v_parent_archived then raise exception 'cannot add a hawsha to an archived sector' using errcode = '22023'; end if;
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
    -- coalesce the canonical registry counts AND row_count: an omitted/cleared param must NOT erase a
    -- stored value (non-negotiable #5/#1). Pass an explicit 0 to zero a count, never an omission.
    update public.hawshat set name = btrim(p_name), code = btrim(p_code), area_qirat = p_area_qirat,
      row_count = coalesce(p_row_count, row_count),
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

-- ── fn_save_line: archived-parent guard on create (3) ────────────────────────────────────────────────
create or replace function public.fn_save_line(
  p_id uuid,
  p_hawsha_id uuid,
  p_line_no int,
  p_line_code text default null,
  p_palm_count int default null,
  p_direction text default null,
  p_notes text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_hawsha uuid; v_id uuid; v_parent_archived boolean;
begin
  if p_id is not null then
    select l.org_id, l.hawsha_id into v_org, v_hawsha from public.lines l where l.id = p_id;
    if v_org is null then raise exception 'line % not found', p_id using errcode = 'P0002'; end if;
  else
    if p_hawsha_id is null then raise exception 'hawsha_id required to create a line' using errcode = '23502'; end if;
    select h.org_id, h.archived into v_org, v_parent_archived from public.hawshat h where h.id = p_hawsha_id;
    if v_org is null then raise exception 'hawsha % not found', p_hawsha_id using errcode = 'P0002'; end if;
    if v_parent_archived then raise exception 'cannot add a line to an archived hawsha' using errcode = '22023'; end if;
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

-- ── fn_archive_structure: mirror the archive predicate in the sector RESTORE branch (1) ───────────────
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
        -- mirror the ARCHIVE predicate: restore palms by sector_id OR via a hawsha under the sector, so a
        -- null-sector_id/hawsha-only palm archived with the sector is not left stranded (#516).
        update public.assets  set archived = false, archived_at = null
          where (sector_id = p_id or hawsha_id in (select id from public.hawshat where sector_id = p_id))
            and archived_at = v_at;
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
