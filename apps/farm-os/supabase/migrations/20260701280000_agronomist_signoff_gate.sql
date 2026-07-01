-- Farm OS — agronomist sign-off GATE MECHANISM (docs/CLAUDE.md non-negotiable #4).
--
-- PROBLEM (independent review, 2026-07-01): dose-bearing operations (fertilization/spraying, authored
-- via OperationBuilder.tsx → fn_add_plan_operation_multi) carry NO sign-off distinction at all. Any
-- plan.write user (owner/farm_manager) authors a dose (NPK rate, pesticide qty) and it is immediately
-- treated as authoritative — it feeds fn_stock_coverage's demand, shows in plan_checks, and is eligible
-- for fn_execute_operation — with nothing distinguishing "someone's draft template" from "an
-- agronomist-reviewed, ready-to-execute plan". Non-negotiable #4 requires a named agronomist +
-- current Egyptian pesticide-registration sign-off before agronomy content is authoritative.
--
-- SCOPE — THIS PR BUILDS THE GENERIC MECHANISM ONLY, NOT A NAMED-PERSON ASSIGNMENT:
--   1. signed_off_by/signed_off_at columns on plan_operations (nullable pair — both null = pending).
--   2. A new permission `agronomy.signoff`, added to authorize()'s union. WHO holds it is a REASONABLE
--      DEFAULT for now (owner + agri_engineer — the closest existing role to "the person who would
--      realistically review an agronomy decision"), NOT the Owner's final word — no "named agronomist"
--      role/person concept exists yet in this system. The Owner may restrict this to a specific named
--      person via a follow-up migration once that decision is made (see docs/SPEC-0019-operations.md §5
--      D3 if present on a later checkout — it is not merged as of this migration).
--   3. fn_sign_off_plan_operation(p_op_id) — SECURITY DEFINER RPC gated on agronomy.signoff, stamps
--      signed_off_by/at from the caller's session (never client-supplied values). Claim-first: the
--      final UPDATE only fires while signed_off_by IS NULL (mirrors fn_execute_operation's claim-first
--      guard), so a SECOND call on an already-signed-off op cannot silently re-stamp a new caller's
--      identity/timestamp over the existing one — it raises 22023 instead (independent review finding,
--      2026-07-01: a silent re-stamp would weaken exactly the audit trail this gate exists to protect).
--   4. A defense-in-depth guard trigger mirroring pr_guard_approval (migration 0017): a direct-REST
--      write to plan_operations that SETS signed_off_by/at to a non-null value must also come from an
--      agronomy.signoff holder — otherwise a plan.write farm_manager could spoof sign-off directly via
--      PostgREST, bypassing the RPC's gate entirely and defeating the whole point of this mechanism.
--      Clearing (setting NULL, the SAFE direction — same "over-order is safe" bias as the engine) is
--      NOT extra-gated; plan.write via the existing tenant_all policy already covers it.
--   5. An "un-sign on edit" trigger: any insert/update/delete on plan_material_requirements for a
--      signed-off op clears its sign-off (the materials changed since a human approved them, so the
--      approval no longer applies to the current content). Kept intentionally simple — it does not try
--      to diff whether the edit was material (e.g. qty unchanged) to avoid over-engineering; any touch
--      clears it.
--
-- DELIBERATELY NOT DONE (follow-up, once the Owner has named a real agronomist / decided the gate
-- semantics): fn_execute_operation and fn_stock_coverage are UNCHANGED — signed_off_by/at is a VISIBLE,
-- SETTABLE state in this PR, not an enforcement gate on execution or engine demand. Wiring the gate into
-- execute/engine is a bigger, riskier behavior change that belongs in its own reviewed PR.
--
-- Security: RPC is SECURITY DEFINER, search_path pinned, EXECUTE revoked from public/anon, granted to
-- authenticated only (mirrors every other write RPC in this repo). authorize() is RE-EMITTED CARRYING
-- THE FULL EXISTING UNION (14 perms as of migration 20260629150000) PLUS agronomy.signoff — see the
-- authorize() re-emit footgun note in docs/CLAUDE.md / test 97: a re-emit from an OLDER base silently
-- drops permissions added by intervening migrations, so this is re-emitted from the CURRENT (latest)
-- definition, not an earlier one.
--
-- DRAFT migration — never applied by this session. Validate with test-shims/run-pgtap-local.sh.
-- Owner-gated: migrate-first-then-merge (this repo's Vercel deploy auto-builds off `main`).

begin;

-- ── 1) plan_operations.signed_off_by / signed_off_at — nullable pair; both null = pending sign-off ──
alter table public.plan_operations
  add column signed_off_by uuid references public.people(id),
  add column signed_off_at timestamptz;

-- FK-index convention (migration 0036): cover the FK column used by joins.
create index if not exists plan_operations_signed_off_by_idx
  on public.plan_operations(signed_off_by);

-- ── 2) tenant_all on plan_operations — re-emit VERBATIM from the latest definition (migration 0070)
-- PLUS a same-org check on signed_off_by (mirrors the existing responsible_person_id/plan_id clauses).
-- This is a defense-in-depth cross-org guard for DIRECT REST writes only — the legitimate write paths
-- (fn_add_plan_operation*, fn_sign_off_plan_operation below) are SECURITY DEFINER and validate
-- same-org membership explicitly in their own bodies.
drop policy if exists tenant_all on public.plan_operations;
create policy tenant_all on public.plan_operations for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('plan.write', org_id)
    and (plan_operations.responsible_person_id is null
         or exists (select 1 from public.people pe where pe.id = plan_operations.responsible_person_id and pe.org_id = plan_operations.org_id))
    and (plan_operations.plan_id is null
         or exists (select 1 from public.plans p where p.id = plan_operations.plan_id and p.org_id = plan_operations.org_id))
    and (plan_operations.signed_off_by is null
         or exists (select 1 from public.people pe where pe.id = plan_operations.signed_off_by and pe.org_id = plan_operations.org_id))
  );

