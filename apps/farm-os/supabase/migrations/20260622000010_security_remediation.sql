-- Farm OS MVP-0 — Security remediation (independent review, 2026-06-23).
--
-- Additive-only. Closes findings from the independent security review of the MVP-0
-- build (RLS / grants / stock engine). Each block is annotated with the finding id.
-- Reviewed by: independent adversarial subagents (RLS, grants, engine) + verification
-- against SPEC-0001 and the existing pgTAP oracles. Owner sign-off required before merge.
--
--   GRANT-C1  remove the unauthenticated `anon` role from the blanket public-schema
--             DML / sequence / EXECUTE grants in migration 0009. `anon` (the public
--             pre-login PostgREST role) has NO policy `TO anon` anywhere, so it never
--             needed table or function access; the grant was a defense-in-depth
--             collapse (one future table missing RLS = world-read/write) and exposed
--             the SECURITY DEFINER engine to unauthenticated RPC (see ENGINE-guard).
--   ENGINE-C1 fn_stock_coverage double-subtracted expiry: `inventory_bin.on_hand`
--             already nets expiry (fn_bin_rebuild + the SC-6 reconciliation oracle put
--             `expiry` in the negative movement set), so `available = on_hand - reserved
--             - Σ(expiry)` subtracted it twice. Corrected to `available = on_hand -
--             reserved`. (A separate "expired-but-not-yet-written-off" overlay keyed on
--             batch expiry_date is deferred — it needs batch/FEFO tracking not in MVP-0.)
--   ENGINE-H1 phantom purchase recommendation: an item with safety_stock>0 and ample
--             stock / zero demand was told to "order today" because the recommendation
--             fired on `SS - receipts` even with no shortage. Now it fires only when the
--             projected balance actually dips below safety stock within the horizon.
--   ENGINE-H2 demand/receipts scheduled BEYOND the horizon were clamped into the last
--             period (fabricating an in-horizon shortage). Now filtered out.
--   ENGINE-SS new `first_warning_period` output (SPEC-0001 §1: "an earlier warning at
--             < safety_stock"), which was specified but never emitted.
--   ENGINE-guard defense-in-depth: the org guard skipped when auth.uid() is null
--             (the trusted service/superuser path). Add an explicit `anon` block so an
--             unauthenticated JWT can never reach the RLS-bypassing definer body even if
--             a future grant re-opens EXECUTE.
--   RLS-H1    child tables (event_*, quantities, plan_*_requirements, budget_lines,
--             purchase_request_items) only checked the row's OWN org_id, never the
--             parent's. A member of org A could write a child row tagged org A but
--             pointing at org B's parent (cross-tenant write / data injection). Add a
--             WITH CHECK that the referenced parent is in the same org.

-- ===========================================================================
-- GRANT-C1 — revoke the over-broad `anon` grants from migration 0009.
-- (authenticated keeps its grants — RLS is the tenant boundary for it;
--  service_role keeps its grants — it is server-only and bypasses RLS by design.)
-- ===========================================================================
revoke select, insert, update, delete on all tables in schema public from anon;
revoke usage, select on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
-- `grant usage on schema public to anon` is retained (harmless; PostgREST needs it),
-- but with no table/function privileges anon cannot read, write, or call anything.

-- ===========================================================================
-- ENGINE — re-define fn_stock_coverage with ENGINE-C1/H1/H2/SS/guard fixes.
-- fn_bin_rebuild is intentionally left unchanged (its on_hand model is the
-- reconciliation oracle the SC-6 test pins).
-- ===========================================================================
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

  -- scheduled receipts (future-dated receipt movements) bucketed the same way.
  v_receipts := array_fill(0::numeric, array[p_horizon_weeks]);
  for i, v_shortfall in
    select
      greatest(floor((m.occurred_at::date - v_period_start) / 7.0)::int + 1, 1) as bucket,
      sum(m.qty) as q
    from public.inventory_movements m
    where m.item_id = p_item and m.location = p_location
      and m.type = 'receipt'
      and m.occurred_at::date >= v_period_start
      and floor((m.occurred_at::date - v_period_start) / 7.0)::int + 1 <= p_horizon_weeks
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
    v_stockout := (v_period_start::timestamptz + (v_avail / v_daily) * interval '1 day');
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

revoke all on function public.fn_stock_coverage(uuid, text, int) from public;
grant execute on function public.fn_stock_coverage(uuid, text, int) to authenticated;

-- ===========================================================================
-- RLS-H1 — child tables: validate the referenced PARENT is in the same org, not
-- just the child row's own org_id. Recreate each tenant_all policy with a
-- parent-org WITH CHECK. (USING stays org-scoped: a foreign-org child tagged with
-- the attacker's org_id is their own junk and is invisible to the victim anyway;
-- the hole is the WRITE, so the parent check goes in WITH CHECK.)
-- ===========================================================================

-- event children -> farm_event (event_id). event_id has no FK (farm_event is
-- partitioned, PK (id, occurred_at)); the EXISTS check is the integrity boundary.
do $$
declare t text;
begin
  foreach t in array array['event_assets','event_locations','quantities',
                           'event_status_history','event_followups','event_attachments'] loop
    execute format('drop policy if exists tenant_all on public.%I', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (
        org_id in (select public.user_org_ids())
        and exists (select 1 from public.farm_event e
                    where e.id = %I.event_id and e.org_id = %I.org_id)
      )$p$, t, t, t);
  end loop;
end $$;

-- plan requirement children -> plan_operations (plan_op_id)
do $$
declare t text;
begin
  foreach t in array array['plan_material_requirements','plan_labor_requirements'] loop
    execute format('drop policy if exists tenant_all on public.%I', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (
        org_id in (select public.user_org_ids())
        and exists (select 1 from public.plan_operations po
                    where po.id = %I.plan_op_id and po.org_id = %I.org_id)
      )$p$, t, t, t);
  end loop;
end $$;

-- budget_lines -> budgets (budget_id)
drop policy if exists tenant_all on public.budget_lines;
create policy tenant_all on public.budget_lines for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and exists (select 1 from public.budgets b
                where b.id = budget_lines.budget_id and b.org_id = budget_lines.org_id)
  );

-- purchase_request_items -> purchase_requests (pr_id)
drop policy if exists tenant_all on public.purchase_request_items;
create policy tenant_all on public.purchase_request_items for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and exists (select 1 from public.purchase_requests pr
                where pr.id = purchase_request_items.pr_id and pr.org_id = purchase_request_items.org_id)
  );
