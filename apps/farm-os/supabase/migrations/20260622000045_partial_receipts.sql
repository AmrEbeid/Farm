-- Farm OS MVP-0 — SPEC-0009 (#155): partial / over-receipt model (slices 1-3).
--
-- THE BUG. Receipts are all-or-nothing. fn_post_receipt (latest: migration 0035) posts the FULL
-- purchase_request_items.qty per line and flips the PR wholesale approved→received in one txn; there
-- is no received-to-date balance on the line. Real procurement breaks the engine's "counted exactly
-- once" invariant (SPEC-0001 §1) two ways: (1) partial under-delivery — approve 500, only 300 arrive;
-- the RPC posts the full 500 (on_hand overstated) or the operator flips to received and posts 300
-- (the still-owed 200 silently vanishes from the forward projection); (2) over-delivery — 600 lands
-- on a 500 order with no objection. SPEC-0009 §4 is the acceptance oracle.
--
-- THE FIX (this migration — slices 1-3 only; the #156 ENGINE-DC guard / GUC retirement is slice 4 and
-- is intentionally NOT touched here):
--   1. Schema: purchase_request_items.received_qty (received-to-date balance); a new
--      'partially_received' purchase_requests.status.
--   2. fn_post_receipt → per-line, quantity-aware: receive a requested qty per line (default = the
--      full remaining = qty - received_qty for backward-compatible whole-PR receives), reject
--      over-receipt (requested > remaining), increment received_qty, and flip the PR to 'received'
--      only when EVERY line is fully received, else 'partially_received'. Claim-first idempotency, the
--      app.posting_receipt GUC trusted-path marker, the org-scoped authorize, the anon/cross-org
--      guard, and atomicity (one txn) are all PRESERVED.
--   3. Engine: fn_stock_coverage projects qty - received_qty over status in
--      ('approved','partially_received') — keeping received-to-date (on_hand) and remaining-on-order
--      (the projection) disjoint and exhaustive under partial/over receipts. For an approved PR with
--      received_qty=0 (every PR today) this is byte-identical to the prior projection, so the existing
--      engine tests (06/16/35/40) are unaffected.
--
-- ADR-0006 conventions: forward-only migration; create-or-replace functions; SECURITY DEFINER +
-- set search_path = ''; fully schema-qualified; function-lockdown revoke pattern preserved. The
-- fn_post_receipt and fn_stock_coverage bodies below are re-emitted from their authoritative latest
-- definitions (0035 and 0040 respectively) with ONLY the changes documented inline.

-- ── 1) Schema ──────────────────────────────────────────────────────────────────────────────────────
-- received-to-date balance per line. Default 0 so every existing line (and every explicit-column
-- insert in seed/tests) is unaffected; the projection sees qty - 0 = qty for un-received lines.
alter table public.purchase_request_items
  add column if not exists received_qty numeric not null default 0;

