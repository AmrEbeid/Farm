-- Farm OS — #398 follow-up: un-assign RPC for plan_operation_assignees.
--
-- Gap found in an independent code-map review: migration 0090 (plan_op_multiday_assignees) deliberately
-- withheld a client DELETE grant on plan_operation_assignees ("un-assign routes through a slice-2 RPC,
-- not client DELETE" — see its comment), but the slice-2 RPC (0093, fn_add_plan_operation_multi) only
-- ever ADDS assignees. No RPC to remove one was ever written, so once assigned a person could never be
-- un-assigned through the app. This migration adds that missing RPC.
--
-- Security (mirrors fn_add_plan_operation_multi, 0093, and fn_add_plan_operation, 0038): plan.write
-- enforced SCOPED TO THE OPERATION'S ORG (org-scoped authorize, 0035); anon rejected; an authenticated
-- caller's operation must be in one of their orgs. Unlike the add-RPCs (whose input is a plan id, so org
-- is resolved via plans.org_id), this RPC's input is an OPERATION id, so org is resolved directly from
-- plan_operations.org_id — the same column the 0090 RLS policy validates against, just read here
-- explicitly because the definer body bypasses RLS. search_path pinned empty; fully schema-qualified;
-- EXECUTE locked to authenticated.
--
-- Un-assigning a person who is not actually assigned to the operation is a SAFE NO-OP: the DELETE
-- matches zero rows, the function returns removed:false (honest — "nothing changed"), and no exception
-- is raised. This is deliberately NOT an error (a stale UI / duplicate remove-click must not surface a
-- scary failure) and deliberately NOT a silent generic "success" (the jsonb result tells the caller
-- whether anything was actually removed). fn_audit (0008) fires from the table trigger only when a row
-- is actually deleted, so a no-op leaves no phantom audit_log entry either.
create or replace function public.fn_unassign_plan_operation(
  p_op_id     uuid,
  p_person_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_deleted int;
begin
  -- resolve the operation's org directly (plan_operations carries org_id; no need to go via plans).
  select po.org_id into v_org
    from public.plan_operations po
    where po.id = p_op_id;
  if v_org is null then
    raise exception 'plan operation % not found', p_op_id using errcode = 'P0002';
  end if;

  -- AUTHZ-2 (#181): plan.write, scoped to the operation's org.
  if not public.authorize('plan.write', v_org) then
    raise exception 'forbidden: plan.write is required to unassign a plan operation'
      using errcode = '42501';
  end if;

  -- org guard: anon rejected; authenticated caller's operation must be in one of their orgs (defence in
  -- depth alongside RLS, mirrors fn_add_plan_operation_multi).
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org plan operation on operation %', p_op_id
      using errcode = '42501';
  end if;

  delete from public.plan_operation_assignees
    where plan_op_id = p_op_id and person_id = p_person_id and org_id = v_org;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('opId', p_op_id, 'personId', p_person_id, 'removed', v_deleted > 0);
end $$;

revoke all     on function public.fn_unassign_plan_operation(uuid, uuid) from public;
revoke execute on function public.fn_unassign_plan_operation(uuid, uuid) from anon;
grant  execute on function public.fn_unassign_plan_operation(uuid, uuid) to authenticated;
