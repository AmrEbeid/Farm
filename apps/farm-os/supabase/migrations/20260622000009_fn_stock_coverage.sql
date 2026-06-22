-- Farm OS MVP-0 — Phase C: the stock-coverage engine (SPEC-0001).
--
-- Two functions, both security-definer + org-scoped (a member of another org gets
-- nothing / a raised error), mirroring lib/stock-calc.ts EXACTLY so the SQL and TS
-- cores cannot drift (bound by the parity test in tests/04_stock_coverage_test.sql):
--
--   public.fn_bin_rebuild(item, location)  — SC-6 fallback: recompute on_hand from
--       the signed movement ledger and write it back to inventory_bin. Returns the
--       recomputed on_hand. This is the reconciliation oracle.
--
--   public.fn_stock_coverage(item, location, horizon_weeks) — the engine. Reads:
--       opening available  = bin.on_hand − bin.reserved − Σ(expiry movements);
--       planned demand      = plan_material_requirements joined to plan_operations
--                             (status planned/reserved/ready), bucketed into WEEKLY
--                             periods relative to the plan's period_start;
--       scheduled receipts  = future-dated receipt movements, bucketed the same way.
--       Then PAB(t)=PAB(t−1)−issues(t)+receipts(t), first shortage period, coverage
--       days, and the purchase recommendation (shortfall + SS − receipts, rounded
--       up to pack). Output is a jsonb row with an Arabic-first message.
--
-- Conventions (match lib/stock-calc.ts):
--   - daily demand = period-1 weekly requirement / 7 (the plan states a weekly need).
--   - period buckets are 7-day windows from the plan period_start (so the result is
--     deterministic regardless of now()); requirement planned_at - period_start in
--     [0,7) → period 1, [7,14) → period 2, ...
--   - SS comes from inventory_items.safety_stock (seeded 74 for potassium = Z·σ·√L).
--   - coverage_days = available / daily_demand, Infinity-guarded.

-- ---------------------------------------------------------------------------
-- fn_bin_rebuild: rebuild-from-ledger (SC-6 fallback). Signed movement sum.
-- ---------------------------------------------------------------------------
create or replace function public.fn_bin_rebuild(p_item uuid, p_location text default 'main')
returns numeric
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_onhand numeric;
begin
  select org_id into v_org from public.inventory_bin
    where item_id = p_item and location = p_location;
  if v_org is null then
    select org_id into v_org from public.inventory_items where id = p_item;
  end if;
  -- org guard: callers in a JWT context must belong to the item's org.
  if (select auth.uid()) is not null
     and v_org is not null
     and v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org access to item %', p_item using errcode = '42501';
  end if;

  select coalesce(sum(case
    when m.type in ('receipt','return','adjustment') then m.qty
    when m.type in ('issue','loss','expiry','transfer') then -m.qty
    else 0 end), 0)
  into v_onhand
  from public.inventory_movements m
  where m.item_id = p_item and m.location = p_location;

  update public.inventory_bin
    set on_hand = v_onhand,
        projected = v_onhand - reserved + ordered
    where item_id = p_item and location = p_location;

  return v_onhand;
end;
$$;

