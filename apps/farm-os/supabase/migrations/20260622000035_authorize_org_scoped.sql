-- Farm OS MVP-0 — AUTHZ-2 (#181): org-scope the RBAC authorize() helper.
--
-- THE BUG. The original `public.authorize(perm text)` (migration 0001) checks only
--   exists(select 1 from organization_member m where m.user_id = auth.uid() and <role matches perm>)
-- with NO org predicate. So for a user who belongs to MULTIPLE orgs, the check passes as long as
-- the user holds the permitted role in ANY org. A user who is `owner` in org A but a low role in
-- org B therefore passes `authorize('pr.approve')` / `authorize('plan.write')` etc. for a write
-- SCOPED TO ORG B — every policy/RPC that gates a B-scoped write trusts a permission earned in A.
--
-- THE FIX. Add a mandatory-org overload `authorize(perm text, p_org uuid)` that ANDs
-- `m.org_id = p_org` into the membership lookup, and re-point every RLS policy / SECURITY DEFINER
-- RPC at it, passing the row's / resolved org_id as the second argument. Then DROP the 1-arg
-- function LAST, so any un-migrated caller fails closed (a missing function errors) rather than
-- silently using the unscoped check.
--
-- ADR-0006 conventions: SECURITY DEFINER + `set search_path = ''`; fully schema-qualified; auth.uid()
-- wrapped in (select …) so the planner caches it; create-or-replace functions; drop-then-create
-- policies/triggers. Each policy/RPC below is re-emitted VERBATIM from its authoritative latest
-- definition (grepped) with ONLY the authorize() call swapped to the org-scoped overload (and, for
-- the two RPCs, the authorize check relocated to AFTER the row's org_id is resolved).

-- ── 1) The org-scoped overload (mandatory p_org, NO default) ───────────────────────────────────────
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
      and ( (perm = 'pr.approve'      and m.role = 'owner')
         or (perm = 'plan.write'      and m.role in ('owner','farm_manager'))
         or (perm = 'op.execute'      and m.role in ('owner','farm_manager','agri_engineer','supervisor'))
         or (perm = 'inventory.write' and m.role in ('owner','farm_manager','storekeeper'))
         or (perm = 'budget.write'    and m.role in ('owner','accountant')) )
  )
$$;

-- ── 2) Re-emit the 5 RLS policies to pass the row's org_id as the 2nd arg ───────────────────────────
-- Each is reproduced verbatim from its latest source migration; only authorize('X') → authorize('X', org_id).

-- 2a) pr_update on purchase_requests — latest definition: migration 0007 (the 0017 migration adds the
-- pr_guard_approval TRIGGER, not the policy). SoD requested_by/approved-status clauses preserved.
drop policy if exists pr_update on public.purchase_requests;
create policy pr_update on public.purchase_requests
  for update to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and (
      status <> 'approved'
      or ( public.authorize('pr.approve', org_id)
           and requested_by is distinct from (select auth.uid()) )
    )
  );

-- 2b) tenant_all on inventory_bin + inventory_movements — latest definition: migration 0015.
do $$
declare t text;
begin
  foreach t in array array['inventory_bin','inventory_movements'] loop
    execute format('drop policy if exists tenant_all on public.%I', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (org_id in (select public.user_org_ids()) and public.authorize('inventory.write', org_id))$p$, t);
  end loop;
end $$;

-- 2c) tenant_all on farm_event (+ its partition children) — latest definition: migration 0025.
do $$
declare t text;
begin
  foreach t in array array['farm_event','farm_event_2025_07','farm_event_2025_08','farm_event_default'] loop
    execute format('drop policy if exists tenant_all on public.%I', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (org_id in (select public.user_org_ids()) and public.authorize('op.execute', org_id))$p$, t);
  end loop;
end $$;

-- 2d) tenant_all on event_locations + quantities — latest definition: migration 0025.
-- PRESERVES the RLS-H1 same-org parent-event EXISTS sub-clause (migration 0010); the org-scoped gate
-- is ANDed onto it, exactly as 0025 ANDed the unscoped gate.
do $$
declare t text;
begin
  foreach t in array array['event_locations','quantities'] loop
    execute format('drop policy if exists tenant_all on public.%I', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (
        org_id in (select public.user_org_ids())
        and public.authorize('op.execute', org_id)
        and exists (select 1 from public.farm_event e
                    where e.id = %I.event_id and e.org_id = %I.org_id)
      )$p$, t, t, t);
  end loop;
end $$;

-- 2e) tenant_all on plan_operations — latest definition: migration 0025 (plan.write, NOT op.execute).
drop policy if exists tenant_all on public.plan_operations;
create policy tenant_all on public.plan_operations for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()) and public.authorize('plan.write', org_id));