-- SECURITY (independent review, #155): received_qty is ENGINE-TRUSTED — fn_stock_coverage projects
-- `qty - received_qty`, so a wrong value masks a shortage or double-counts (the exact invariant this
-- feature protects). It must be advanced ONLY by the SECURITY DEFINER fn_post_receipt (which runs as the
-- table owner and bypasses this column grant), never by a member directly. Without this, a member could
-- `set_config('app.posting_receipt','1',true)` then `update purchase_request_items set received_qty=…`
-- (the 0032 trigger below now exempts received_qty-only updates under that FORGEABLE GUC marker) and
-- corrupt the projection without going through the RPC or posting a movement. Revoke the column-level
-- UPDATE from authenticated (mirrors migration 0030's RPC-only-INSERT lockdown for movements); a value
-- CHECK is a belt-and-braces backstop. Legit draft-line edits never touch received_qty, so are unaffected.
-- NOTE: `authenticated` holds a TABLE-level UPDATE grant (migration 0009), and Postgres will not let a
-- column-level REVOKE restrict a role that holds the table grant. So revoke the table grant and re-grant
-- UPDATE on every column EXCEPT received_qty — members keep their (RLS + 0032-trigger-gated) ability to
-- edit a draft line's fields; received_qty is writable ONLY by the table-owner SECURITY DEFINER RPC.
revoke update on public.purchase_request_items from authenticated;
grant update (id, pr_id, org_id, item_id, qty, unit, supplier_id, est_cost)
  on public.purchase_request_items to authenticated;
alter table public.purchase_request_items
  add constraint pri_received_qty_valid
  check (received_qty >= 0 and (qty is null or received_qty <= qty));

-- add 'partially_received' to the status check. Drop the auto-named inline constraint
-- (purchase_requests_status_check) and re-create it with the new value, keeping every existing value.
alter table public.purchase_requests drop constraint if exists purchase_requests_status_check;
alter table public.purchase_requests
  add constraint purchase_requests_status_check
  check (status in ('draft','submitted','approved','rejected','received','partially_received'));

-- ── 2) fn_pr_items_lock_when_decided — allow the trusted receipt path to advance received_qty ───────
-- Migration 0032 freezes ALL purchase_request_items mutations once the parent PR is decided
-- (approved/received), exempting only the null-uid server context. Its note assumed "fn_post_receipt
-- only READS items"; SPEC-0009 now has fn_post_receipt WRITE received_qty (the fulfillment counter) on
-- an approved/partially_received line — a legitimate, controlled mutation that the 0032 lock would
-- wrongly reject (the caller's auth.uid() is the storekeeper, not null). Re-emit the guard VERBATIM
-- from 0032 with ONE added exemption: while fn_post_receipt's txn-local app.posting_receipt='1' marker
-- is set, permit an UPDATE that changes ONLY received_qty — the monetary footprint (item_id, qty,
-- est_cost, supplier_id, unit, pr_id) must stay immutable even on this path, so the #160 financial
-- control is fully preserved (a member forging the GUC still cannot move money or reparent a line).
create or replace function public.fn_pr_items_lock_when_decided()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  -- trusted server/seed context (no JWT) is exempt — same precedent as pr_guard_approval (0017/0023).
  if (select auth.uid()) is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- SPEC-0009 trusted receipt path: fn_post_receipt sets app.posting_receipt='1' (txn-local) while it
  -- advances received_qty on the line being received. Permit ONLY that — an UPDATE whose monetary
  -- footprint is byte-for-byte unchanged (only received_qty / the immutable id may differ). Every other
  -- field stays frozen, so this neither weakens #160 nor lets a forged GUC change a commitment's money.
  if tg_op = 'UPDATE'
     and coalesce(current_setting('app.posting_receipt', true), '') = '1'
     and new.pr_id       is not distinct from old.pr_id
     and new.item_id     is not distinct from old.item_id
     and new.qty         is not distinct from old.qty
     and new.unit        is not distinct from old.unit
     and new.supplier_id is not distinct from old.supplier_id
     and new.est_cost    is not distinct from old.est_cost then
    return new;
  end if;

  -- Guard the line's CURRENT parent (old) on UPDATE/DELETE: you cannot edit, delete, OR detach
  -- (pr_id-rewrite) a line that currently belongs to a decided PR — that mutates the approved PR's
  -- monetary footprint. (Reviewer-found bypass: checking only new.pr_id let a line be moved OFF an
  -- approved PR onto a draft.)
  if tg_op in ('UPDATE','DELETE') then
    select pr.status into v_status from public.purchase_requests pr where pr.id = old.pr_id;
    if v_status in ('approved','received') then
      raise exception
        'cannot % a line of purchase request % — it is already % (approved purchase commitments are immutable; re-issue instead)',
        lower(tg_op), old.pr_id, v_status
        using errcode = '42501';
    end if;
  end if;

  -- Guard the TARGET parent (new) on INSERT/UPDATE: you cannot add a line to, or move a line onto, a
  -- decided PR.
  if tg_op in ('INSERT','UPDATE') then
    select pr.status into v_status from public.purchase_requests pr where pr.id = new.pr_id;
    if v_status in ('approved','received') then
      raise exception
        'cannot % a line onto purchase request % — it is already % (approved purchase commitments are immutable)',
        (case when tg_op = 'INSERT' then 'add' else 'move' end), new.pr_id, v_status
        using errcode = '42501';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- trigger function is never called directly — keep it locked down (mirrors migration 0032).
revoke execute on function public.fn_pr_items_lock_when_decided() from public, anon, authenticated;

-- ── 3) fn_post_receipt — per-line, quantity-aware (re-emitted from migration 0035) ──────────────────
-- The signature gains an optional p_lines jsonb ([{"item_id": uuid, "qty": numeric}, ...]). When NULL
-- (the current app call public.fn_post_receipt(prId)), every line receives its full REMAINING qty —
-- backward-compatible with the all-or-nothing behaviour. The old 1-arg fn_post_receipt(uuid) is
-- DROPPED first: a 1-arg + (1-arg + default) overload pair is ambiguous on a single-uuid call
-- ("function ... is not unique"), so there must be exactly one function.
drop function if exists public.fn_post_receipt(uuid);

create or replace function public.fn_post_receipt(p_pr_id uuid, p_lines jsonb default null)
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
  v_remaining numeric;
  v_req numeric;
  v_final text;
begin
  -- resolve the PR's org + status
  select pr.org_id, pr.status into v_org, v_status
    from public.purchase_requests pr
    where pr.id = p_pr_id;
  if v_org is null then
    raise exception 'purchase request % not found', p_pr_id using errcode = 'P0002';
  end if;

  -- AUTHZ-2 (#181): receiving stock is inventory.write (owner/farm_manager/storekeeper), SCOPED TO THE
  -- PR'S ORG (v_org) — the same gate the action checked and fn_post_movement enforces. Checked after
  -- v_org is resolved so the permission is evaluated against the receipt's org. authorize() reads
  -- auth.uid() from the JWT GUC, which SECURITY DEFINER does NOT change, so it evaluates the CALLER's
  -- permission in v_org even though the body runs as the definer.
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

  -- RCP-1: claim-first idempotency gate. A receipt is only valid against an open PO, so claim the row
  -- guarded by `status in ('approved','partially_received')`: this writes (and so row-LOCKS) the PR as
  -- the FIRST action, serialising concurrent receives and rejecting a fully-received/never-approved PR
  -- BEFORE posting any movement. (A partially_received PR is legitimately receivable again — that is
  -- why the claim no longer flips straight to 'received'; the final status is computed AFTER posting.)
  -- The whole body is one transaction, so any later failure rolls this claim + every receipt back —
  -- the PR returns to its prior status and is cleanly retryable.
  update public.purchase_requests set status = status
    where id = p_pr_id and status in ('approved','partially_received');
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    raise exception 'purchase request % is not receivable (must be approved or partially_received)', p_pr_id
      using errcode = '23505';
  end if;

  -- ENGINE-DC trusted-path marker (migration 0029): mark the txn so inv_guard_receipt_no_open_po skips
  -- its item-scoped check for the receipts we are about to post. fn_post_receipt maintains disjointness
  -- by construction — it caps each line at its remaining-on-order and flips the PR out of the forward
  -- projection (to 'received'/'partially_received') in the SAME txn — so its receipts never
  -- double-count. Txn-local (is_local=true): auto-resets at commit/rollback, cannot leak to a later
  -- out-of-band receipt.
  perform set_config('app.posting_receipt', '1', true);

  -- Post one receipt movement per line, all inside THIS transaction. Any failure (over-receipt, bad
  -- item, cross-org item, malformed line) raises and rolls back the claim + every prior receipt —
  -- never a partial multi-item receipt.
  for v_item in
    select item_id, qty, unit, supplier_id, coalesce(received_qty, 0) as received_qty
      from public.purchase_request_items
      where pr_id = p_pr_id
      order by item_id
  loop
    -- a line with no quantity is malformed: there is no remaining-on-order to receive against. Reject
    -- it (and roll the whole call back). The old all-or-nothing path raised here too — it posted
    -- coalesce(qty,0)=0 and fn_post_movement raised 22023.
    if v_item.qty is null then
      raise exception 'purchase request line for item % has no quantity', v_item.item_id
        using errcode = '22023';
    end if;

    v_remaining := v_item.qty - v_item.received_qty;

    -- requested receive qty: the p_lines entry for this item, else (p_lines NULL) the full remaining.
    -- When p_lines is provided but omits this item, it is not received in this call (req = 0).
    if p_lines is null then
      v_req := v_remaining;
    else
      select (e->>'qty')::numeric into v_req
        from jsonb_array_elements(p_lines) e
        where (e->>'item_id')::uuid = v_item.item_id
        limit 1;
      v_req := coalesce(v_req, 0);
    end if;

    -- reject over-receipt: never let received_qty exceed the ordered qty (SPEC-0009 §4.3). Atomic —
    -- nothing posted, the whole call rolls back.
    if v_req > v_remaining then
      raise exception
        'over-receipt: cannot receive % of item % — only % remaining on purchase request %',
        v_req, v_item.item_id, v_remaining, p_pr_id
        using errcode = '23514';   -- check_violation
    end if;

    -- skip a line with nothing to receive this call (req=0): either already fully received (remaining
    -- 0) or omitted from p_lines. Posting a 0-qty movement would (correctly) raise in fn_post_movement.
    if v_req <= 0 then
      continue;
    end if;

    perform public.fn_post_movement(
      v_item.item_id,
      'receipt',
      v_req,
      'main',
      coalesce(v_item.unit, 'kg'),
      null,                 -- p_unit_cost
      null,                 -- p_event_id
      null,                 -- p_plan_id
      v_item.supplier_id);

    update public.purchase_request_items
      set received_qty = coalesce(received_qty, 0) + v_req
      where pr_id = p_pr_id and item_id = v_item.item_id;

    v_items := v_items + 1;
  end loop;

  -- Close the trust window immediately after the receipts are posted (txn-local resets at commit too).
  perform set_config('app.posting_receipt', '0', true);

  -- Final status: 'received' iff EVERY line is fully received (received_qty >= qty), else
  -- 'partially_received'. This flips the PR out of (or keeps it correctly in) the forward projection.
  if exists (
    select 1 from public.purchase_request_items
      where pr_id = p_pr_id and coalesce(received_qty, 0) < coalesce(qty, 0)
  ) then
    v_final := 'partially_received';
  else
    v_final := 'received';
  end if;
  update public.purchase_requests set status = v_final where id = p_pr_id;

  return jsonb_build_object('pr_id', p_pr_id, 'items_posted', v_items, 'status', v_final);
end $$;

revoke all     on function public.fn_post_receipt(uuid, jsonb) from public;
revoke execute on function public.fn_post_receipt(uuid, jsonb) from anon;
grant  execute on function public.fn_post_receipt(uuid, jsonb) to authenticated;

-- ── 4) fn_stock_coverage — remaining-based scheduled-receipts projection (re-emitted from 0040) ─────
-- ONLY the scheduled-receipts query changes: sum(pri.qty) → sum(pri.qty - coalesce(pri.received_qty,0))
-- and pr.status = 'approved' → pr.status in ('approved','partially_received'). Everything else (the
-- #197 needed_by guard, the #184 recommendation fix, the horizon/PAB recurrence) is byte-identical to
-- migration 0040. For an approved PR with received_qty=0 this is identical to today's projection.
create or replace function public.fn_stock_coverage(
  p_item uuid,
  p_location text default 'main',
  p_horizon_weeks int default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org        uuid;
  v_onhand     numeric;
  v_reserved   numeric;
  v_avail      numeric;
  v_ss         numeric;
  v_lead       int;
  v_pack       numeric;
  v_period_start date;
  v_issues     numeric[];
  v_receipts   numeric[];
  v_pab        numeric[];
  v_first      int := null;   -- first period PAB < 0 (shortage)
  v_warn       int := null;   -- first period PAB < safety stock (early warning)
  v_shortfall  numeric := 0;
  v_daily      numeric;
  v_cov        numeric;
  v_cov_out    jsonb;
  v_raw        numeric;
  v_qty        numeric;
  v_stockout   timestamptz;
  i            int;
  v_msg        text;
begin
  -- opening snapshot
  select org_id, on_hand, reserved
    into v_org, v_onhand, v_reserved
    from public.inventory_bin
    where item_id = p_item and location = p_location;

  if v_org is null then
    raise exception 'no inventory_bin for item % at %', p_item, p_location using errcode = 'P0002';
  end if;

  -- org guard. ENGINE-guard: an unauthenticated (anon) caller is NEVER trusted, even
  -- though auth.uid() is null for it; the null-uid bypass is only for the service/
  -- superuser context (auth.role() <> 'anon'). A JWT user must belong to the item's org.
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null
         and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org access to item %', p_item using errcode = '42501';
  end if;

  select coalesce(safety_stock, 0), coalesce(lead_time_days, 0), coalesce(nullif(pack_size, 0), 1)
    into v_ss, v_lead, v_pack
    from public.inventory_items where id = p_item;

  -- ENGINE-C1: available = on_hand - reserved. on_hand already nets expiry (the
  -- reconciliation oracle counts expiry as a negative movement), so do NOT subtract
  -- Σ(expiry) again. (Deferred: a forward overlay for expired-but-not-yet-disposed
  -- batches keyed on expiry_date — needs batch tracking, out of scope for MVP-0.)
  v_avail := v_onhand - v_reserved;

  -- Reference origin = the EARLIEST demanding operation date for this item, so the
  -- first planned consumption always lands in period 1 ("next week" in the oracle).
  select min(po.planned_at) into v_period_start
    from public.plans p
    join public.plan_operations po on po.plan_id = p.id
    join public.plan_material_requirements pmr on pmr.plan_op_id = po.id
    where pmr.item_id = p_item
      and p.org_id = v_org
      and po.status in ('planned','reserved','ready')
      and p.status in ('draft','active','approved');
  if v_period_start is null then
    v_period_start := current_date;
  end if;

  -- planned demand bucketed into weekly periods [period_start + 7*(t-1), +7*t).
  -- ENGINE-H2: drop demand scheduled beyond the horizon instead of clamping it into
  -- the last period (which fabricated an in-horizon shortage).
  v_issues := array_fill(0::numeric, array[p_horizon_weeks]);
  for i, v_shortfall in
    select
      greatest(floor((po.planned_at - v_period_start) / 7.0)::int + 1, 1) as bucket,
      sum(pmr.qty) as q
    from public.plan_operations po
    join public.plan_material_requirements pmr on pmr.plan_op_id = po.id
    join public.plans p on p.id = po.plan_id
    where pmr.item_id = p_item
      and p.org_id = v_org
      and po.status in ('planned','reserved','ready')
      and p.status in ('draft','active','approved')
      and floor((po.planned_at - v_period_start) / 7.0)::int + 1 <= p_horizon_weeks
    group by 1
  loop
    v_issues[i] := coalesce(v_issues[i], 0) + v_shortfall;
  end loop;

  -- ENGINE-DC: scheduled receipts = open POs (APPROVED + PARTIALLY_RECEIVED purchase requests), NOT
  -- actual receipt movements. A received receipt is already in on_hand (fn_bin_rebuild sums all
  -- receipts), so projecting receipt movements double-counted them. SPEC-0009: a partially-received PO
  -- still has REMAINING-on-order supply that is not yet in on_hand → project qty - received_qty (the
  -- already-received portion is in on_hand, the remainder is genuinely-future supply). For an approved
  -- PR (received_qty=0) this is exactly qty, unchanged from before. on_hand and the projection remain
  -- disjoint and exhaustive by construction. Bucketed by needed_by, plan-relative like demand.
  -- ENGINE-STALE-1 (#197): require needed_by >= v_period_start. A PO due BEFORE the plan window is not
  -- this plan's forward supply (received → already in on_hand; not received → overdue, don't assume it
  -- arrives). Without this, greatest(bucket,1) clamps an overdue PO into period 1 and masks a shortage.
  v_receipts := array_fill(0::numeric, array[p_horizon_weeks]);
  for i, v_shortfall in
    select
      greatest(floor((pr.needed_by - v_period_start) / 7.0)::int + 1, 1) as bucket,
      sum(pri.qty - coalesce(pri.received_qty, 0)) as q
    from public.purchase_request_items pri
    join public.purchase_requests pr on pr.id = pri.pr_id
    where pri.item_id = p_item
      and pr.org_id = v_org
      and pr.status in ('approved','partially_received')
      and pr.needed_by is not null
      and pr.needed_by >= v_period_start
      and floor((pr.needed_by - v_period_start) / 7.0)::int + 1 <= p_horizon_weeks
    group by 1
  loop
    v_receipts[i] := coalesce(v_receipts[i], 0) + v_shortfall;
  end loop;
  v_shortfall := 0; -- reset (reused as loop var above)

  -- PAB recurrence: v_pab[1] = opening; v_pab[t+1] = v_pab[t] - issues[t] + receipts[t].
  -- ENGINE-SS: also capture the first period the balance drops below safety stock.
  v_pab := array[v_avail];
  for i in 1 .. p_horizon_weeks loop
    v_pab := v_pab || (v_pab[i] - coalesce(v_issues[i], 0) + coalesce(v_receipts[i], 0));
    if v_warn is null and v_pab[i + 1] < v_ss then
      v_warn := i;
    end if;
    if v_first is null and v_pab[i + 1] < 0 then
      v_first := i;
      v_shortfall := -v_pab[i + 1];
    end if;
  end loop;

  -- daily demand = period-1 weekly requirement / 7
  v_daily := coalesce(v_issues[1], 0) / 7.0;
  if v_daily <= 0 then
    v_cov := null;            -- Infinity, represented as null/∞ in JSON
    v_stockout := null;
  else
    v_cov := round(v_avail / v_daily, 1);
    -- ENGINE-M1: anchor the projected stock-out to a FORWARD origin. v_period_start is
    -- the plan's earliest demanding op, which can be in the past — anchoring there gave a
    -- historical "stock-out date". Use greatest(today, period_start) so the projection
    -- always looks forward (SPEC-0001 §1: "projected stock-out date").
    v_stockout := greatest(current_date, v_period_start)::timestamptz
                  + (v_avail / v_daily) * interval '1 day';
  end if;

  -- ENGINE-H1: recommend a purchase ONLY when the projected balance actually breaches
  -- safety stock within the horizon. Otherwise (ample stock / no demand) recommend none.
  if v_warn is not null then
    -- ENGINE-REC1 (#184): do NOT subtract receipts[1] here. v_shortfall already nets the period-1
    -- scheduled receipts via the PAB recurrence (v_pab[t+1] = v_pab[t] - issues[t] + receipts[t]);
    -- subtracting them again double-counts and could under-order a real shortage (shortage=true yet
    -- recommend_qty=0). Was: greatest(0, v_shortfall + v_ss - coalesce(v_receipts[1], 0)).
    v_raw := greatest(0, v_shortfall + v_ss);
  else
    v_raw := 0;
  end if;
  v_qty := ceil(v_raw / v_pack) * v_pack;

  if v_qty > 0 then
    v_msg := format('⚠️ نقص متوقع: %s كجم الأسبوع القادم. اطلب %s كجم اليوم.',
                    trim_scale(v_shortfall), trim_scale(v_qty));
  else
    v_msg := '✅ المخزون كافٍ. لا حاجة للطلب الآن.';
  end if;

  v_cov_out := case when v_cov is null then to_jsonb('∞'::text) else to_jsonb(v_cov) end;

  return jsonb_build_object(
    'item_id', p_item,
    'location', p_location,
    'available', v_avail,
    'safety_stock', v_ss,
    'lead_time_days', v_lead,
    'reorder_point', round(v_daily * v_lead + v_ss, 2),
    'coverage_days', v_cov_out,
    'stockout_date', v_stockout,
    'pab', to_jsonb(v_pab),
    'first_shortage_period', v_first,
    'first_warning_period', v_warn,
    'shortage', (v_first is not null),
    'shortfall', v_shortfall,
    'recommend_qty', v_qty,
    'order_by', case
                  when v_qty > 0 and (v_cov is null or v_cov < v_lead)
                  then current_date else null end,
    'message_ar', v_msg
  );
end;
$$;
