-- Farm OS MVP-0 — ENGINE-DC fix (direction #2): source scheduled receipts from open purchase
-- requests, not from the actual-movement ledger.
--
-- BUG (docs/SECURITY-FINDING-engine-receipt-doublecount-2026-06-25.md + its refinement; pgTAP 14):
-- fn_bin_rebuild sums ALL `receipt` movements into on_hand, while fn_stock_coverage ALSO projected
-- `receipt` movements dated >= period_start forward. A receipt that has been RECEIVED is therefore in
-- on_hand AND re-projected → counted twice → PAB optimistic → a real shortage can be hidden (the core
-- wedge's whole purpose; SPEC-0001 #1 risk). Prototyping a wall-clock filter proved insufficient: the
-- engine's model is plan-relative, and an actual `receipt` movement can't be told apart from a
-- "scheduled" one — so the double-count is a data-model problem, not a filter bug.
--
-- FIX: a "scheduled receipt" is genuinely-future supply that is NOT yet in on_hand — i.e. an APPROVED
-- purchase request that has not been received. Source v_receipts from purchase_request_items joined to
-- approved purchase_requests (bucketed by needed_by, plan-relative like demand), and stop reading the
-- actual-movement ledger. on_hand (received-to-date, from the receipt movements) and the forward
-- projection (open POs) are now disjoint BY CONSTRUCTION: when a PR is received, recordReceipt flips
-- its status to 'received' (so it leaves this projection) at the same time a receipt movement lands in
-- on_hand (so it enters the opening) — counted exactly once, always. Matches SPEC-0001's MRP framing
-- ("scheduled receipts" = open POs). This is the ONLY change from the migration-0010 definition (the
-- v_receipts source query).
--
-- Note (MVP-0 single-location): purchase_requests carry no location; all supply is assumed to land at
-- the same bin the demand draws from. Fine for the single 'main' location; revisit if multi-location.
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

  -- ENGINE-DC: scheduled receipts = APPROVED-but-not-yet-received purchase requests (open POs),
  -- NOT actual receipt movements. A received receipt is already in on_hand (fn_bin_rebuild sums all
  -- receipts), so projecting receipt movements double-counted them. An approved PR is future supply
  -- not yet in on_hand → on_hand and the projection are disjoint. Bucketed by needed_by, plan-relative
  -- like demand. On receipt the PR flips to 'received' (leaves here) as a receipt movement enters
  -- on_hand (enters the opening) — counted exactly once.
  v_receipts := array_fill(0::numeric, array[p_horizon_weeks]);
  for i, v_shortfall in
    select
      greatest(floor((pr.needed_by - v_period_start) / 7.0)::int + 1, 1) as bucket,
      sum(pri.qty) as q
    from public.purchase_request_items pri
    join public.purchase_requests pr on pr.id = pri.pr_id
    where pri.item_id = p_item
      and pr.org_id = v_org
      and pr.status = 'approved'
      and pr.needed_by is not null
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
    v_raw := greatest(0, v_shortfall + v_ss - coalesce(v_receipts[1], 0));
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