-- ── 3) fn_execute_operation — latest definition: migration 0020. Re-emitted VERBATIM with ONLY the
-- authorize check relocated to AFTER v_org is resolved and switched to the org-scoped overload. The
-- input range checks, claim-first idempotency, atomic inserts, and movements are byte-for-byte identical.
create or replace function public.fn_execute_operation(
  p_op_id uuid,
  p_actual_qty numeric,
  p_labor_count int,
  p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_plan uuid; v_subtype text; v_target uuid; v_est numeric; v_status text;
  v_item uuid; v_req_qty numeric; v_unit text;
  v_person uuid; v_event uuid; v_actual_cost numeric; v_now timestamptz := now();
  v_claimed int;
begin
  -- B4: range-check inputs (a negative actual_qty would otherwise RAISE on_hand via the issue path).
  if p_actual_qty is null or p_actual_qty < 0 then
    raise exception 'invalid actual_qty: %', p_actual_qty using errcode = '22023';
  end if;
  if p_labor_count is null or p_labor_count < 0 then
    raise exception 'invalid labor_count: %', p_labor_count using errcode = '22023';
  end if;

  -- the operation + its (single) material requirement
  select po.org_id, po.plan_id, po.subtype, po.target_id, po.est_cost, po.status,
         pmr.item_id, pmr.qty, pmr.unit
    into v_org, v_plan, v_subtype, v_target, v_est, v_status, v_item, v_req_qty, v_unit
    from public.plan_operations po
    left join lateral (
      select item_id, qty, unit from public.plan_material_requirements
      where plan_op_id = po.id order by item_id limit 1
    ) pmr on true
    where po.id = p_op_id;
  if v_org is null then
    raise exception 'operation % not found', p_op_id using errcode = 'P0002';
  end if;

  -- AUTHZ-2 (#181): enforce op.execute SCOPED TO THE OP'S ORG, now that v_org is resolved. authorize()
  -- reads auth.uid() from the JWT GUC, which SECURITY DEFINER does NOT change, so it evaluates the
  -- *caller's* permission IN v_org even though the body runs as the definer.
  if not public.authorize('op.execute', v_org) then
    raise exception 'forbidden: op.execute is required to execute operations'
      using errcode = '42501';
  end if;

  -- org guard: the op must belong to one of the caller's orgs (defence in depth alongside RLS).
  if (select auth.uid()) is not null and v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org operation %', p_op_id using errcode = '42501';
  end if;

  -- EXE-1: claim-first. Flip → done only if not already done; abort if another caller won the race.
  update public.plan_operations set status = 'done'
    where id = p_op_id and status <> 'done';
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    raise exception 'operation % already executed', p_op_id using errcode = '23505';
  end if;

  -- actual cost = actual qty × the plan's unit rate (est_cost ÷ planned qty); B3.
  v_actual_cost := coalesce(v_est, 0);
  if v_item is not null and coalesce(v_req_qty, 0) > 0 then
    -- trim_scale so the stored JSON matches the JS computation (no trailing-zero numeric scale)
    v_actual_cost := trim_scale(p_actual_qty * (coalesce(v_est, 0) / v_req_qty));
  end if;

  -- the actor's person row (nullable), for performed_by_person_id
  select id into v_person from public.people
    where user_id = (select auth.uid()) and org_id = v_org limit 1;

  -- 1) the done farm_event (actuals embedded for the PvA report). occurred_at = now() → routes to the
  --    farm_event_default partition for dates outside the seed months.
  insert into public.farm_event (org_id, type, subtype, status, occurred_at, planned_at,
                                 performed_by_person_id, plan_id, notes, data)
  values (v_org, 'operation', v_subtype, 'done', v_now, v_now, v_person, v_plan, p_note,
          jsonb_build_object('labor_count', p_labor_count, 'actual_qty', p_actual_qty,
                             'actual_cost', v_actual_cost, 'op_id', p_op_id))
  returning id into v_event;

  insert into public.event_locations (event_id, org_id, sector_id) values (v_event, v_org, v_target);

  -- 2) consume the material: the quantities row + issue stock + release the reservation. Each call is
  --    transactional and part of THIS transaction, so any failure rolls the whole execution back.
  if v_item is not null then
    insert into public.quantities (org_id, event_id, measure, value_num, label, material_id,
                                   inventory_adjustment)
    values (v_org, v_event, 'weight', p_actual_qty, 'كمية مستخدمة', v_item, -p_actual_qty);

    perform public.fn_post_movement(v_item, 'issue', p_actual_qty, 'main', coalesce(v_unit, 'kg'),
                                    null, v_event, v_plan);
    if coalesce(v_req_qty, 0) > 0 then
      perform public.fn_post_movement(v_item, 'release', v_req_qty, 'main', coalesce(v_unit, 'kg'),
                                      null, v_event, v_plan);
    end if;
  end if;

  return jsonb_build_object('event_id', v_event, 'actual_cost', v_actual_cost,
                           'op_id', p_op_id, 'plan_id', v_plan);
