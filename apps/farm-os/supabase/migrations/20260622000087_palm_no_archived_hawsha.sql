-- 20260622000087 — fn_save_palm: reject re-parenting a palm into an ARCHIVED hawsha (data integrity).
--
-- Gap surfaced by an independent review (2026-06-27): on an EDIT (p_id not null) with a non-null
-- p_hawsha_id, fn_save_palm re-parents the palm to the target hawsha (`v_hawsha := p_hawsha_id`) but never
-- checks whether that hawsha is archived. A live palm could therefore be moved under an archived hawsha and
-- then disappear from every live view (sectors/hawshat/lines/assets all filter `archived = false`).
--
-- This is purely a DATA-INTEGRITY hole, NOT a tenant-isolation one — the cross-org guard added in
-- 0081 (authorize against the palm's OWN org, forbid a cross-org move) is sound and is left untouched.
--
-- Fix: capture the target hawsha's `archived` flag alongside its org/sector, and on an EXPLICIT re-parent
-- (p_id not null AND p_hawsha_id not null) reject with errcode 22023 when that target is archived. The guard
-- is gated on p_hawsha_id so an in-place edit (p_hawsha_id null) of a palm whose own hawsha happens to be
-- archived is NOT blocked — that is an edit, not a move. SECURITY DEFINER + search_path = '' preserved; all
-- existing guards (org re-derivation, cross-org block, authorize, anon, sex/line validation) preserved verbatim.
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
declare v_org uuid; v_hawsha uuid; v_sector uuid; v_id uuid; v_palm_org uuid; v_hawsha_archived boolean;
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
  select h.org_id, h.sector_id, h.archived into v_org, v_sector, v_hawsha_archived
    from public.hawshat h where h.id = v_hawsha;
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

  -- EDIT must not re-parent a palm into an ARCHIVED hawsha: it would vanish from every live view
  -- (which filter archived = false). Gated on p_hawsha_id so this fires only on an explicit re-parent,
  -- never on an in-place edit of a palm that already lives under an archived hawsha.
  if p_id is not null and p_hawsha_id is not null and v_hawsha_archived then
    raise exception 'cannot move palm % into an archived hawsha %', p_id, v_hawsha using errcode = '22023'; end if;

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