-- ── 3) authorize(): re-emit pinning the current union (0629150000, 14 perms) + agronomy.signoff. ──
-- agronomy.signoff = owner + agri_engineer. This is a REASONABLE DEFAULT (closest existing role to a
-- real agronomist), NOT a final Owner decision on sign-off authority — see header note above.
create or replace function public.authorize(perm text, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_member m
    where m.user_id = (select auth.uid())
      and m.org_id = p_org
      and ( (perm = 'pr.approve'             and m.role = 'owner')
         or (perm = 'plan.write'             and m.role in ('owner','farm_manager'))
         or (perm = 'op.execute'             and m.role in ('owner','farm_manager','agri_engineer','supervisor'))
         or (perm = 'inventory.write'        and m.role in ('owner','farm_manager','storekeeper'))
         or (perm = 'budget.write'           and m.role in ('owner','accountant'))
         or (perm = 'payroll.read'           and m.role in ('owner','accountant'))
         or (perm = 'structure.write'        and m.role in ('owner','farm_manager'))
         or (perm = 'academy.write'          and m.role in ('owner','agri_engineer'))   -- in-flight #366 (forward-compat)
         or (perm = 'export.write'           and m.role in ('owner','farm_manager'))     -- in-flight #400 (forward-compat)
         or (perm = 'responsibility.write'   and m.role in ('owner','farm_manager'))     -- in-flight #444 (forward-compat)
         or (perm = 'finance.read'           and m.role in ('owner','accountant'))        -- SPEC-0018 confidential finance reads
         or (perm = 'custody.write'          and m.role in ('owner','accountant'))        -- SPEC-0018 finance-only custody writes
         or (perm = 'request.prepare'        and m.role in ('owner','accountant'))        -- SPEC-0018 finance-only payment prep
         or (perm = 'request.approve.op'     and m.role in ('owner','accountant'))        -- SPEC-0018 finance approval
         or (perm = 'request.approve.final'  and m.role = 'owner')                       -- SPEC-0018 owner final approval
         or (perm = 'agronomy.signoff'       and m.role in ('owner','agri_engineer')) )   -- non-negotiable #4 sign-off gate (REASONABLE DEFAULT — not the Owner's final word, see header)
  )
$$;
revoke execute on function public.authorize(text, uuid) from public, anon, authenticated;
grant  execute on function public.authorize(text, uuid) to anon, authenticated;  -- RLS helper (anon needed for policy eval)

