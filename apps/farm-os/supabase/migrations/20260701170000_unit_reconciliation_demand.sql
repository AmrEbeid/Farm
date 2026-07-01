-- Farm OS — #216 unit-of-measure reconciliation, DEMAND side (Option A). Owner-directed build
-- ("go with your recommendation") on the #216 proposal; independent review completed (the supply-first
-- ordering was rejected — demand units must be reconciled first, else execute/receipt can hard-fail).
-- Engine surface → this migration itself was independently reviewed + prod re-probed.
--
-- PROBLEM (the REAL masking vector): the stock engine sums plan_material_requirements.qty UNIT-BLIND
-- (fn_stock_coverage). A requirement entered in a unit other than the item's canonical inventory_items.unit
-- — e.g. qty=0.5 unit='ton' for a kg-tracked item — is read as its raw number (0.5), so a 500 kg draw reads
-- as ~nothing → the shortage is MASKED (cardinal sin, SPEC-0001 §1). fn_add_plan_operation_multi even
-- defaults an omitted unit to 'kg', which mislabels every requirement on a litre/piece item.
-- Prod probe (2026-07-01): 0 mismatched requirements, 0 requirements on non-kg items, every item has a unit
-- → enforcement validates cleanly, no backfill. Preventive against future non-kg requirements.
--
-- FIX: a BEFORE INSERT/UPDATE trigger on plan_material_requirements that DEFAULTS a null unit to the item's
-- canonical unit and REJECTS a non-null mismatch (22023 — errs safe: a loud reject, never a silent
-- miscount). Comprehensive: covers every writer (both plan RPCs + any direct write). Then fix the multi RPC's
-- 'kg' default to null so an omitted unit on a non-kg item defaults via the trigger instead of hard-failing.
-- The single-material fn_add_plan_operation passes p_unit verbatim → the trigger handles it (no change).
-- Grants preserved by create-or-replace. Validation: pgTAP 108 (define-check-first) + full harness; prod re-probe.

-- ── 1) The reconciliation trigger on plan_material_requirements ──────────────────────────────────────────
create or replace function public.fn_pmr_unit_reconcile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_unit text;
begin
  select unit into v_item_unit from public.inventory_items where id = new.item_id;
  -- default a missing requirement unit to the item's canonical unit (so an omission is safe, not a mismatch)
  if new.unit is null then
    new.unit := v_item_unit;
  end if;
  -- reject a non-null mismatch: a requirement in a different unit than the item is summed unit-blind by the
  -- engine → masks/inflates demand. Null-unit items (no canonical unit) are unaffected.
  if v_item_unit is not null and new.unit is not null and new.unit <> v_item_unit then
    raise exception 'unit mismatch: requirement for item % is in % but the item is tracked in %',
      new.item_id, new.unit, v_item_unit using errcode = '22023';
  end if;
  return new;
end $$;

-- Trigger functions are never invoked directly and must hold NO client EXECUTE (security invariant INV-1/
-- INV-2, tests/22; matches fn_audit). Revoke the default public grant so anon/authenticated cannot call it.
revoke all on function public.fn_pmr_unit_reconcile() from public;
revoke execute on function public.fn_pmr_unit_reconcile() from anon, authenticated;

drop trigger if exists trg_pmr_unit_reconcile on public.plan_material_requirements;
create trigger trg_pmr_unit_reconcile
  before insert or update on public.plan_material_requirements
  for each row execute function public.fn_pmr_unit_reconcile();

