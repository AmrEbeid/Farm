-- Farm OS — STAGE 4 (SPEC-0011): planning-workspace remainder — create a plan + assign + labor.
--
-- The plan spine (plans/plan_operations/requirements/checks, 0006) + fn_add_plan_operation (0038) +
-- the checks + planned-vs-actual UIs exist, but there is NO way to CREATE a plan, set its status, assign
-- a responsible person, or capture labor. These RPCs add that. plan.write = owner/farm_manager (0001).
-- Same posture as fn_add_plan_operation (0038): SECURITY DEFINER, plan.write gate IN the DB, cross-org
-- guard, pinned search_path, revoked from public+anon, granted to authenticated.

-- ── 1) gate the plans table's direct-REST writes on plan.write (parity with plan_operations/0025) ────
-- plans kept the org-only tenant_all from 0006; the app creates plans only via fn_create_plan (definer,
-- bypasses RLS), so this just closes the direct-PostgREST hole. plan_checks is intentionally left org-only
-- (runPlanChecks writes it via REST after an app-layer plan.write check).
drop policy if exists tenant_all on public.plans;
create policy tenant_all on public.plans for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('plan.write', org_id)
  );

-- ── 2) fn_create_plan ───────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_create_plan(
  p_type text,
  p_period_start date,
  p_period_end date,
  p_scope_type text default 'farm',
  p_scope_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_n int;
begin
  if p_type is null or p_type not in ('weekly','monthly','quarterly','annual') then
    raise exception 'invalid plan type: %', p_type using errcode = '22023'; end if;
  if p_scope_type is null or p_scope_type not in ('farm','sector','hawsha') then
    raise exception 'invalid scope type: %', p_scope_type using errcode = '22023'; end if;
  if p_period_start is not null and p_period_end is not null and p_period_end < p_period_start then
    raise exception 'period_end before period_start' using errcode = '22023'; end if;

  -- resolve the org: from the scope node if given, else the caller's single org (pilot). A multi-org
  -- caller MUST pass a scope so the plan's org is unambiguous.
  if p_scope_id is not null then
    if    p_scope_type = 'farm'   then select org_id into v_org from public.farms   where id = p_scope_id;
    elsif p_scope_type = 'sector' then select org_id into v_org from public.sectors where id = p_scope_id;
    else                               select org_id into v_org from public.hawshat where id = p_scope_id; end if;
    if v_org is null then raise exception '% % not found', p_scope_type, p_scope_id using errcode = 'P0002'; end if;
  else
    select count(*)::int into v_n from public.user_org_ids();
    if v_n <> 1 then raise exception 'scope required (caller is not single-org)' using errcode = '22023'; end if;
    select o into v_org from public.user_org_ids() o limit 1;
  end if;

  if not public.authorize('plan.write', v_org) then
    raise exception 'forbidden: plan.write is required to create a plan' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org plan' using errcode = '42501'; end if;

  insert into public.plans(org_id, type, period_start, period_end, scope_type, scope_id, status)
  values (v_org, p_type, p_period_start, p_period_end, p_scope_type, p_scope_id, 'draft')
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- ── 3) fn_set_plan_status ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_set_plan_status(
  p_plan_id uuid,
  p_status text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.plans where id = p_plan_id;
  if v_org is null then raise exception 'plan % not found', p_plan_id using errcode = 'P0002'; end if;
  if p_status is null or p_status not in ('draft','active','closed','abandoned') then
    raise exception 'invalid plan status: %', p_status using errcode = '22023'; end if;

  if not public.authorize('plan.write', v_org) then
    raise exception 'forbidden: plan.write is required' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org plan status change' using errcode = '42501'; end if;

  update public.plans set status = p_status where id = p_plan_id;
  return jsonb_build_object('id', p_plan_id, 'status', p_status);
end $$;

-- ── 4) fn_assign_plan_operation — set/clear the responsible person ("assign people") ────────────────
create or replace function public.fn_assign_plan_operation(
  p_op_id uuid,
  p_person_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.plan_operations where id = p_op_id;
  if v_org is null then raise exception 'plan operation % not found', p_op_id using errcode = 'P0002'; end if;

  if not public.authorize('plan.write', v_org) then
    raise exception 'forbidden: plan.write is required' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org assignment' using errcode = '42501'; end if;
  -- the person (when set) must be in the operation's org.
  if p_person_id is not null and not exists (
    select 1 from public.people p where p.id = p_person_id and p.org_id = v_org) then
    raise exception 'person % is not in this org', p_person_id using errcode = '22023'; end if;

  update public.plan_operations set responsible_person_id = p_person_id where id = p_op_id;
  return jsonb_build_object('op_id', p_op_id, 'person_id', p_person_id);
end $$;

-- ── 5) fn_add_plan_labor — capture a labor requirement on an operation ──────────────────────────────
create or replace function public.fn_add_plan_labor(
  p_plan_op_id uuid,
  p_person_or_team text,
  p_count int default null,
  p_days numeric default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_id uuid;
begin
  select org_id into v_org from public.plan_operations where id = p_plan_op_id;
  if v_org is null then raise exception 'plan operation % not found', p_plan_op_id using errcode = 'P0002'; end if;

  if not public.authorize('plan.write', v_org) then
    raise exception 'forbidden: plan.write is required' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org labor requirement' using errcode = '42501'; end if;
  if p_person_or_team is null or btrim(p_person_or_team) = '' then
    raise exception 'person_or_team required' using errcode = '23502'; end if;
  if coalesce(p_count, 0) < 0 or coalesce(p_days, 0) < 0 then
    raise exception 'count/days must be non-negative' using errcode = '22023'; end if;

  insert into public.plan_labor_requirements(org_id, plan_op_id, person_or_team, count, days)
  values (v_org, p_plan_op_id, btrim(p_person_or_team), p_count, p_days)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────────────────────────────
do $$
declare sig text;
begin
  foreach sig in array array[
    'public.fn_create_plan(text, date, date, text, uuid)',
    'public.fn_set_plan_status(uuid, text)',
    'public.fn_assign_plan_operation(uuid, uuid)',
    'public.fn_add_plan_labor(uuid, text, int, numeric)'
  ] loop
    execute format('revoke all on function %s from public', sig);
    execute format('revoke execute on function %s from anon', sig);
    execute format('grant execute on function %s to authenticated', sig);
  end loop;
end $$;
