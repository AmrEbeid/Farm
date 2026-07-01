-- Farm OS — individual-palm rescue/exception treatments.
--
-- PROBLEM: the farm's block-wide fertigation programs are already well modelled via
-- plan_operations scoped to a plan/hawsha (OperationBuilder). Real practice ALSO needs
-- quick, one-off treatments targeted at a SPECIFIC ailing palm (e.g. a root-stimulant
-- drench for one weak tree) — distinct from, and much lighter than, authoring a full
-- plan operation. plan_operations.target_type/target_id can already point at a palm
-- (free text column, no CHECK), but the two existing write RPCs cannot express it:
-- fn_add_plan_operation / fn_add_plan_operation_multi both derive target_type/target_id
-- FROM THE PLAN's scope (coalesce(v_scope_type,'sector'), v_scope_id) and ignore any
-- palm-level target. A palm-scoped write also needs a plan_id, and there is no
-- "no plan needed" path today.
--
-- DESIGN DECISION (documented per the task): rather than write a NEW operation-creation
-- RPC (which would duplicate fn_add_plan_operation_multi's authz/atomicity/dedup logic —
-- already reviewed this session), this migration:
--   1) Re-emits fn_add_plan_operation_multi adding three new, OPTIONAL, trailing
--      parameters: p_target_type / p_target_id / p_note. When target_type/target_id
--      are supplied and valid (target_type = 'palm', target_id an asset of type 'palm' in the
--      plan's org), they OVERRIDE the plan-scope-derived target for this operation only. p_note
--      (free text, e.g. "نخلة ضعيفة - معالجة بمنشط جذور") is stored on the new plan_operations.note
--      column added below — plan_operations had no free-text field before this; a quick per-palm
--      exception treatment needs one to be useful as a rescue log, and adding ONE nullable column
--      is far smaller/safer than routing the note through an unrelated system (e.g. the ad-hoc
--      farm_event table), which would split one treatment across two tables for no benefit. Every
--      existing caller (OperationBuilder, plans/[planId]/actions.ts) omits all three new params —
--      its behaviour is byte-for-byte unchanged (defaults preserve backward compatibility).
--   2) Adds a small, narrowly-scoped resolver RPC, fn_get_or_create_individual_treatment_plan
--      (NOT an operation-creation RPC — it only finds-or-creates the PARENT PLAN CONTAINER),
--      so the palm-360 "log a treatment" affordance needs zero plan-picking UI: it silently
--      resolves (or, on first use per org, creates) ONE implicit ad-hoc plan per org to hang
--      individual-palm operations off of. This is the least-friction option: it avoids (a)
--      forcing a field user to know/select an "active plan" (there may be zero, one, or many,
--      scoped to different sectors/hawshat — none of which is obviously "the" palm's plan),
--      and (b) inventing a "no plan_id" write path, which would mean either loosening the
--      plan_operations.plan_id NOT NULL FK (a much bigger, riskier change touching every
--      existing read/report keyed on plan_id) or duplicating the RPC's insert without a plan.
--   3) The implicit plan is tagged via a new nullable boolean column,
--      plans.is_individual_treatment_plan, with a PARTIAL UNIQUE INDEX on (org_id) WHERE
--      is_individual_treatment_plan — guaranteeing at most one per org (safe under a
--      concurrent double-click: the second INSERT's unique-violation is caught and the
--      function re-selects the winner). This is explicit and queryable, unlike inferring
--      "the ad-hoc plan" from type/scope conventions (which could collide with a real
--      user-created plan that happens to look the same).
--
-- KNOWN MINOR UX SIDE-EFFECT: the implicit plan appears as an ordinary row on /plans (it is
-- a real plans row, not fabricated data — non-negotiable #1 is about data, not UI polish).
-- It reads as a "monthly" farm-scoped plan with no period; a follow-up could special-case
-- its label if this bothers users in practice, but that is a presentation nice-to-have, not
-- required for this PR.
--
-- SECURITY: the resolver RPC mirrors fn_create_plan's authz — plan.write, org-scoped, anon
-- rejected, cross-org rejected — so it carries no less protection than authoring a plan by
-- hand. fn_add_plan_operation_multi's existing plan.write / cross-org / atomicity checks are
-- untouched; the new target override runs INSIDE the same transaction as the op insert, so a
-- bad target_id (wrong org, not type='palm') rolls the whole call back exactly like a bad
-- material item_id does today.
--
-- Validation: pgTAP (new test file) covers the resolver's find-or-create + org gate, and the
-- multi RPC's target override + org-guard on a cross-org/non-palm target_id. Full local
-- harness run alongside.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CROSS-PR RECONCILIATION (3-way conflict on fn_add_plan_operation_multi, resolved this session):
-- PR #562 (feat/spray-compliance-record), PR #560 (feat/soil-test-irrigation-and-templates), and
-- PR #563 (this branch) each independently re-emitted fn_add_plan_operation_multi from the SAME
-- 9-arg base (migration 20260701170000). This migration is now the FINAL, COMBINED signature,
-- layered as:
--   LAYER 1 — PR #562 (most-reviewed/most-trusted of the three; UNCHANGED, no edits to its branch):
--             adds p_preferred_time_of_day (plan_operations) + nine per-material spray-compliance
--             columns on plan_material_requirements (target_pest, apc_registration_ref, rei_hours,
--             phi_days, target_zone, applicator_person_id, wind_speed_kmh, wind_direction, air_temp_c),
--             handled in the MATERIALS LOOP. Produces a 10-arg signature.
--   LAYER 2 — PR #560: adds p_irrigation_basis + p_soil_moisture_reading (plan_operations columns,
--             set on the main INSERT only — no materials-loop involvement). Re-emitted ON TOP OF
--             #562's 10-arg (not the original 9-arg). Produces a 12-arg signature.
--   LAYER 3 — PR #563 (this migration): adds p_target_type / p_target_id (override the plan-scope-
--             derived target, validated against the `assets` table) + p_note (plan_operations free-
--             text column). Re-emitted ON TOP OF #560's 12-arg. Produces the FINAL 15-arg signature.
--
-- REQUIRED APPLY ORDER: #562 → #560 → #563 (this migration). This migration's DROP FUNCTION targets
-- the 12-ARG signature #560 produces (uuid,text,date,date,numeric,jsonb,jsonb,uuid[],uuid,text,text,text)
-- — NOT the original 9-arg — because by the time this migration runs, the live function is already
-- #560's 12-arg version.
--
-- WHY THE THREE CHANGES COMPOSE CLEANLY (no overlapping logic, a straightforward union):
--   • #562's change is scoped to the MATERIALS LOOP (per-material-line validation + extra insert
--     columns) and the preferred_time_of_day scalar on the main INSERT.
--   • #560's change is scoped to the plan_operations INSERT's column list (two more scalars) —
--     touches no per-material logic, no target-resolution logic.
--   • #563's change is scoped to TARGET resolution (a new block BEFORE the dedup check, computing
--     v_target_type/v_target_id) and the plan_operations INSERT's column list (one more scalar,
--     `note`) plus using v_target_type/v_target_id instead of the raw scope values in that INSERT
--     and in the dedup lookup.
-- All three touch the SAME insert statement's column list (additively — different columns) and
-- otherwise touch disjoint sections of the function body. No conflicting overlap was found.
--
-- FINAL 15-PARAM LIST (in signature order) and each param's origin:
--   1.  p_plan_id                uuid    — original (9-arg base)
--   2.  p_subtype                text    — original
--   3.  p_planned_at             date    — original
--   4.  p_ends_on                date    — original
--   5.  p_est_cost               numeric — original
--   6.  p_materials              jsonb   — original
--   7.  p_labor                  jsonb   — original
--   8.  p_assignee_ids           uuid[]  — original
--   9.  p_lead_id                uuid    — original
--   10. p_preferred_time_of_day text    — PR #562 (spray-compliance-record)
--   11. p_irrigation_basis      text    — PR #560 (soil-test-irrigation-and-templates)
--   12. p_soil_moisture_reading text    — PR #560 (soil-test-irrigation-and-templates)
--   13. p_target_type           text    — PR #563 (individual-palm-treatment, this branch)
--   14. p_target_id             uuid    — PR #563 (individual-palm-treatment, this branch)
--   15. p_note                  text    — PR #563 (individual-palm-treatment, this branch)
-- Every trailing param defaults to null — every existing caller (app-layer callers in all three
-- branches use Supabase/PostgREST NAMED-parameter calls, sb.rpc("fn_add_plan_operation_multi",
-- {p_x: ...}), which resolves by parameter NAME, not position) needs zero code changes regardless
-- of this final order, and omitting a param yields byte-for-byte the same behaviour as before that
-- param existed.
--
-- BUG FIX CARRIED FORWARD FROM MAIN, FLAGGED FOR VISIBILITY (not introduced by this reconciliation):
-- both #562's and #560's OWN draft migrations had independently regressed the per-material
-- unit-insert from `nullif(v_mat->>'unit', '')` (the fix landed in migration 20260701170000, unit-
-- of-measure reconciliation, DEMAND side — the fix that lets the trg_pmr_unit_reconcile trigger
-- correctly default an omitted unit to the item's canonical unit instead of forcing 'kg') back to
-- `coalesce(v_mat->>'unit', 'kg')`. This branch (#563) forked after 170000 and kept the fix intact,
-- so the combined function below uses `nullif(...)`, matching main and #563's own already-reviewed
-- code — NOT a silent behaviour change introduced by merging, but a restoration of a fix that #562/
-- #560 each independently, accidentally dropped in their own re-emits (likely authored from a stale
-- pre-170000 copy of the function). #562's own migration FILE is untouched, per instruction; this
-- decision only affects what THIS (563) and the intermediate (560) migrations emit. See the PR
-- comments on #560/#562/#563 for the full callout to the owner.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1) plans: tag column + at-most-one-per-org partial unique index ────────────────────────
alter table public.plans
  add column if not exists is_individual_treatment_plan boolean not null default false;

create unique index if not exists plans_org_individual_treatment_uniq
  on public.plans (org_id)
  where is_individual_treatment_plan;

-- ── 1b) plan_operations: a free-text note, so a quick per-palm treatment log is useful (the
--    "نخلة ضعيفة - معالجة بمنشط جذور" kind of note a field user actually writes). Nullable, no
--    default behaviour change for existing rows/readers (a new SELECTed column only appears where
--    a query explicitly asks for it).
alter table public.plan_operations
  add column if not exists note text;

