-- Farm OS MVP-0 — PALM-STATUS-1 (#238): role-gated, atomic palm status change.
--
-- THE BUG. updatePalmStatus (app/(app)/farm/palm/[id]/actions.ts) enforced the field-role gate
-- ONLY in the app (requireRole supervisor/agri_engineer/farm_manager/owner). The underlying write
-- goes through the `assets` UPDATE RLS — `tenant_all` (migration 0003) — which is ORG-SCOPED ONLY
-- (org_id in user_org_ids), with NO role predicate. So ANY org member (accountant, storekeeper)
-- could change a tree's status by calling PostgREST directly, bypassing the app gate. Worse, the
-- action did TWO non-atomic writes: UPDATE assets.status, THEN INSERT palm_status_history. If the
-- history insert failed after the status flip committed, the status changed with NO audit trail.
--
-- THE FIX. A SECURITY DEFINER RPC that (1) enforces the field-role gate IN THE DATABASE via the
-- org-scoped authorize('op.execute', v_org) overload (migration 0035) — a palm status change is a
-- field operation, so op.execute = owner/farm_manager/agri_engineer/supervisor is the right gate;
-- and (2) does the status UPDATE and the history INSERT in ONE transaction, so a history failure
-- rolls the status change back — never a silent, unaudited flip. Mirrors fn_post_receipt (0029) /
-- fn_add_plan_operation (0038): authorize() reads the caller's JWT GUC, which SECURITY DEFINER does
-- NOT change, so the *caller's* op.execute permission IN v_org is evaluated even though the body
-- runs as the definer.
--
-- Locked down per migrations 0021/0035: pinned empty search_path, fully schema-qualified, revoked
-- from public + anon, granted only to authenticated.
create or replace function public.fn_update_palm_status(
  p_asset_id uuid,
  p_status text,
  p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_type text;
begin
  -- resolve the asset's org + type. Fail loudly on a missing asset rather than silently no-op'ing
  -- (the app reported "النخلة غير موجودة" for the empty-update case).
  select a.org_id, a.type into v_org, v_type
    from public.assets a
    where a.id = p_asset_id;
  if v_org is null then
    raise exception 'asset % not found', p_asset_id using errcode = 'P0002';
  end if;
  -- only palms carry a health status + per-tree history; refuse any other asset type clearly.
  if v_type is distinct from 'palm' then
    raise exception 'asset % is not a palm (type=%)', p_asset_id, v_type using errcode = '22023';
  end if;

  -- PALM-STATUS-1 (#238): enforce op.execute (the FIELD roles) SCOPED TO THE ASSET'S ORG, now that
  -- v_org is resolved. This is the gate the app-only requireRole was silently relying on; moving it
  -- into the definer RPC closes the direct-PostgREST bypass on the org-scoped-only assets RLS.
  if not public.authorize('op.execute', v_org) then
    raise exception 'forbidden: op.execute is required to change a palm''s status'
      using errcode = '42501';
  end if;

  -- org guard: anon is rejected; an authenticated caller's asset must be in one of their orgs
  -- (defence in depth alongside RLS), mirroring fn_add_plan_operation. The null-uid path is the
  -- trusted service/superuser context only.
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org palm status change on asset %', p_asset_id
      using errcode = '42501';
  end if;

  -- validate p_status against the closed set from the assets.status CHECK (migration 0003).
  if p_status is null or p_status not in ('active','watch','sick','dead','removed','replaced') then
    raise exception 'invalid palm status: %', p_status using errcode = '22023';
  end if;

  -- Atomic change: flip the asset's current status, THEN append the audit row, both in THIS
  -- transaction. A history-insert failure rolls the status change back automatically — the status
  -- never flips without its audit trail. changed_by = the caller; a blank note is stored as NULL.
  update public.assets set status = p_status where id = p_asset_id;

  insert into public.palm_status_history (org_id, asset_id, status, changed_by, reason)
  values (v_org, p_asset_id, p_status, (select auth.uid()),
          nullif(btrim(coalesce(p_note, '')), ''));

  return jsonb_build_object('asset_id', p_asset_id, 'status', p_status);
end $$;

revoke all     on function public.fn_update_palm_status(uuid, text, text) from public;
revoke execute on function public.fn_update_palm_status(uuid, text, text) from anon;
grant  execute on function public.fn_update_palm_status(uuid, text, text) to authenticated;