-- ── 4) fn_sign_off_plan_operation — the sign-off RPC ──────────────────────────────────────────────
-- Stamps signed_off_by (the CALLER's linked person in the op's org) + signed_off_at (now()) from the
-- session, never from client-supplied values. Org-scoped (mirrors fn_add_plan_operation_multi): the
-- op's org is resolved first, authorize('agronomy.signoff', org) is checked against it, then a
-- same-org membership guard rejects a cross-org caller even if the JWT is otherwise valid.
create or replace function public.fn_sign_off_plan_operation(p_op_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org       uuid;
  v_person_id uuid;
  v_now       timestamptz := now();
  v_claimed   int;
begin
  select po.org_id into v_org from public.plan_operations po where po.id = p_op_id;
  if v_org is null then
    raise exception 'operation % not found', p_op_id using errcode = 'P0002';
  end if;

  if not public.authorize('agronomy.signoff', v_org) then
    raise exception 'forbidden: agronomy.signoff is required to sign off a plan operation'
      using errcode = '42501';
  end if;
  -- org guard: anon rejected; authenticated caller's op must be in one of their orgs (mirrors 0093).
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org sign-off on operation %', p_op_id using errcode = '42501';
  end if;

  select pe.id into v_person_id
    from public.people pe
   where pe.user_id = (select auth.uid())
     and pe.org_id = v_org
   limit 1;
  if v_person_id is null then
    raise exception 'no person record linked to the current user in org %', v_org using errcode = 'P0001';
  end if;

  -- claim-first (mirrors fn_execute_operation's EXE-1 guard): only stamp while still pending, so a
  -- second sign-off call on an already-signed-off op cannot silently overwrite the FIRST signer's
  -- identity/timestamp — that would weaken exactly the audit trail this gate exists to protect.
  update public.plan_operations
     set signed_off_by = v_person_id, signed_off_at = v_now
   where id = p_op_id and org_id = v_org and signed_off_by is null;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    raise exception 'operation % is already signed off', p_op_id using errcode = '22023';
  end if;

  return jsonb_build_object('operationId', p_op_id, 'signedOffBy', v_person_id, 'signedOffAt', v_now);
end $$;

revoke all     on function public.fn_sign_off_plan_operation(uuid) from public;
revoke execute on function public.fn_sign_off_plan_operation(uuid) from anon;
grant  execute on function public.fn_sign_off_plan_operation(uuid) to authenticated;

-- ── 5) direct-REST spoofing guard (mirrors pr_guard_approval, migration 0017) ─────────────────────
-- RLS WITH CHECK cannot compare OLD vs NEW values, so a plan.write user could otherwise set
-- signed_off_by/at directly (INSERT or UPDATE via PostgREST) without ever holding agronomy.signoff —
-- silently defeating the gate at the exact moment it matters. This BEFORE trigger re-asserts the
-- permission whenever a statement is about to leave the row with a non-null signed_off_by/at that
-- differs from what it already was (or is a fresh INSERT carrying one). Clearing to NULL is always the
-- safe direction and is left to the existing plan.write gate.
create or replace function public.fn_guard_plan_op_signoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if (new.signed_off_by is not null or new.signed_off_at is not null)
     and (tg_op = 'INSERT'
          or new.signed_off_by is distinct from old.signed_off_by
          or new.signed_off_at is distinct from old.signed_off_at)
     and not public.authorize('agronomy.signoff', new.org_id)
  then
    raise exception 'forbidden: agronomy.signoff is required to sign off a plan operation'
      using errcode = '42501';
  end if;
  return new;
end
$fn$;

-- Trigger fns are invoked internally by Postgres, never called directly — hold NO client EXECUTE
-- (mirrors fn_audit/pr_guard_approval; INV-2 in test 22 pins this generically). New functions default
-- to PUBLIC EXECUTE, so this must be revoked explicitly.
revoke all on function public.fn_guard_plan_op_signoff() from public, anon, authenticated;

drop trigger if exists plan_op_signoff_guard on public.plan_operations;
create trigger plan_op_signoff_guard
  before insert or update on public.plan_operations
  for each row execute function public.fn_guard_plan_op_signoff();

-- ── 6) un-sign on material edit ────────────────────────────────────────────────────────────────────
-- Any insert/update/delete on plan_material_requirements for a signed-off op clears its sign-off — the
-- materials changed since a human approved them. Deliberately simple (any touch clears it; no attempt
-- to diff whether qty/item actually changed) — a richer "only clear on a material change" rule is a
-- deferred follow-up if it turns out to matter in practice.
create or replace function public.fn_clear_plan_op_signoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_op_id uuid;
begin
  v_op_id := coalesce(new.plan_op_id, old.plan_op_id);
  update public.plan_operations
     set signed_off_by = null, signed_off_at = null
   where id = v_op_id
     and (signed_off_by is not null or signed_off_at is not null);
  return coalesce(new, old);
end
$fn$;

-- Same trigger-fn EXECUTE lockdown as fn_guard_plan_op_signoff above.
revoke all on function public.fn_clear_plan_op_signoff() from public, anon, authenticated;

drop trigger if exists plan_material_req_clear_signoff on public.plan_material_requirements;
create trigger plan_material_req_clear_signoff
  after insert or update or delete on public.plan_material_requirements
  for each row execute function public.fn_clear_plan_op_signoff();

commit;