-- ── 2) fn_get_or_create_individual_treatment_plan: find-or-create the org's implicit plan ──
-- Not an operation-creation RPC — it only resolves/creates the PARENT PLAN CONTAINER that
-- fn_add_plan_operation_multi still requires a plan_id for. Mirrors fn_create_plan's authz.
-- Unaffected by the #562/#560 layering (independent RPC, no signature collision).
create or replace function public.fn_get_or_create_individual_treatment_plan(p_org uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_org is null then
    raise exception 'org is required' using errcode = '22023';
  end if;

  -- AUTHZ-2: plan.write, scoped to the org (same gate fn_create_plan enforces).
  if not public.authorize('plan.write', p_org) then
    raise exception 'forbidden: plan.write is required to log an individual-palm treatment'
      using errcode = '42501';
  end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and p_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org individual-treatment plan for org %', p_org
      using errcode = '42501';
  end if;

  select id into v_id
    from public.plans
    where org_id = p_org and is_individual_treatment_plan
    limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- Create-on-first-use. A concurrent double-click racing here hits the partial unique index;
  -- catch the violation and re-select the winner rather than erroring the caller.
  begin
    insert into public.plans (org_id, type, scope_type, scope_id, status, is_individual_treatment_plan)
    values (p_org, 'monthly', 'farm', null, 'active', true)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id
      from public.plans
      where org_id = p_org and is_individual_treatment_plan
      limit 1;
  end;

  return v_id;
end $$;

revoke all     on function public.fn_get_or_create_individual_treatment_plan(uuid) from public;
revoke execute on function public.fn_get_or_create_individual_treatment_plan(uuid) from anon;
grant  execute on function public.fn_get_or_create_individual_treatment_plan(uuid) to authenticated;

-- ── 3) fn_add_plan_operation_multi: FINAL COMBINED RE-EMIT — #562 (10-arg) + #560 (12-arg) + #563
-- (this migration, 15-arg). See the reconciliation header above for the full param list/origins.
--
-- DROP targets #560's 12-arg signature (the live function by the time this migration runs, given
-- the required apply order #562 → #560 → #563) — NOT the original 9-arg.
drop function if exists public.fn_add_plan_operation_multi(
  uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text, text, text);

