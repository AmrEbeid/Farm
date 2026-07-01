-- Farm OS — spray/pesticide-application COMPLIANCE RECORD-KEEPING fields (docs/CLAUDE.md #4).
--
-- SCOPE (complementary to feat/agronomist-signoff-gate, #557 — NOT yet merged as of this migration):
-- #557 built the GENERIC sign-off gate mechanism (signed_off_by/signed_off_at on plan_operations,
-- agronomy.signoff permission) — i.e. WHETHER a dose has been reviewed. This migration is a SEPARATE
-- concern: it adds the actual REGULATORY RECORD-KEEPING FIELDS a real pesticide-application record
-- needs (product identity, REI/PHI, target zone/pest, application conditions), independent of whether
-- sign-off exists yet. The two migrations touch disjoint columns and do not conflict.
--
-- REAL-WORLD GROUNDING (Owner-shared farm reports this session): spray instructions in practice specify
-- (a) a TIME-OF-DAY constraint — "only spray at day's end once the heat breaks, to avoid fruit
-- deformity" — not just a date, and (b) a specific TARGET ZONE on the palm — "drench the bunch-stalks
-- and palm crown," "spray the bunches only" — not just "the palm" generically. Neither existed anywhere
-- in the schema before this migration.
--
-- REGULATORY FIELD SET (EPA WPS + AMS recordkeeping + GlobalGAP PSA, researched earlier this session):
-- product identity + registration ref, active ingredient (deferred — no product catalog exists yet, see
-- below), target pest, REI (re-entry interval) + PHI (pre-harvest interval), target zone, applicator,
-- and application-time conditions (wind speed/direction, air temperature).
--
-- SCHEMA-PLACEMENT DECISION: per-material (on plan_material_requirements), NOT a new dedicated table.
-- REI/PHI/target-pest/APC-ref are properties of the PRODUCT BEING APPLIED, and a spray operation's
-- material lines already model "which product(s), what quantity" (fn_add_plan_operation_multi, #398/
-- #520 — an op can carry N materials). A dedicated table would need its own FK back to
-- plan_material_requirements (or plan_operations, losing per-product granularity when 2 products are
-- co-applied) AND its own RLS policy set for zero added benefit — these are just MORE COLUMNS on
-- a row that already represents "this product, on this operation, in this quantity." Extending the
-- existing row keeps one place to look, avoids a second RLS surface, and reuses the tenant_all(
-- plan.write) gate already governing this table (0042/#235) — additive nullable columns need no new
-- gate. wind/air conditions are captured at EXECUTE time (not authored at plan time) but are still
-- properties of "how THIS product was actually applied," so they live on the same per-material row
-- rather than a parallel per-operation table — this keeps a future "capture actuals" follow-up (once
-- #545 lands) a single UPDATE per material row, not a join across two new tables.
--
-- applicator_person_id is nullable + FK to people(id): who actually applied the product (may differ
-- from plan_operations.responsible_person_id, which is the op's overall lead/owner).
--
-- target_zone is CHECK-constrained (bunch/crown/trunk/offshoot/whole_palm) — a small closed vocabulary
-- so it's queryable/reportable, not free text (unlike target_pest/apc_registration_ref, which stay free
-- text: no real APC pesticide-registration catalog exists in this codebase yet — #4's non-negotiable
-- explicitly forbids fabricating one; this migration captures what the user enters, nothing more).
--
-- preferred_time_of_day lives on plan_operations (not plan_material_requirements) because it is a
-- SCHEDULING preference for the whole operation/visit ("only spray once the heat breaks"), not a
-- per-product property — distinct from the operation's actual execution timestamp (farm_event.
-- occurred_at), which already exists and is set at execute time, not authored at plan time.
--
-- NON-NEGOTIABLE #1 (never fabricate data): every column here is nullable; the app must render "N/A"
-- for unset REI/PHI, never a guessed value. REI/PHI enforcement in this PR is DISPLAY-ONLY decision
-- support (a warning banner), never an automated block on harvest/re-entry — matches this repo's
-- existing "compliance ≠ auto-certify" posture (see docs/SPEC-0016-export-compliance-and-certification.
-- md). Automated enforcement (e.g. blocking a harvest op inside the PHI window) is explicitly DEFERRED
-- — a bigger, riskier follow-up requiring its own reviewed PR and product decision.
--
-- DELIBERATELY NOT DONE this migration (see PR description for full rationale):
--   * fn_execute_operation is UNCHANGED — PR #545 (fix/execute-multi-material) is still OPEN and
--     actively changing that RPC's signature/body this session; touching it here would fight that PR.
--     Capturing wind/temp/applicator AT EXECUTE TIME is therefore deferred to a follow-up once #545
--     has landed and the execute contract is stable — this migration only adds the COLUMNS (nullable,
--     unused by any RPC yet) so that follow-up is a pure app-layer change, no new migration required.
--   * fn_add_plan_operation_multi (0093) IS extended below (planning-time authoring only) — distinct
--     RPC from fn_execute_operation, not touched by #545, safe to extend in this PR.
--
-- DRAFT migration — never applied by this session. Validate with test-shims/run-pgtap-local.sh.
-- Owner-gated: migrate-first-then-merge (this repo's Vercel deploy auto-builds off `main`).

begin;

-- ── 1) plan_material_requirements — per-product compliance fields ──────────────────────────────────
alter table public.plan_material_requirements
  add column target_pest          text,
  add column apc_registration_ref text,
  add column rei_hours            numeric,
  add column phi_days             numeric,
  add column target_zone          text
    check (target_zone is null or target_zone in ('bunch','crown','trunk','offshoot','whole_palm')),
  add column applicator_person_id uuid references public.people(id),
  add column wind_speed_kmh       numeric,
  add column wind_direction       text,
  add column air_temp_c           numeric;

-- Non-negativity (mirrors 0054's rationale: a negative REI/PHI/wind-speed is nonsensical and could
-- under-state a compliance window rather than just being a data-entry error worth rejecting).
alter table public.plan_material_requirements
  add constraint plan_material_requirements_rei_hours_nonneg check (rei_hours >= 0),
  add constraint plan_material_requirements_phi_days_nonneg  check (phi_days >= 0),
  add constraint plan_material_requirements_wind_speed_nonneg check (wind_speed_kmh >= 0);

-- FK-index convention (migration 0036): cover the new FK column used by joins.
create index if not exists plan_material_requirements_applicator_idx
  on public.plan_material_requirements(applicator_person_id);

-- ── 2) plan_operations.preferred_time_of_day — planning-time scheduling preference ─────────────────
alter table public.plan_operations
  add column preferred_time_of_day text
    check (preferred_time_of_day is null
           or preferred_time_of_day in ('morning','midday','late_afternoon','evening'));

-- ── 3) tenant_all on plan_material_requirements — RE-EMIT FROM THE CURRENT DEFINITION (0061, NOT 0042)
-- plus an org-guard on the new applicator_person_id FK. No new PERMISSION gate needed (these are
-- additive nullable columns on an existing row, not a new access surface) — but this re-emit MUST carry
-- forward every clause 0061 already added (item_id's item-org EXISTS, #235), or it silently DROPS that
-- protection — the exact "re-emit from an older base" footgun documented in docs/CLAUDE.md /
-- authorize()'s history (test 97), here applying to a row-security policy instead. Re-emitting from an
-- earlier base (0042) was caught by tests 62/74 in local validation; this is the corrected re-emit.
-- The new applicator_person_id FK is guarded the same way (same-org EXISTS on people), so test 74's
-- "every member-writable cross-org FK is RLS-validated" invariant stays green without adding it to the
-- exempt list.
drop policy if exists tenant_all on public.plan_material_requirements;
create policy tenant_all on public.plan_material_requirements for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('plan.write', org_id)
    and exists (select 1 from public.plan_operations po
                where po.id = plan_material_requirements.plan_op_id and po.org_id = plan_material_requirements.org_id)
    and exists (select 1 from public.inventory_items it
                where it.id = plan_material_requirements.item_id and it.org_id = plan_material_requirements.org_id)
    and (plan_material_requirements.applicator_person_id is null
         or exists (select 1 from public.people pe
                     where pe.id = plan_material_requirements.applicator_person_id
                       and pe.org_id = plan_material_requirements.org_id))
  );

-- ── 4) fn_add_plan_operation_multi — extend the PLANNING-time authoring RPC (0093) to accept the new
-- per-material compliance fields plus preferred_time_of_day. p_materials is ALREADY a jsonb array (no
-- signature change needed for it): each element may now additionally carry target_pest/
-- apc_registration_ref/rei_hours/phi_days/target_zone/applicator_person_id/wind_speed_kmh/
-- wind_direction/air_temp_c, all optional (coalesced to NULL when absent, never fabricated —
-- non-negotiable #1). target_zone is validated against the same closed vocabulary as the table CHECK,
-- for a clean 22023 instead of a raw constraint-violation error. applicator_person_id, if supplied,
-- must be an active member of the plan's org (mirrors the assignee validation below it).
--
-- preferred_time_of_day IS a genuine new scalar parameter (plan_operations-level, not per-material) —
-- added as a NEW TRAILING parameter WITH A DEFAULT (`default null`), which is backward-compatible: the
-- one existing call site (addPlanOperationMulti, app/(app)/plans/[planId]/actions.ts) is updated in
-- this same PR to pass it, but Postgres would resolve a 9-arg call to this same overload unchanged if
-- one existed (it does not — single caller, confirmed by repo grep).
--
-- This RPC is DISTINCT from fn_execute_operation (untouched — see header) and is NOT part of PR #545's
-- in-flight signature change, so extending it here is safe.
--
-- Adding a parameter changes the function's identity (Postgres resolves overloads by name + parameter
-- TYPES) — `create or replace` alone would leave the old 9-arg version callable side-by-side (mirrors
-- the #520/#545 precedent for fn_execute_operation). Drop the superseded 9-arg overload explicitly.
drop function if exists public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid);