end $$;

revoke all on function public.fn_execute_operation(uuid, numeric, int, text) from public;
revoke execute on function public.fn_execute_operation(uuid, numeric, int, text) from anon;
grant execute on function public.fn_execute_operation(uuid, numeric, int, text) to authenticated;

-- ── 4) fn_post_receipt — latest definition: migration 0029 (the ENGINE-DC re-emission that adds the
-- `set_config('app.posting_receipt','1',true)` trusted-path marker). Re-emitted VERBATIM with ONLY the
-- authorize check relocated to AFTER v_org is resolved and switched to the org-scoped overload. The
-- claim-first flip, the txn-local GUC marker, the per-line receipt loop, and the reset are identical.
create or replace function public.fn_post_receipt(p_pr_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_claimed int;
  v_items int := 0;
  v_item record;
begin
  -- resolve the PR's org
  select pr.org_id, pr.status into v_org, v_status
    from public.purchase_requests pr
    where pr.id = p_pr_id;
  if v_org is null then
    raise exception 'purchase request % not found', p_pr_id using errcode = 'P0002';
  end if;

  -- AUTHZ-2 (#181): receiving stock is inventory.write (owner/farm_manager/storekeeper), now SCOPED TO
  -- THE PR'S ORG (v_org), the same gate the action checked and fn_post_movement enforces. Single source
  -- of truth. Checked after v_org is resolved so the permission is evaluated against the receipt's org.
  if not public.authorize('inventory.write', v_org) then
    raise exception 'forbidden: inventory.write is required to receive stock'
      using errcode = '42501';
  end if;

  -- org guard: the PR must belong to one of the caller's orgs (defence in depth alongside RLS),
  -- mirroring requireMembership() + the fn_post_movement cross-org guard. The null-uid path is the
  -- trusted service/superuser context only; anon is rejected outright.
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org receipt on purchase request %', p_pr_id
      using errcode = '42501';
  end if;

  -- RCP-1: claim-first idempotency gate. Flip approved→received as the FIRST write, guarded by
  -- status='approved'; abort if no row (already received, or never approved) BEFORE posting any
  -- movement. This whole block is one transaction, so a later fn_post_movement failure rolls the
  -- claim back too — the PR returns to `approved` and is cleanly retryable.
  update public.purchase_requests set status = 'received'
    where id = p_pr_id and status = 'approved';
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    raise exception 'purchase request % is not approved or already received', p_pr_id
      using errcode = '23505';
  end if;

  -- ENGINE-DC trusted-path marker (migration 0029): the claim flip above removed THIS PR from the
  -- forward projection, so the receipts we are about to post do not double-count. Mark the txn so the
  -- inv_guard_receipt_no_open_po trigger skips its item-scoped check — which would otherwise be a
  -- false positive (deadlock) when the item has a SECOND, still-approved open PO. Txn-local: it
  -- auto-resets at commit/rollback and cannot leak to a later out-of-band receipt.
  perform set_config('app.posting_receipt', '1', true);

  -- Post one receipt movement per line item, all inside THIS transaction. Any failure (bad item,
  -- cross-org item, etc.) raises and rolls back the claim + every prior receipt — never a partial
  -- multi-item receipt.
  for v_item in
    select item_id, qty, unit, supplier_id
      from public.purchase_request_items
      where pr_id = p_pr_id
      order by item_id
  loop
    perform public.fn_post_movement(
      v_item.item_id,
      'receipt',
      coalesce(v_item.qty, 0),
      'main',
      coalesce(v_item.unit, 'kg'),
      null,                 -- p_unit_cost
      null,                 -- p_event_id
      null,                 -- p_plan_id
      v_item.supplier_id);
    v_items := v_items + 1;
  end loop;

  -- Close the trust window immediately after the receipts are posted. set_config(..., true) is
  -- transaction-scoped, so in production (one RPC = one transaction) it would reset at commit anyway;
  -- resetting it here additionally keeps the bypass from applying to any later receipt that happens to
  -- share the transaction (e.g. a batch caller, or a pgTAP test that runs many cases in one txn). The
  -- bypass is thus active ONLY across this PR's own claim-flipped receipt loop.
  perform set_config('app.posting_receipt', '0', true);

  return jsonb_build_object('pr_id', p_pr_id, 'items_posted', v_items, 'status', 'received');
end $$;

revoke all     on function public.fn_post_receipt(uuid) from public;
revoke execute on function public.fn_post_receipt(uuid) from anon;
grant  execute on function public.fn_post_receipt(uuid) to authenticated;

-- ── 5) LAST: drop the unscoped 1-arg authorize. Nothing references it anymore (every policy/RPC above
-- now calls the 2-arg overload), so an un-migrated caller of authorize(text) fails closed.
drop function public.authorize(text);