create or replace function public.fn_add_plan_operation_multi(
  p_plan_id               uuid,
  p_subtype               text,
  p_planned_at            date,
  p_ends_on               date,
  p_est_cost              numeric,
  p_materials             jsonb,
  p_labor                 jsonb,
  p_assignee_ids          uuid[],
  p_lead_id               uuid,
  p_preferred_time_of_day text default null,  -- PR #562 (spray-compliance-record)
  p_irrigation_basis      text default null,  -- PR #560 (soil-test-irrigation-and-templates)
  p_soil_moisture_reading text default null,  -- PR #560 (soil-test-irrigation-and-templates)
  p_target_type           text default null,  -- PR #563 (individual-palm-treatment, this branch)
  p_target_id             uuid default null,  -- PR #563 (individual-palm-treatment, this branch)
  p_note                  text default null)  -- PR #563 (individual-palm-treatment, this branch)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org          uuid;
  v_scope_type   text;
  v_scope_id     uuid;
  v_op_id        uuid;
  v_mat          jsonb;
  v_lab          jsonb;
  v_pid          uuid;
  v_dup          uuid;
  v_n_mat        int := 0;
  v_n_lab        int := 0;
  v_n_asg        int := 0;
  v_target_type  text;
  v_target_id    uuid;
  v_zone         text;
  v_applicator   uuid;