-- ---------------------------------------------------------------------------
-- fn_stock_coverage: the engine.
-- ---------------------------------------------------------------------------
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
  v_expired    numeric;
  v_avail      numeric;
  v_ss         numeric;
  v_lead       int;
  v_pack       numeric;
  v_period_start date;
  v_issues     numeric[];
  v_receipts   numeric[];
  v_pab        numeric[];
  v_first      int := null;
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

  -- org guard (skipped for the service/superuser context where auth.uid() is null)
  if (select auth.uid()) is not null
     and v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org access to item %', p_item using errcode = '42501';
  end if;

  select coalesce(safety_stock, 0), coalesce(lead_time_days, 0), coalesce(nullif(pack_size, 0), 1)
    into v_ss, v_lead, v_pack
    from public.inventory_items where id = p_item;

  -- expired stock nets out of availability
  select coalesce(sum(qty), 0) into v_expired
    from public.inventory_movements
    where item_id = p_item and location = p_location and type = 'expiry';

  v_avail := v_onhand - v_reserved - v_expired;

  -- Reference origin = the EARLIEST demanding operation date for this item, so the
  -- first planned consumption always lands in period 1 ("next week" in the oracle).
  -- Demand buckets are 7-day windows [origin + 7*(t-1), origin + 7*t); an op on the
  -- origin day → period 1, +7 days → period 2, etc.
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

  -- planned demand bucketed into weekly periods [period_start + 7*(t-1), +7*t)
  v_issues := array_fill(0::numeric, array[p_horizon_weeks]);
  for i, v_shortfall in
    select
      least(greatest(floor((po.planned_at - v_period_start) / 7.0)::int + 1, 1), p_horizon_weeks) as bucket,
      sum(pmr.qty) as q
    from public.plan_operations po
    join public.plan_material_requirements pmr on pmr.plan_op_id = po.id
    join public.plans p on p.id = po.plan_id
    where pmr.item_id = p_item
      and p.org_id = v_org
      and po.status in ('planned','reserved','ready')
      and p.status in ('draft','active','approved')
    group by 1
  loop
    v_issues[i] := coalesce(v_issues[i], 0) + v_shortfall;
  end loop;

  -- scheduled receipts (future-dated receipt movements) bucketed the same way
  v_receipts := array_fill(0::numeric, array[p_horizon_weeks]);
  for i, v_shortfall in
    select
      least(greatest(floor((m.occurred_at::date - v_period_start) / 7.0)::int + 1, 1), p_horizon_weeks) as bucket,
      sum(m.qty) as q
    from public.inventory_movements m
    where m.item_id = p_item and m.location = p_location
      and m.type = 'receipt'
      and m.occurred_at::date >= v_period_start
    group by 1
  loop
    v_receipts[i] := coalesce(v_receipts[i], 0) + v_shortfall;
  end loop;
  v_shortfall := 0; -- reset (reused as loop var above)

  -- PAB recurrence: v_pab[1] = opening; v_pab[t+1] = v_pab[t] - issues[t] + receipts[t]
  v_pab := array[v_avail];
  for i in 1 .. p_horizon_weeks loop
    v_pab := v_pab || (v_pab[i] - coalesce(v_issues[i], 0) + coalesce(v_receipts[i], 0));
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
    v_stockout := (v_period_start::timestamptz + (v_avail / v_daily) * interval '1 day');
  end if;

  -- recommendation = max(0, shortfall + SS − scheduled receipts in period 1), round up to pack
  v_raw := greatest(0, v_shortfall + v_ss - coalesce(v_receipts[1], 0));
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

revoke all on function public.fn_stock_coverage(uuid, text, int) from public;
revoke all on function public.fn_bin_rebuild(uuid, text) from public;
grant execute on function public.fn_stock_coverage(uuid, text, int) to authenticated;
grant execute on function public.fn_bin_rebuild(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Client-role table grants (the standard Supabase public-schema grant set).
-- In this environment the default privileges only handed `authenticated`/`anon`
-- the Dxtm subset (TRUNCATE/REFERENCES/TRIGGER) — NOT SELECT/INSERT/UPDATE/DELETE
-- — so RLS-scoped client queries were denied at the privilege layer before RLS
-- could even evaluate. RLS (deny-by-default, enabled in Phase B) remains the
-- actual tenant boundary; these grants only let the policies run. Additive only:
-- no Phase B migration is modified.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;

-- Re-assert audit_log immutability (AP-4) AFTER the blanket grant above, mirroring
-- migration 0008's hardening: the ONLY writer is the SECURITY DEFINER trigger, so a
-- client INSERT/UPDATE/DELETE/TRUNCATE must be a hard privilege error (42501), not a
-- silently-empty RLS filter. (Re-applied here only because the broad grant re-opened it.)
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;