-- ── 2) fn_add_plan_operation_multi: re-emit (0093) with the material 'kg' default → null ─────────────────
-- The ONLY change vs 0093 is the material-insert unit: coalesce(v_mat->>'unit','kg') → nullif(...,''), so an
-- omitted/blank unit is null and the trigger defaults it to the item's unit (was a wrong 'kg' for non-kg items).
create or replace function public.fn_add_plan_operation_multi(
  p_plan_id      uuid,
  p_subtype      text,
  p_planned_at   date,
  p_ends_on      date,
  p_est_cost     numeric,
  p_materials    jsonb,
  p_labor        jsonb,
  p_assignee_ids uuid[],
  p_lead_id      uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org        uuid;
  v_scope_type text;
  v_scope_id   uuid;
  v_op_id      uuid;
  v_mat        jsonb;
  v_lab        jsonb;
  v_pid        uuid;
  v_dup        uuid;
  v_n_mat      int := 0;
  v_n_lab      int := 0;
  v_n_asg      int := 0;
begin
  select pl.org_id, pl.scope_type, pl.scope_id
    into v_org, v_scope_type, v_scope_id
    from public.plans pl
    where pl.id = p_plan_id;
  if v_org is null then
    raise exception 'plan % not found', p_plan_id using errcode = 'P0002';
  end if;

  if not public.authorize('plan.write', v_org) then
    raise exception 'forbidden: plan.write is required to author a plan operation'
      using errcode = '42501';
  end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org plan operation on plan %', p_plan_id
      using errcode = '42501';
  end if;

  if p_ends_on is not null and p_planned_at is not null and p_ends_on < p_planned_at then
    raise exception 'ends_on % precedes planned_at %', p_ends_on, p_planned_at using errcode = '22023';
  end if;
  if p_lead_id is not null and (p_assignee_ids is null or not (p_lead_id = any (p_assignee_ids))) then
    raise exception 'lead % must be one of the assignees', p_lead_id using errcode = '22023';
  end if;

  select po.id into v_dup from public.plan_operations po
    where po.plan_id = p_plan_id and po.subtype = p_subtype
      and po.planned_at is not distinct from p_planned_at
    limit 1;
  if v_dup is not null then
    return jsonb_build_object('operationId', v_dup, 'deduped', true, 'materials', 0, 'labor', 0, 'assignees', 0);
  end if;

  insert into public.plan_operations (org_id, plan_id, subtype, target_type, target_id, planned_at,
                                      ends_on, priority, responsible_person_id, est_cost, approval_needed, status)
  values (v_org, p_plan_id, p_subtype, coalesce(v_scope_type, 'sector'), v_scope_id, p_planned_at,
          p_ends_on, 1, p_lead_id, p_est_cost, true, 'planned')
  returning id into v_op_id;

  for v_mat in select * from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb)) loop
    if not exists (select 1 from public.inventory_items it
                   where it.id = (v_mat->>'item_id')::uuid and it.org_id = v_org) then
      raise exception 'material item % is not in org %', v_mat->>'item_id', v_org using errcode = '22023';
    end if;
    if coalesce((v_mat->>'qty')::numeric, 0) < 0 then
      raise exception 'material qty must be non-negative' using errcode = '22023';
    end if;
    -- unit: null when omitted/blank → the trg_pmr_unit_reconcile trigger defaults it to the item's canonical
    -- unit and rejects a real mismatch (was coalesce(...,'kg'), which mislabelled non-kg items).
    insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
    values (v_org, v_op_id, (v_mat->>'item_id')::uuid, (v_mat->>'qty')::numeric, nullif(v_mat->>'unit', ''));
    v_n_mat := v_n_mat + 1;
  end loop;

  for v_lab in select * from jsonb_array_elements(coalesce(p_labor, '[]'::jsonb)) loop
    if coalesce((v_lab->>'count')::int, 0) < 0 or coalesce((v_lab->>'days')::numeric, 0) < 0 then
      raise exception 'labour count/days must be non-negative' using errcode = '22023';
    end if;
    insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days)
    values (v_org, v_op_id, v_lab->>'person_or_team', (v_lab->>'count')::int, (v_lab->>'days')::numeric);
    v_n_lab := v_n_lab + 1;
  end loop;

  if p_assignee_ids is not null then
    foreach v_pid in array p_assignee_ids loop
      if not exists (select 1 from public.people pe
                     where pe.id = v_pid and pe.org_id = v_org and pe.active) then
        raise exception 'assignee % is not an active member of org %', v_pid, v_org using errcode = '22023';
      end if;
      insert into public.plan_operation_assignees (org_id, plan_op_id, person_id, is_lead)
      values (v_org, v_op_id, v_pid, (v_pid = p_lead_id))
      on conflict (plan_op_id, person_id) do nothing;
      v_n_asg := v_n_asg + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'operationId', v_op_id, 'materials', v_n_mat, 'labor', v_n_lab, 'assignees', v_n_asg);
end $$;

revoke all     on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid) from public;
revoke execute on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid) from anon;
grant  execute on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid) to authenticated;