begin
  select pl.org_id, pl.scope_type, pl.scope_id
    into v_org, v_scope_type, v_scope_id
    from public.plans pl
    where pl.id = p_plan_id;
  if v_org is null then
    raise exception 'plan % not found', p_plan_id using errcode = 'P0002';
  end if;

  -- AUTHZ-2 (#181): plan.write, scoped to the plan's org.
  if not public.authorize('plan.write', v_org) then
    raise exception 'forbidden: plan.write is required to author a plan operation'
      using errcode = '42501';
  end if;
  -- org guard: anon rejected; authenticated caller's plan must be in one of their orgs.
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org plan operation on plan %', p_plan_id
      using errcode = '42501';
  end if;

  -- multi-day validity (the 0090 CHECK also enforces this; validate early for a clean 22023).
  if p_ends_on is not null and p_planned_at is not null and p_ends_on < p_planned_at then
    raise exception 'ends_on % precedes planned_at %', p_ends_on, p_planned_at using errcode = '22023';
  end if;
  -- a named lead must be one of the assignees.
  if p_lead_id is not null and (p_assignee_ids is null or not (p_lead_id = any (p_assignee_ids))) then
    raise exception 'lead % must be one of the assignees', p_lead_id using errcode = '22023';
  end if;
  -- preferred_time_of_day: same closed vocabulary as the table CHECK (clean 22023, not raw 23514).
  -- [PR #562]
  if p_preferred_time_of_day is not null
     and p_preferred_time_of_day not in ('morning','midday','late_afternoon','evening') then
    raise exception 'preferred_time_of_day % is not a recognised value', p_preferred_time_of_day
      using errcode = '22023';
  end if;
  -- irrigation-basis vocabulary (the table CHECK also enforces this; validate early for a clean
  -- 22023). [PR #560]
  if p_irrigation_basis is not null and p_irrigation_basis not in ('fixed_schedule', 'soil_test') then
    raise exception 'invalid irrigation_basis %', p_irrigation_basis using errcode = '22023';
  end if;

  -- Palm-target override: validate BOTH-or-neither and that the palm belongs to this plan's org.
  -- A cross-org or non-palm target_id is rejected loudly (22023) rather than silently ignored —
  -- an ignored bad target would otherwise fall back to the plan's own scope, misattributing the
  -- treatment to the wrong tree without any error. [PR #563]
  if p_target_type is not null or p_target_id is not null then
    if p_target_type is distinct from 'palm' or p_target_id is null then
      raise exception 'target_type/target_id must both be set, with target_type = ''palm'''
        using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.assets a
      where a.id = p_target_id and a.org_id = v_org and a.type = 'palm'
    ) then
      raise exception 'target palm % is not in org %', p_target_id, v_org using errcode = '22023';
    end if;
    v_target_type := 'palm';
    v_target_id := p_target_id;
  else
    v_target_type := coalesce(v_scope_type, 'sector');
    v_target_id := v_scope_id;
  end if;

  -- CREATE-2 dedup (preserved from 0038; #399 review; #563 added the target columns to the natural
  -- key so a palm-scoped op and a plan-scoped op on the same subtype/date don't collide/dedup into
  -- each other). Find-or-create on the natural key: if such an op already exists, return it as
  -- deduped — no duplicate op/lines/assignees.
  select po.id into v_dup from public.plan_operations po
    where po.plan_id = p_plan_id and po.subtype = p_subtype
      and po.planned_at is not distinct from p_planned_at
      and po.target_type is not distinct from v_target_type
      and po.target_id is not distinct from v_target_id
    limit 1;
  if v_dup is not null then
    return jsonb_build_object('operationId', v_dup, 'deduped', true, 'materials', 0, 'labor', 0, 'assignees', 0);
  end if;

  insert into public.plan_operations (org_id, plan_id, subtype, target_type, target_id, planned_at,
                                      ends_on, priority, responsible_person_id, est_cost, approval_needed,
                                      status, preferred_time_of_day, irrigation_basis, soil_moisture_reading,
                                      note)
  values (v_org, p_plan_id, p_subtype, v_target_type, v_target_id, p_planned_at,
          p_ends_on, 1, p_lead_id, p_est_cost, true, 'planned',
          p_preferred_time_of_day, p_irrigation_basis, p_soil_moisture_reading,
          nullif(btrim(p_note), ''))
  returning id into v_op_id;

  -- materials: each item must be in the plan's org; qty non-negative; optional compliance fields
  -- (from PR #562 — carried forward verbatim, including its validation of target_zone/applicator).
  for v_mat in select * from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb)) loop
    if not exists (select 1 from public.inventory_items it
                   where it.id = (v_mat->>'item_id')::uuid and it.org_id = v_org) then
      raise exception 'material item % is not in org %', v_mat->>'item_id', v_org using errcode = '22023';
    end if;
    if coalesce((v_mat->>'qty')::numeric, 0) < 0 then
      raise exception 'material qty must be non-negative' using errcode = '22023';
    end if;

    v_zone := nullif(v_mat->>'target_zone', '');
    if v_zone is not null and v_zone not in ('bunch','crown','trunk','offshoot','whole_palm') then
      raise exception 'target_zone % is not a recognised zone', v_zone using errcode = '22023';
    end if;

    v_applicator := nullif(v_mat->>'applicator_person_id', '')::uuid;
    if v_applicator is not null and not exists (
         select 1 from public.people pe where pe.id = v_applicator and pe.org_id = v_org and pe.active) then
      raise exception 'applicator % is not an active member of org %', v_applicator, v_org using errcode = '22023';
    end if;

    -- unit: null when omitted/blank → the trg_pmr_unit_reconcile trigger (migration 20260701170000)
    -- defaults it to the item's canonical unit and rejects a real mismatch. See the reconciliation
    -- note at the top of this file: restores main's `nullif` behaviour (both #562's and #560's
    -- pre-reconciliation drafts had regressed to `coalesce(..., 'kg')`; this branch (#563) already
    -- had it correct and that correctness is what's carried into this combined function).
    insert into public.plan_material_requirements (
      org_id, plan_op_id, item_id, qty, unit,
      target_pest, apc_registration_ref, rei_hours, phi_days, target_zone,
      applicator_person_id, wind_speed_kmh, wind_direction, air_temp_c)
    values (
      v_org, v_op_id, (v_mat->>'item_id')::uuid, (v_mat->>'qty')::numeric, nullif(v_mat->>'unit', ''),
      nullif(v_mat->>'target_pest', ''), nullif(v_mat->>'apc_registration_ref', ''),
      (v_mat->>'rei_hours')::numeric, (v_mat->>'phi_days')::numeric, v_zone,
      v_applicator, (v_mat->>'wind_speed_kmh')::numeric, nullif(v_mat->>'wind_direction', ''),
      (v_mat->>'air_temp_c')::numeric);
    v_n_mat := v_n_mat + 1;
  end loop;

  -- labour: non-negative count/days.
  for v_lab in select * from jsonb_array_elements(coalesce(p_labor, '[]'::jsonb)) loop
    if coalesce((v_lab->>'count')::int, 0) < 0 or coalesce((v_lab->>'days')::numeric, 0) < 0 then
      raise exception 'labour count/days must be non-negative' using errcode = '22023';
    end if;
    insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days)
    values (v_org, v_op_id, v_lab->>'person_or_team', (v_lab->>'count')::int, (v_lab->>'days')::numeric);
    v_n_lab := v_n_lab + 1;
  end loop;

  -- assignees: each person must be an ACTIVE member of the plan's org.
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

-- The parameter list changed again (3 new trailing defaulted args vs #560's 12-arg), so this is a
-- NEW overload as far as Postgres identity is concerned unless the predecessor signature is dropped
-- (done above). Re-grant explicitly under the final 15-arg signature.
revoke all     on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text, text, text, text, uuid, text) from public;
revoke execute on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text, text, text, text, uuid, text) from anon;
grant  execute on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text, text, text, text, uuid, text) to authenticated;
