-- Farm OS — SPEC-0019 P1-3 "جداول العمليات" (operation templates), instantiate-only slice.
--
-- THE GAP. Authoring a recurring operation program (fertigation split Mar/May/Aug, a 2-3 pass
-- pollination round, a ~6-month RPW preventive check) today means manually calling
-- fn_add_plan_operation_multi / OperationBuilder.tsx once PER dated occurrence. There is no way to
-- define the program once, as named/editable data, and instantiate it as several dated operations
-- in one action.
--
-- SCOPE (deliberately narrow — this migration ships the template TABLE + a seed set + the
-- INSTANTIATE RPC only; a template-authoring/editor UI is a follow-up, see the PR description):
--   1) plan_operation_templates — org-scoped, named, editable reference data (non-negotiable #4:
--      never fabricate/hide agronomy numbers behind app logic; a template is explicit rows a user
--      can inspect/edit later, not a hardcoded constant).
--   2) fn_instantiate_operation_template(plan, template, anchor_date) — for EACH occurrence in the
--      template's recurrence, calls the EXISTING fn_add_plan_operation_multi (0093/…170000) with
--      planned_at = anchor_date + offset_days. Reuses that RPC's validation/atomicity/dedup rather
--      than reimplementing operation-creation logic (non-negotiable per the task).
--
-- RECURRENCE SCHEMA (chosen design — jsonb array, one object per occurrence):
--   [ { "offset_days": int, "est_cost": numeric|null,
--       "materials": [{"item_id":uuid,"qty":numeric,"unit":text}, ...],
--       "labor":     [{"person_or_team":text,"count":int,"days":numeric}, ...] }, ... ]
-- planned_at for occurrence i = p_anchor_date + offset_days[i]. Chosen over a flatter "same
-- materials/labor repeated at every offset" shape because a real program's later passes sometimes
-- differ (e.g. a top-up rate, or a smaller pollination crew on pass 3) — per-occurrence lines cost
-- nothing extra to implement (fn_add_plan_operation_multi already takes materials/labor as jsonb
-- arrays; we just forward the occurrence's own arrays) and are still exactly as simple to seed with
-- identical lines when a program IS uniform (see the seed below). offset_days is relative to a
-- caller-chosen anchor date (the plan's period_start, a season start, etc.) — never a hardcoded
-- absolute date, so the same template works across seasons/plans.
--
-- THE DEDUP CONCERN (explicit, per the task brief): fn_add_plan_operation_multi finds-or-creates on
-- (plan_id, subtype, planned_at) — a FEATURE (SPEC "CREATE-2"), not a bug. Every occurrence in the
-- seeded templates below carries a DISTINCT offset_days, so a genuine instantiate produces genuinely
-- distinct planned_at values and N real operations. A SECOND instantiate call with the SAME anchor
-- date on the SAME plan hits that dedup on every occurrence and returns `deduped: true` for each —
-- fn_instantiate_operation_template surfaces this honestly (created vs deduped counts + the per-
-- occurrence detail) rather than papering over it as either a hard failure or a silent no-op.
--
-- ATOMICITY. fn_instantiate_operation_template does not open an explicit subtransaction/exception
-- block around the occurrence loop, so a Postgres function-call transaction rule applies directly:
-- an uncaught exception anywhere inside the loop (e.g. fn_add_plan_operation_multi rejecting a
-- cross-org material on occurrence 2) propagates out of this function and aborts the WHOLE
-- enclosing statement/transaction — occurrence 1's insert is rolled back too. All-or-nothing, with
-- no extra bookkeeping required.
--
-- Security: mirrors fn_add_plan_operation_multi exactly — SECURITY DEFINER, search_path pinned
-- empty, fully schema-qualified, org resolved from the plan, authorize('plan.write', org_id)
-- (AUTHZ-2 org-scoped overload), the anon/cross-org guard, EXECUTE locked to authenticated.
-- The template TABLE itself gets the SAME RLS shape as plan_operations/plan_material_requirements
-- (migrations 0025/0042): ENABLE + FORCE RLS, a single `tenant_all` policy with an org-only USING
-- (so any org member can read the available templates) and a WITH CHECK ANDing
-- authorize('plan.write', org_id) onto the org scope (so only owner/farm_manager can author/edit a
-- template directly). No FK to a vocabulary table for `subtype` — none exists yet as a separate
-- table (PR #543 / feat/operation-vocabulary is not merged into main); `subtype` is free text
-- matching the existing plan_operations.subtype convention, exactly as the task calls for.
--
-- Grants: new tables created after 20260629135038 (grant-hygiene default-privilege lockdown) get NO
-- default anon/authenticated privileges — this migration explicitly grants only what the app needs
-- (select/insert/update to authenticated; no delete/truncate, matching the current plans/
-- plan_operations posture after that same lockdown revoked DELETE everywhere except plan_checks).
--
-- Validation: pgTAP 112/113 (RLS+role-gating, instantiate correctness incl. dedup + cross-org) +
-- full harness; independent review requested (engine-adjacent: this feeds plan_material_requirements,
-- which fn_stock_coverage reads as demand — SPEC-0001 cardinal sin applies to any bad line here too,
-- though the actual quantity/atomicity logic is 100% delegated to the already-reviewed 0093/…170000
-- fn_add_plan_operation_multi, not reimplemented).

-- ── 1) plan_operation_templates ───────────────────────────────────────────────────────────────────
create table public.plan_operation_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  name text not null,
  subtype text not null,
  recurrence jsonb not null default '[]'::jsonb
    constraint plan_operation_templates_recurrence_is_array
    check (jsonb_typeof(recurrence) = 'array'),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index plan_operation_templates_org_idx on public.plan_operation_templates(org_id);
-- Named/editable data (task brief): a template's name should be unique within an org so the
-- instantiate picker never shows two indistinguishable entries.
create unique index plan_operation_templates_org_name_uniq
  on public.plan_operation_templates(org_id, name);

alter table public.plan_operation_templates enable row level security;
alter table public.plan_operation_templates force row level security;

drop policy if exists tenant_all on public.plan_operation_templates;
create policy tenant_all on public.plan_operation_templates for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('plan.write', org_id)
  );

-- New-table default privileges were locked down by 20260629135038 — grant explicitly.
-- No DELETE (matches the current plans/plan_operations posture; deletion is a follow-up if ever
-- needed). No anon grant at all (writes/reads for templates are org-member-only, like plans).
grant select, insert, update on public.plan_operation_templates to authenticated;

drop trigger if exists audit_plan_operation_template on public.plan_operation_templates;
create trigger audit_plan_operation_template
  after insert or update or delete on public.plan_operation_templates
  for each row execute function public.fn_audit('plan_operation_template');

-- ── 2) fn_instantiate_operation_template ─────────────────────────────────────────────────────────
create or replace function public.fn_instantiate_operation_template(
  p_plan_id     uuid,
  p_template_id uuid,
  p_anchor_date date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org        uuid;
  v_tpl_org    uuid;
  v_subtype    text;
  v_recurrence jsonb;
  v_occ        jsonb;
  v_planned_at date;
  v_res        jsonb;
  v_created    int := 0;
  v_deduped    int := 0;
  v_occurrences jsonb := '[]'::jsonb;
begin
  select pl.org_id into v_org from public.plans pl where pl.id = p_plan_id;
  if v_org is null then
    raise exception 'plan % not found', p_plan_id using errcode = 'P0002';
  end if;

  -- AUTHZ-2: plan.write, scoped to the plan's org (same gate fn_add_plan_operation_multi enforces;
  -- checked again here as defense-in-depth before we even touch the template row).
  if not public.authorize('plan.write', v_org) then
    raise exception 'forbidden: plan.write is required to instantiate an operation template'
      using errcode = '42501';
  end if;
  -- org guard: anon rejected; authenticated caller's plan must be in one of their orgs.
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org plan operation on plan %', p_plan_id
      using errcode = '42501';
  end if;

  if p_anchor_date is null then
    raise exception 'anchor date is required' using errcode = '22023';
  end if;

  select t.org_id, t.subtype, t.recurrence
    into v_tpl_org, v_subtype, v_recurrence
    from public.plan_operation_templates t
    where t.id = p_template_id;
  if v_tpl_org is null then
    raise exception 'template % not found', p_template_id using errcode = 'P0002';
  end if;
  -- explicit cross-org guard: a template belonging to a DIFFERENT org than the target plan must
  -- never be instantiated onto it, even though both individually passed their own org checks.
  if v_tpl_org <> v_org then
    raise exception 'forbidden: cross-org template % for plan %', p_template_id, p_plan_id
      using errcode = '42501';
  end if;

  -- One occurrence per recurrence entry. No explicit exception handler here on purpose: an
  -- uncaught error from fn_add_plan_operation_multi (bad material, cross-org item, …) propagates
  -- out of this loop/function and aborts the whole enclosing transaction — all-or-nothing.
  for v_occ in select * from jsonb_array_elements(v_recurrence) loop
    v_planned_at := p_anchor_date + coalesce((v_occ->>'offset_days')::int, 0);
    v_res := public.fn_add_plan_operation_multi(
      p_plan_id,
      v_subtype,
      v_planned_at,
      null, -- ends_on: templates model single-day occurrences (simplest correct shape for the
            -- seeded programs; a multi-day occurrence can still be authored manually afterwards).
      nullif(v_occ->>'est_cost', '')::numeric,
      coalesce(v_occ->'materials', '[]'::jsonb),
      coalesce(v_occ->'labor', '[]'::jsonb),
      null, -- assignee_ids: not templated (task scope) — assign after instantiation if needed.
      null);
    if coalesce((v_res->>'deduped')::boolean, false) then
      v_deduped := v_deduped + 1;
    else
      v_created := v_created + 1;
    end if;
    v_occurrences := v_occurrences || jsonb_build_object(
      'operationId', v_res->>'operationId',
      'plannedAt', v_planned_at,
      'deduped', coalesce((v_res->>'deduped')::boolean, false));
  end loop;

  return jsonb_build_object(
    'templateId', p_template_id,
    'created', v_created,
    'deduped', v_deduped,
    'occurrences', v_occurrences);
end $$;

revoke all     on function public.fn_instantiate_operation_template(uuid, uuid, date) from public;
revoke execute on function public.fn_instantiate_operation_template(uuid, uuid, date) from anon;
grant  execute on function public.fn_instantiate_operation_template(uuid, uuid, date) to authenticated;
