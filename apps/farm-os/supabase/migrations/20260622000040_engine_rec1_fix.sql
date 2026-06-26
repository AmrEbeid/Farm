-- Farm OS MVP-0 — ENGINE-REC1 fix (#184): the purchase recommendation double-subtracts the period-1
-- scheduled receipts. A real shortage could emit shortage=true AND recommend_qty=0 (a contradictory,
-- under-ordering output that leaves the farm short in the field — SPEC-0001 #1 risk).
--
-- BUG (issue #184): the shortfall is read off the PAB recurrence
--   v_pab[t+1] = v_pab[t] - issues[t] + receipts[t]
-- so v_shortfall = -v_pab[first-shortage period+1] ALREADY nets the period-1 scheduled receipts. The
-- recommendation then did `v_raw := greatest(0, v_shortfall + v_ss - coalesce(v_receipts[1], 0))`,
-- subtracting receipts[1] a SECOND time. With a real period-1 shortage partly covered by an approved
-- in-window PO, the second subtraction can drive v_raw to 0 while shortage stays true.
--   Repro: on_hand 300, period-1 demand 500, safety_stock 74, pack 50; inject an approved PO qty 150
--   needed_by = v_period_start (period 1). receipts[1]=150 → PAB[2] = 300-500+150 = -50 → shortage=true,
--   shortfall=50. OLD: greatest(0, 50 + 74 - 150) = 0 → recommend_qty=0 (contradiction). The farm is
--   still 50 short for the period-1 op (+74 to rebuild safety stock); the right order is 124 → pack 150.
--
-- FIX: drop the second subtraction — `v_raw := greatest(0, v_shortfall + v_ss)`. The shortfall already
-- nets receipts via the PAB recurrence; subtracting again double-counts. This is the ONLY change from the
-- latest fn_stock_coverage (migration 0034). It can only RAISE the recommendation, never lower it, so it
-- can never mask a shortage (safe direction). The ENGINE-STALE-1 guard (`needed_by >= v_period_start`)
-- and everything else are kept byte-identical to 0034.
--
-- Residual (follow-up, NOT this migration): a PO overdue relative to *today* but still >= v_period_start
-- is not yet excluded — that needs the broader forward-anchoring of the projection timeline (the engine
-- anchors at v_period_start = min(planned op date), which can itself be in the past). Tracked on #197.
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
  -- ENGINE-STALE-1 (#197): require needed_by >= v_period_start. A PO due BEFORE the plan window is not
  -- this plan's forward supply (received → already in on_hand; not received → overdue, don't assume it
  -- arrives). Without this, greatest(bucket,1) clamps an overdue PO into period 1 and masks a shortage.
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