create or replace function public.fn_add_plan_operation_multi(
  p_plan_id              uuid,
  p_subtype              text,
  p_planned_at           date,
  p_ends_on              date,
  p_est_cost             numeric,
  p_materials            jsonb,
  p_labor                jsonb,
  p_assignee_ids         uuid[],
  p_lead_id              uuid,
  p_preferred_time_of_day text default null)
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
  v_zone       text;
  v_applicator uuid;
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
  if p_preferred_time_of_day is not null
     and p_preferred_time_of_day not in ('morning','midday','late_afternoon','evening') then
    raise exception 'preferred_time_of_day % is not a recognised value', p_preferred_time_of_day
      using errcode = '22023';
  end if;

  -- CREATE-2 dedup (preserved from 0038; #399 review): a double-submit / network retry that committed
  -- server-side but failed to return would otherwise create a DUPLICATE op that over-counts the budget
  -- while its lines duplicate the demand. Find-or-create on the natural key (plan + subtype +
  -- planned_at): if such an op already exists, return it as deduped — no duplicate op/lines/assignees.
  select po.id into v_dup from public.plan_operations po
    where po.plan_id = p_plan_id and po.subtype = p_subtype
      and po.planned_at is not distinct from p_planned_at
    limit 1;
  if v_dup is not null then
    return jsonb_build_object('operationId', v_dup, 'deduped', true, 'materials', 0, 'labor', 0, 'assignees', 0);
  end if;

  insert into public.plan_operations (org_id, plan_id, subtype, target_type, target_id, planned_at,
                                      ends_on, priority, responsible_person_id, est_cost, approval_needed, status,
                                      preferred_time_of_day)
  values (v_org, p_plan_id, p_subtype, coalesce(v_scope_type, 'sector'), v_scope_id, p_planned_at,
          p_ends_on, 1, p_lead_id, p_est_cost, true, 'planned', p_preferred_time_of_day)
  returning id into v_op_id;

  -- materials: each item must be in the plan's org; qty non-negative; optional compliance fields.
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

    insert into public.plan_material_requirements (
      org_id, plan_op_id, item_id, qty, unit,
      target_pest, apc_registration_ref, rei_hours, phi_days, target_zone,
      applicator_person_id, wind_speed_kmh, wind_direction, air_temp_c)
    values (
      v_org, v_op_id, (v_mat->>'item_id')::uuid, (v_mat->>'qty')::numeric, coalesce(v_mat->>'unit', 'kg'),
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

revoke all     on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text) from public;
revoke execute on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text) from anon;
grant  execute on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text) to authenticated;

commit;
