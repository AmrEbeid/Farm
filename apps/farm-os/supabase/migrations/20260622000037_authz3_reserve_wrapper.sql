-- Farm OS MVP-0 — AUTHZ-3 (#182 / SPEC-0002 §8b): make fn_post_movement an INTERNAL primitive and
-- route the one direct app caller (reserveStock) through a role-gated wrapper.
--
-- THE BUG. public.fn_post_movement is SECURITY DEFINER + `grant execute to authenticated` (migration
-- 0033) with only an ORG guard — no ROLE gate. So ANY authenticated org member can
-- POST /rest/v1/rpc/fn_post_movement and move their own org's stock (issue/reserve/adjust/…), even a
-- read-only role like accountant or agri_engineer. The org guard stops cross-org abuse but not
-- in-org privilege escalation past the inventory.write RBAC line.
--
-- THE FIX (SPEC-0002 §8b). Do NOT add `inventory.write` INSIDE fn_post_movement: the legitimate
-- definer callers post on roles that intentionally LACK inventory.write — fn_execute_operation posts
-- issue/release under op.execute (supervisor/agri_engineer), and that must keep working. Instead:
--   (1) REVOKE EXECUTE on fn_post_movement from `authenticated`, turning it into an internal
--       primitive callable ONLY in a SECURITY DEFINER / owner context. The existing definer callers
--       (fn_execute_operation, fn_post_receipt, and the new fn_reserve_stock) keep working because an
--       INTERNAL call checks EXECUTE against the function's OWNER, not the caller. (Do NOT revoke from
--       the owner.)
--   (2) Add a thin, role-gated wrapper fn_reserve_stock(p_item, p_qty, p_plan_id) — the ONE direct
--       app entry point (coverage/actions.ts reserveStock) — that enforces `inventory.write` (the
--       correct gate for a client-initiated reserve) and then delegates to the internal primitive.
--
-- AUTHZ-2 (#181, migration 0035): `authorize` is now the 2-arg org-scoped overload
-- authorize(perm text, p_org uuid). Used in the 2-arg form here.
--
-- ADR-0006 conventions: SECURITY DEFINER + `set search_path = ''`; fully schema-qualified; auth.uid()/
-- auth.role() wrapped in (select …) so the planner caches them; create-or-replace.

-- ── 1) The gated reserve wrapper — the ONLY client-facing reserve entry point ───────────────────────
create or replace function public.fn_reserve_stock(
  p_item    uuid,
  p_qty     numeric,
  p_plan_id uuid)
returns numeric            -- the recomputed on_hand (unchanged by a reserve), via fn_post_movement
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  -- Resolve the owning org from the item (authoritative), then the bin as a fallback — mirrors
  -- fn_post_movement's resolution so the gate is evaluated against the SAME org the primitive will use.
  select org_id into v_org from public.inventory_items where id = p_item;
  if v_org is null then
    select org_id into v_org from public.inventory_bin where item_id = p_item and location = 'main';
  end if;
  if v_org is null then
    raise exception 'unknown inventory item %', p_item using errcode = 'P0002';
  end if;

  -- AUTHZ-3 (#182): reserving stock is an inventory.write action (owner/farm_manager/storekeeper),
  -- SCOPED TO THE ITEM'S ORG. authorize() reads auth.uid() from the JWT GUC, which SECURITY DEFINER
  -- does NOT change, so it evaluates the *caller's* permission in v_org even though the body runs as
  -- the definer. This is the role gate fn_post_movement deliberately lacks.
  if not public.authorize('inventory.write', v_org) then
    raise exception 'forbidden: inventory.write is required to reserve stock'
      using errcode = '42501';
  end if;

  -- Org / anon guard, consistent with fn_post_movement: anon is never trusted; a JWT user must belong
  -- to the item's org. The null-uid path is the trusted service/superuser context only.
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org reserve on item %', p_item using errcode = '42501';
  end if;

  -- Delegate to the internal primitive. INTERNAL call → EXECUTE is checked against THIS function's
  -- OWNER (which retains EXECUTE), so the revoke in step 2 does not break this path. Positional args
  -- match fn_post_movement(p_item,p_type,p_qty,p_location,p_unit,p_unit_cost,p_event_id,p_plan_id,
  -- p_supplier_id[,p_occurred_at]) exactly (signature confirmed against migration 0033).
  return public.fn_post_movement(p_item, 'reserve', p_qty, 'main', 'kg', null, null, p_plan_id, null);
end $$;

revoke all     on function public.fn_reserve_stock(uuid, numeric, uuid) from public;
revoke execute on function public.fn_reserve_stock(uuid, numeric, uuid) from anon;
grant  execute on function public.fn_reserve_stock(uuid, numeric, uuid) to authenticated;

-- ── 2) Make fn_post_movement INTERNAL: revoke the direct client grant ───────────────────────────────
-- After this, `authenticated` (and PUBLIC, already revoked in 0033) cannot POST /rest/v1/rpc/
-- fn_post_movement. The SECURITY DEFINER callers (fn_execute_operation, fn_post_receipt,
-- fn_reserve_stock) still reach it because an internal call checks EXECUTE against the function OWNER,
-- not the caller. anon was never granted. We do NOT touch the OWNER's privilege.
revoke execute on function
  public.fn_post_movement(uuid, text, numeric, text, text, numeric, uuid, uuid, uuid, timestamptz)
  from authenticated;
