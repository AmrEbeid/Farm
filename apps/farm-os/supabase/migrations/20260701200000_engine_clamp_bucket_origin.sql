-- Farm OS — engine masked-shortage fix (REGRESSION from #509): clamp the demand/receipt bucket origin to today.
-- Owner-directed build; independent review + prod re-probe. ENGINE / cardinal-sin surface (SPEC-0001 §1).
--
-- BUG (found by a holistic re-audit of the session's 5 engine migrations): #509 (`20260701130000`) added
-- 'in_progress'/'approved' to BOTH the demand-sum query (safe — only adds demand) AND the ORIGIN query
-- `min(po.planned_at)` (line 91 — NOT safe). `v_period_start` is the unclamped bucket origin. A live op with a
-- STALE PAST planned_at — and a long-running 'in_progress' op is exactly that — now anchors period 1 in the
-- PAST, shifting genuine near-term demand beyond the horizon filter (`<= p_horizon_weeks`, line 118) → its
-- demand is SILENTLY DROPPED → shortage=false / recommend_qty=0 while stock is actually short (the cardinal sin).
-- Pre-#509 the origin set excluded in_progress, so this masking case was correctly flagged; #509 fixed one mask
-- and opened another. (0094's own header already flagged that min(planned_at) can be in the past.)
--
-- FIX: clamp the bucket origin — `v_period_start := greatest(v_period_start, current_date)`. Clamping UP moves
-- demand AND receipts to EARLIER buckets only (a past-due op → period 1 via greatest(...,1)), so it can only ADD
-- in-horizon demand, never drop it — the safe direction. It is consistent with the existing forward-anchors: the
-- receipts filter (line 145) and stockout (line 186) already clamp to current_date, so this only aligns the
-- demand bucket to the same forward origin. Re-emitted VERBATIM from 20260701130000 with ONLY the clamp added.
-- Independent review required. Validation: pgTAP 110 (define-check-first: past in_progress op + future demand →
-- shortage) + the full #239 oracle harness; prod re-probe.

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
  v_maxdef     numeric := 0;   -- #280 F4: worst (deepest) deficit anywhere in the horizon
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
  -- EXE-MASK: live ops = the app's LIVE_OP set (non-terminal, non-blocked, material un-issued).
  select min(po.planned_at) into v_period_start
    from public.plans p
    join public.plan_operations po on po.plan_id = p.id
    join public.plan_material_requirements pmr on pmr.plan_op_id = po.id
    where pmr.item_id = p_item
      and p.org_id = v_org
      and po.status in ('planned','approved','reserved','ready','in_progress')
      and p.status in ('draft','active','approved');
  if v_period_start is null then
    v_period_start := current_date;
  end if;
  -- ENGINE-H3 (regression from #509): clamp the bucket origin to today. Widening the origin query (above) to
  -- the LIVE_OP set means a long-running 'in_progress' op with a stale PAST planned_at would anchor period 1 in
  -- the past, pushing genuine near-term demand beyond the horizon filter → SILENTLY DROPPED → masked shortage.
  -- Clamping UP moves demand/receipts to EARLIER buckets only (past-due → period 1), so it can only ADD
  -- in-horizon demand, never drop it. Consistent with the receipts (line below) + stockout forward-anchors.
  v_period_start := greatest(v_period_start, current_date);

  -- planned demand bucketed into weekly periods [period_start + 7*(t-1), +7*t).
  -- ENGINE-H2: drop demand scheduled beyond the horizon instead of clamping it into
  -- the last period (which fabricated an in-horizon shortage).
  -- ENGINE-NULLDATE-1 (#198): a planned op may have a NULL planned_at (the column is nullable). With
  -- raw po.planned_at, a null date makes both the bucket and the `<= p_horizon_weeks` filter NULL, so the
  -- row is EXCLUDED and its real material demand is SILENTLY DROPPED — masking a possible shortage.
  -- Conservatively treat a null-dated op's demand as IMMEDIATE: coalesce(po.planned_at, v_period_start)
  -- → period 1 (greatest(floor(0/7)+1,1)=1) and INCLUDED in the horizon. For a dated op this coalesce is
  -- a no-op, so the projection is unchanged. This can only ADD demand, never mask it.
  v_issues := array_fill(0::numeric, array[p_horizon_weeks]);
  for i, v_shortfall in
    select
      greatest(floor((coalesce(po.planned_at, v_period_start) - v_period_start) / 7.0)::int + 1, 1) as bucket,
      sum(pmr.qty) as q
    from public.plan_operations po
    join public.plan_material_requirements pmr on pmr.plan_op_id = po.id
    join public.plans p on p.id = po.plan_id
    where pmr.item_id = p_item
      and p.org_id = v_org
      and po.status in ('planned','approved','reserved','ready','in_progress')
      and p.status in ('draft','active','approved')
      and floor((coalesce(po.planned_at, v_period_start) - v_period_start) / 7.0)::int + 1 <= p_horizon_weeks
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
      and pr.needed_by >= greatest(v_period_start, current_date)
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
    -- #280 F4: capture the FIRST crossing (v_first/v_shortfall — paired with first_shortage_period)
    -- AND the WORST deficit anywhere in the horizon (v_maxdef). The recommendation must cover the
    -- deepest point, not just the first dip, else a deepening shortage is under-ordered.
    if v_pab[i + 1] < 0 then
      if v_first is null then
        v_first := i;
        v_shortfall := -v_pab[i + 1];
      end if;
      if -v_pab[i + 1] > v_maxdef then
        v_maxdef := -v_pab[i + 1];
      end if;
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
    -- #280 F4: size off v_maxdef (deepest deficit), not v_shortfall (first dip). v_maxdef >=
    -- v_shortfall always, so this only ever RAISES recommend_qty — a safe direction that cannot
    -- mask a shortage. The warning-only case (PAB dips below safety stock but never < 0) is
    -- unchanged: v_maxdef stays 0, v_raw = greatest(0, 0 + v_ss) = v_ss, as before.
    v_raw := greatest(0, v_maxdef + v_ss);
  else
    v_raw := 0;
  end if;
  v_qty := ceil(v_raw / v_pack) * v_pack;

  if v_qty > 0 then
    v_msg := format('⚠️ نقص متوقع: %s كجم الأسبوع القادم. اطلب %s كجم اليوم.',
                    trim_scale(greatest(v_shortfall, v_maxdef)), trim_scale(v_qty));
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
