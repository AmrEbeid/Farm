-- SPEC-0033 R4a: two exact, bounded, active-organisation snapshots for the inventory LIST
-- (`/inventory`) and the inventory ITEM 360 (`/inventory/[itemId]`).
--
-- WHY THIS EXISTS. Both pages currently read `inventory_items` unbounded, join `inventory_bin`
-- through PostgREST and then take `inventory_bin[0]` in JavaScript — so an item stored across two
-- physical locations reported the FIRST bin's balance as if it were the whole stock. That is a
-- wrong number on the surface an owner uses to decide a purchase, and a wrong number on the surface
-- a storekeeper would use to decide an issue. Every balance below sums EVERY bin of the item.
--
-- ROLE-SEPARATED PAYLOAD, DECIDED IN POSTGRESQL, NOT IN REACT.
-- A storekeeper must be able to run the store from these two pages without ever receiving money,
-- counterparty identity, purchase free text or a person. Hiding those fields in the component is not
-- a control: the bytes still reach the browser and show up in the network tab, the RSC payload and
-- any cache. So the scope is resolved from the caller's real membership row and the money/identity
-- keys are NOT BUILT AT ALL for the operational scope:
--   * scope 'operational' — storekeeper. No unit_cost, no est_cost, no valuation, no supplier, no
--     purchase reason, no requested_by/approved_by, and no purchase-request id (so no link to the
--     money-bearing purchase-request page can even be constructed).
--   * scope 'finance'     — every other member role. Preserves EXACTLY the money and preferred-
--     supplier capability those roles have today, because the enforced policy for `/inventory*` is
--     still `requireMembership()` (docs/PERMISSIONS-MATRIX.md, "read-broad, write-gated"). Narrowing
--     it further (for example taking cost away from supervisor) would be a policy change and is
--     deliberately NOT smuggled into a UI slice.
--
-- HONESTY CONTRACT (docs/CLAUDE.md #1).
--   * An item with NO bin row at all is `unknown`: its balance is JSON null, never 0. "We have never
--     recorded a balance" is not "we have none", and on a reorder screen the difference is a
--     purchase decision.
--   * An item with no POSITIVE recorded threshold is `no_threshold` — there is nothing to read it
--     against, so it is neither below reorder nor confirmed ok.
--   * A NULL unit_cost is unknown cost, never 0. Valuation therefore EXCLUDES those items and
--     publishes the size of the gap beside the total, so the figure can never read as complete.
--   * Every count is an exact count of RECORDED rows in the active organisation.
--
-- THIS IS NOT THE COVERAGE ENGINE, AND IS NEVER CALLED "COVERAGE".
-- `below_reorder` compares the sum of all bins (on_hand - reserved) against a positive
-- `coalesce(reorder_point, min_stock)`. It is a POINT-IN-TIME threshold reading. It knows nothing
-- about planned demand or scheduled receipts, so it can be quiet for an item `fn_stock_coverage`
-- would call short. Running `fn_stock_coverage` once per listed row would also be an N+1 of the
-- heaviest RPC in the system. The per-item coverage page remains the only place a coverage verdict
-- is stated.
--
-- BOUNDS. The list is paginated server-side (limit/offset) and publishes its exact totals SEPARATELY
-- from the bounded rows, so a truncated page can never be mistaken for the whole book. The item 360
-- bounds its movement and purchase samples INDEPENDENTLY and publishes each exact total beside its
-- sample. Every physical location of the item is returned in full, because an aggregate that hides a
-- bin is the bug this migration exists to fix; a pathological bin count fails loudly instead of
-- silently truncating.
--
-- Counts and decimals leave PostgreSQL as TEXT. A JS number cannot represent every bigint, and a
-- binary double cannot represent every `numeric`.

begin;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 1) EXACT INVENTORY LIST SNAPSHOT
-- ───────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_inventory_list_snapshot(
  p_org uuid,
  p_query text default null,
  p_filter text default 'all',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_active_org uuid;
  v_role text;
  v_scope text;
  v_query text;
  v_pattern text;
  v_result jsonb;
  -- The longest search a person types into a store search box. Anything longer is not a search.
  v_max_query constant integer := 60;
  -- The raw ceiling, refused before the value is trimmed or escaped. Generous enough that trailing
  -- whitespace from a paste is still a legal search, tight enough that no unbounded string is ever
  -- processed.
  v_max_raw_query constant integer := 200;
begin
  if p_org is null then
    raise exception 'organization is required' using errcode = '23502';
  end if;
  if p_filter is null or p_filter not in ('all', 'below_reorder', 'unknown', 'uncosted') then
    raise exception 'unknown inventory list filter' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'inventory list limit must be between 1 and 50' using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 1000000 then
    raise exception 'inventory list offset is out of range' using errcode = '22023';
  end if;

  begin
    v_active_org := nullif(
      nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'active_org_id',
      ''
    )::uuid;
  exception when others then
    raise exception 'forbidden: invalid active organization claim' using errcode = '42501';
  end;

  if v_uid is null or v_active_org is null or v_active_org is distinct from p_org then
    raise exception 'forbidden: inventory list requires the active organization' using errcode = '42501';
  end if;
  select m.role into v_role
    from public.organization_member m
   where m.user_id = v_uid and m.org_id = p_org;
  if v_role is null then
    raise exception 'forbidden: organization membership is required' using errcode = '42501';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: organization is outside the active scope' using errcode = '42501';
  end if;

  -- The scope decides which KEYS EXIST in the result, not which keys are hidden later.
  v_scope := case when v_role = 'storekeeper' then 'operational' else 'finance' end;

  -- A filter must be legal for the caller's scope. «بلا تكلفة» is a finance question; offering it to
  -- a storekeeper would both be useless and confirm the existence of cost data to that role.
  if p_filter = 'uncosted' and v_scope <> 'finance' then
    raise exception 'forbidden: this inventory filter is not available to this role' using errcode = '42501';
  end if;

  -- Bounded BEFORE any string work touches it. `btrim`/`replace` on an unbounded value would be real
  -- server work performed on behalf of a request that was always going to be refused, so the raw
  -- length is refused first and the trimmed length second.
  if p_query is not null and pg_catalog.length(p_query) > v_max_raw_query then
    raise exception 'inventory search text is too long' using errcode = '22023';
  end if;
  v_query := nullif(pg_catalog.btrim(coalesce(p_query, '')), '');
  if v_query is not null and pg_catalog.length(v_query) > v_max_query then
    raise exception 'inventory search text is too long' using errcode = '22023';
  end if;
  -- LIKE metacharacters are escaped so a typed '%' searches for a per-cent sign rather than matching
  -- everything. The value is a bound parameter throughout: it is never concatenated into SQL text.
  v_pattern := case
    when v_query is null then null
    else '%' || pg_catalog.replace(
                  pg_catalog.replace(
                    pg_catalog.replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  -- Active-organisation relationship integrity fails CLOSED for the only join this contract makes.
  -- A bin row in this organisation whose item belongs elsewhere would import a foreign balance into
  -- an aggregate this page presents as the whole truth, so nothing is summarised until it is gone.
  --
  -- Only the FORWARD direction is checkable here, and saying so matters. This function is SECURITY
  -- INVOKER, so a bin row belonging to ANOTHER organisation is invisible to the caller's RLS and no
  -- query written here could ever see it. Writing that check anyway would look like a control and be
  -- none. The reverse relationship stays prohibited where it is actually enforced: the cross-org
  -- write invariants on the tables themselves.
  if exists (
    select 1 from public.inventory_bin b
    left join public.inventory_items i on i.id = b.item_id and i.org_id = p_org
    where b.org_id = p_org and i.id is null
  ) then
    raise exception 'inventory list organization relationship mismatch' using errcode = '23514';
  end if;

  with
  base as materialized (
    select i.id, i.name, i.category, i.unit, i.unit_cost, i.reorder_point, i.min_stock
      from public.inventory_items i
     where i.org_id = p_org
  ),
  matched as materialized (
    select b.*
      from base b
     where v_pattern is null
        or b.name ilike v_pattern escape '\'
        or coalesce(b.category, '') ilike v_pattern escape '\'
  ),
  -- EVERY bin of the item contributes. `count(b.item_id)` counts only real bin rows, so the left
  -- join cannot turn "no recorded balance" into a zero balance.
  stocked as materialized (
    select m.id, m.name, m.category, m.unit, m.unit_cost,
           pg_catalog.count(b.item_id)::bigint as bin_count,
           coalesce(sum(b.on_hand), 0) as on_hand,
           coalesce(sum(b.reserved), 0) as reserved,
           coalesce(sum(b.on_hand), 0) - coalesce(sum(b.reserved), 0) as available,
           case when m.reorder_point is not null then m.reorder_point
                when m.min_stock is not null then m.min_stock
                else null end as threshold,
           case when m.reorder_point is not null then 'reorder_point'
                when m.min_stock is not null then 'min_stock'
                else null end as threshold_source
      from matched m
      left join public.inventory_bin b on b.item_id = m.id and b.org_id = p_org
     group by m.id, m.name, m.category, m.unit, m.unit_cost, m.reorder_point, m.min_stock
  ),
  -- Four states, mutually exclusive and jointly exhaustive, so the chips always reconcile.
  classified as materialized (
    select s.*,
           case
             when s.bin_count = 0 then 'unknown'
             when s.threshold is null or s.threshold <= 0 then 'no_threshold'
             when s.available < s.threshold then 'below_reorder'
             else 'ok'
           end as state
      from stocked s
  ),
  query_counts as (
    select pg_catalog.count(*)::bigint as query_total,
           pg_catalog.count(*) filter (where c.state = 'below_reorder')::bigint as below_reorder,
           pg_catalog.count(*) filter (where c.state = 'unknown')::bigint as unknown_stock,
           pg_catalog.count(*) filter (where c.state = 'no_threshold')::bigint as no_threshold,
           pg_catalog.count(*) filter (where c.state = 'ok')::bigint as ok_stock,
           pg_catalog.count(*) filter (where c.unit_cost is null)::bigint as uncosted
      from classified c
  ),
  -- Honest valuation: only an item with BOTH a recorded balance and a recorded unit cost can be
  -- valued. The two ways an item can be missing from the total are published as separate counts, so
  -- the figure always carries the size of its own gap.
  valuation as (
    select coalesce(sum(c.on_hand * c.unit_cost)
             filter (where c.unit_cost is not null and c.bin_count > 0), 0) as known_total,
           pg_catalog.count(*) filter (where c.unit_cost is not null and c.bin_count > 0)::bigint as valued_items,
           pg_catalog.count(*) filter (where c.unit_cost is null and c.bin_count > 0)::bigint as unknown_cost_items,
           pg_catalog.count(*) filter (where c.bin_count = 0)::bigint as unknown_stock_items
      from classified c
  ),
  filtered as materialized (
    select c.*
      from classified c
     where case p_filter
             when 'below_reorder' then c.state = 'below_reorder'
             when 'unknown' then c.state = 'unknown'
             when 'uncosted' then c.unit_cost is null
             else true
           end
  ),
  -- Deterministic total order: exceptions first, then Arabic name, then id as the final tiebreak.
  -- A stable order is what makes limit/offset paging correct rather than merely plausible.
  page as materialized (
    select f.*
      from filtered f
     order by case f.state
                when 'below_reorder' then 0
                when 'unknown' then 1
                when 'no_threshold' then 2
                else 3
              end,
              f.name, f.id
     limit p_limit offset p_offset
  ),
  authority as (
    select jsonb_object_agg(a.domain, a.status) as statuses
      from public.data_authority_status a
     where a.org_id = p_org and a.domain = 'inventory'
  )
  select jsonb_build_object(
    'version', 'farm-os.inventory-list.v1',
    'org_id', p_org,
    'scope', v_scope,
    'query', v_query,
    'filter', p_filter,
    'limit', p_limit,
    'offset', p_offset,
    'authority', coalesce((select statuses from authority), '{}'::jsonb),
    -- Exact recorded totals, kept strictly separate from the bounded page below.
    'counts', jsonb_build_object(
      'total_items', (select pg_catalog.count(*)::text from base),
      'query_total', (select query_total::text from query_counts),
      'matching', (select pg_catalog.count(*)::text from filtered),
      'below_reorder', (select below_reorder::text from query_counts),
      'unknown_stock', (select unknown_stock::text from query_counts),
      'no_threshold', (select no_threshold::text from query_counts),
      'ok_stock', (select ok_stock::text from query_counts)
    ) || case when v_scope = 'finance'
           then jsonb_build_object('uncosted', (select uncosted::text from query_counts))
           else '{}'::jsonb end,
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'item_id', p.id::text,
          'name', p.name,
          'category', p.category,
          'unit', p.unit,
          'state', p.state,
          'bin_count', p.bin_count::text,
          -- NULL, not 0, whenever no bin row exists at all.
          'on_hand', case when p.bin_count = 0 then null else p.on_hand::text end,
          'reserved', case when p.bin_count = 0 then null else p.reserved::text end,
          'available', case when p.bin_count = 0 then null else p.available::text end,
          -- The recorded policy is published even for an unknown balance: the threshold IS recorded,
          -- it simply has nothing to be read against yet.
          'threshold', p.threshold::text,
          'threshold_source', p.threshold_source
        ) || case when v_scope = 'finance' then jsonb_build_object(
               'unit_cost', p.unit_cost::text,
               'valuation', case when p.unit_cost is null or p.bin_count = 0
                                 then null else (p.on_hand * p.unit_cost)::text end
             ) else '{}'::jsonb end
        order by case p.state
                   when 'below_reorder' then 0
                   when 'unknown' then 1
                   when 'no_threshold' then 2
                   else 3
                 end,
                 p.name, p.id
      ) from page p
    ), '[]'::jsonb)
  ) || case when v_scope = 'finance' then jsonb_build_object(
         'valuation', jsonb_build_object(
           'known_total', (select known_total::text from valuation),
           'valued_items', (select valued_items::text from valuation),
           'unknown_cost_items', (select unknown_cost_items::text from valuation),
           'unknown_stock_items', (select unknown_stock_items::text from valuation)
         )
       ) else '{}'::jsonb end
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.fn_inventory_list_snapshot(uuid, text, text, integer, integer) from public;
revoke all on function public.fn_inventory_list_snapshot(uuid, text, text, integer, integer) from anon;
grant execute on function public.fn_inventory_list_snapshot(uuid, text, text, integer, integer) to authenticated;

comment on function public.fn_inventory_list_snapshot(uuid, text, text, integer, integer) is
  'Exact bounded inventory list snapshot for the active organization: exact totals and exact state counts separate from one deterministically ordered limit/offset page; all-bin on_hand/reserved/available with an explicit unknown state that is never zero; a point-in-time reorder-threshold reading that is never called coverage. Storekeepers receive the operational scope, whose JSON contains no cost, valuation, supplier, purchase free text or person key at all.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 2) EXACT INVENTORY ITEM 360 SNAPSHOT
-- ───────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_inventory_item_snapshot(
  p_org uuid,
  p_item uuid,
  p_movement_limit integer default 10,
  p_purchase_limit integer default 10
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_active_org uuid;
  v_role text;
  v_scope text;
  v_bin_count bigint;
  v_result jsonb;
  -- One item's physical locations are operator-created and few. Returning every one of them is the
  -- point of this contract, so there is no silent truncation: an item beyond this ceiling is a data
  -- problem that must be seen, not a page that quietly under-reports its own stock.
  v_max_bins constant integer := 200;
begin
  if p_org is null or p_item is null then
    raise exception 'organization and item are required' using errcode = '23502';
  end if;
  if p_movement_limit is null or p_movement_limit < 1 or p_movement_limit > 50 then
    raise exception 'movement limit must be between 1 and 50' using errcode = '22023';
  end if;
  if p_purchase_limit is null or p_purchase_limit < 1 or p_purchase_limit > 50 then
    raise exception 'purchase limit must be between 1 and 50' using errcode = '22023';
  end if;

  begin
    v_active_org := nullif(
      nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'active_org_id',
      ''
    )::uuid;
  exception when others then
    raise exception 'forbidden: invalid active organization claim' using errcode = '42501';
  end;

  if v_uid is null or v_active_org is null or v_active_org is distinct from p_org then
    raise exception 'forbidden: the inventory item requires the active organization' using errcode = '42501';
  end if;
  select m.role into v_role
    from public.organization_member m
   where m.user_id = v_uid and m.org_id = p_org;
  if v_role is null then
    raise exception 'forbidden: organization membership is required' using errcode = '42501';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: organization is outside the active scope' using errcode = '42501';
  end if;

  v_scope := case when v_role = 'storekeeper' then 'operational' else 'finance' end;

  -- An item outside the active organisation is NOT FOUND, not forbidden: the caller must not be able
  -- to learn from the error whether another organisation happens to own that id.
  if not exists (
    select 1 from public.inventory_items i where i.id = p_item and i.org_id = p_org
  ) then
    return null;
  end if;

  -- Relationship integrity, scoped to this one item. A purchase line in this organisation whose
  -- request belongs elsewhere would be silently dropped by the join below and quietly shrink the
  -- exact purchase total, so it fails closed instead. As on the list, only the forward direction is
  -- checkable under SECURITY INVOKER — a child row in another organisation is invisible to the
  -- caller's RLS, and the reverse relationship stays prohibited by the cross-org write invariants.
  if exists (
    select 1 from public.purchase_request_items l
    left join public.purchase_requests pr on pr.id = l.pr_id and pr.org_id = p_org
    where l.org_id = p_org and l.item_id = p_item and pr.id is null
  ) then
    raise exception 'inventory item organization relationship mismatch' using errcode = '23514';
  end if;

  -- Supplier identity exists only in the finance payload. If the recorded preferred supplier cannot
  -- be resolved inside this organization, returning NULL would silently turn corruption into "not
  -- recorded". The operational scope neither reads nor validates that finance-only relationship.
  if v_scope = 'finance' and exists (
    select 1
      from public.inventory_items i
      left join public.suppliers s
        on s.id = i.preferred_supplier_id and s.org_id = p_org
     where i.id = p_item and i.org_id = p_org
       and i.preferred_supplier_id is not null and s.id is null
  ) then
    raise exception 'inventory item preferred supplier organization mismatch' using errcode = '23514';
  end if;

  select pg_catalog.count(*) into v_bin_count
    from public.inventory_bin b where b.item_id = p_item and b.org_id = p_org;
  if v_bin_count > v_max_bins then
    raise exception 'inventory item has more physical locations than this contract publishes'
      using errcode = '22023';
  end if;

  with
  item as materialized (
    select i.id, i.name, i.category, i.unit, i.pack_size, i.criticality, i.expiry_tracked,
           i.min_stock, i.max_stock, i.safety_stock, i.reorder_point, i.reorder_qty,
           i.lead_time_days, i.unit_cost, i.preferred_supplier_id
      from public.inventory_items i
     where i.id = p_item and i.org_id = p_org
  ),
  bins as materialized (
    select b.location, b.on_hand, b.reserved, b.ordered, b.projected
      from public.inventory_bin b
     where b.item_id = p_item and b.org_id = p_org
  ),
  -- The aggregate is over EVERY location. This is the whole reason the RPC exists.
  stock as (
    select pg_catalog.count(*)::bigint as bin_count,
           coalesce(sum(b.on_hand), 0) as on_hand,
           coalesce(sum(b.reserved), 0) as reserved,
           coalesce(sum(b.ordered), 0) as ordered,
           coalesce(sum(b.projected), 0) as projected,
           coalesce(sum(b.on_hand), 0) - coalesce(sum(b.reserved), 0) as available
      from bins b
  ),
  policy as (
    select case when i.reorder_point is not null then i.reorder_point
                when i.min_stock is not null then i.min_stock
                else null end as threshold,
           case when i.reorder_point is not null then 'reorder_point'
                when i.min_stock is not null then 'min_stock'
                else null end as threshold_source
      from item i
  ),
  state as (
    select case
             when s.bin_count = 0 then 'unknown'
             when p.threshold is null or p.threshold <= 0 then 'no_threshold'
             when s.available < p.threshold then 'below_reorder'
             else 'ok'
           end as state
      from stock s cross join policy p
  ),
  movement_total as (
    select pg_catalog.count(*)::bigint as total
      from public.inventory_movements mv
     where mv.org_id = p_org and mv.item_id = p_item
  ),
  -- Bounded INDEPENDENTLY of the purchase sample, most recent first, id as the final tiebreak so two
  -- movements recorded in the same instant still have one stable order.
  movement_rows as materialized (
    select mv.id, mv.type, mv.qty, mv.unit, mv.location, mv.occurred_at,
           mv.batch_no, mv.expiry_date, mv.unit_cost
      from public.inventory_movements mv
     where mv.org_id = p_org and mv.item_id = p_item
     order by mv.occurred_at desc, mv.id desc
     limit p_movement_limit
  ),
  purchase_lines as materialized (
    select l.id, l.qty, coalesce(l.received_qty, 0) as received_qty,
           case when l.qty is null then null else l.qty - coalesce(l.received_qty, 0) end as remaining,
           l.unit, l.est_cost,
           pr.id as pr_id, pr.code, pr.status, pr.needed_by, pr.reason,
           exists (
             select 1
               from public.purchase_request_items sibling
              where sibling.org_id = p_org and sibling.pr_id = pr.id and sibling.qty is null
           ) as request_has_unquantified_line
      from public.purchase_request_items l
      join public.purchase_requests pr on pr.id = l.pr_id and pr.org_id = p_org
     where l.org_id = p_org and l.item_id = p_item
  ),
  purchase_total as (
    select pg_catalog.count(*)::bigint as total,
           -- "Still owes a quantified amount on a request the receipt RPC will claim". An
           -- unquantified line is visible in the relation history, but fn_post_receipt rejects it;
           -- it must not inflate the 360's "waiting for receipt" count.
           pg_catalog.count(*) filter (
             where pl.status in ('approved', 'partially_received')
               and pl.remaining > 0
               and not pl.request_has_unquantified_line
           )::bigint as open_total
      from purchase_lines pl
  ),
  purchase_rows as materialized (
    select pl.*
      from purchase_lines pl
     order by pl.needed_by desc nulls last, pl.code desc, pl.id desc
     limit p_purchase_limit
  ),
  authority as (
    select jsonb_object_agg(a.domain, a.status) as statuses
      from public.data_authority_status a
     where a.org_id = p_org and a.domain = 'inventory'
  )
  select jsonb_build_object(
    'version', 'farm-os.inventory-item.v1',
    'org_id', p_org,
    'item_id', p_item,
    'scope', v_scope,
    'movement_limit', p_movement_limit,
    'purchase_limit', p_purchase_limit,
    'authority', coalesce((select statuses from authority), '{}'::jsonb),
    'item', (select jsonb_build_object(
       'name', i.name,
       'category', i.category,
       'unit', i.unit,
       'pack_size', i.pack_size::text,
       'criticality', i.criticality,
       'expiry_tracked', i.expiry_tracked
     ) from item i),
    -- Recorded policy. Every value is text or JSON null; a missing policy value is unknown, never 0.
    'policy', (select jsonb_build_object(
       'min_stock', i.min_stock::text,
       'max_stock', i.max_stock::text,
       'safety_stock', i.safety_stock::text,
       'reorder_point', i.reorder_point::text,
       'reorder_qty', i.reorder_qty::text,
       'lead_time_days', i.lead_time_days::text,
       'threshold', (select threshold::text from policy),
       'threshold_source', (select threshold_source from policy)
     ) from item i),
    'stock', (select jsonb_build_object(
       'bin_count', s.bin_count::text,
       'state', (select state from state),
       'on_hand', case when s.bin_count = 0 then null else s.on_hand::text end,
       'reserved', case when s.bin_count = 0 then null else s.reserved::text end,
       'available', case when s.bin_count = 0 then null else s.available::text end,
       'ordered', case when s.bin_count = 0 then null else s.ordered::text end,
       'projected', case when s.bin_count = 0 then null else s.projected::text end
     ) from stock s),
    -- Every physical location, in full, deterministically ordered. `locations` and `bin_count` must
    -- agree; that equality is what proves no bin was dropped on the way to the aggregate.
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'location', b.location,
        'on_hand', b.on_hand::text,
        'reserved', b.reserved::text,
        'available', (b.on_hand - b.reserved)::text,
        'ordered', b.ordered::text,
        'projected', b.projected::text
      ) order by b.location) from bins b
    ), '[]'::jsonb),
    'movements', jsonb_build_object(
      'total', (select total::text from movement_total),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', mr.id::text,
            'type', mr.type,
            'qty', mr.qty::text,
            'unit', mr.unit,
            'location', mr.location,
            'occurred_on', (mr.occurred_at at time zone 'Africa/Cairo')::date::text,
            'batch_no', mr.batch_no,
            'expiry_date', mr.expiry_date::text
          ) || case when v_scope = 'finance'
                 then jsonb_build_object('unit_cost', mr.unit_cost::text)
                 else '{}'::jsonb end
          order by mr.occurred_at desc, mr.id desc
        ) from movement_rows mr
      ), '[]'::jsonb)
    ),
    'purchases', jsonb_build_object(
      'total', (select total::text from purchase_total),
      'open_total', (select open_total::text from purchase_total),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', pr.id::text,
            'code', pr.code,
            'status', pr.status,
            'needed_by', pr.needed_by::text,
            'ordered', pr.qty::text,
            'received', pr.received_qty::text,
            'remaining', pr.remaining::text,
            'unit', pr.unit,
            'item_unit', (select i.unit from item i)
          ) || case when v_scope = 'finance' then jsonb_build_object(
                 -- The purchase-request id is published ONLY here, because the only thing it is for
                 -- is a link to the money-bearing purchase-request page.
                 'pr_id', pr.pr_id::text,
                 'est_cost', pr.est_cost::text,
                 'reason', pr.reason
               ) else '{}'::jsonb end
          order by pr.needed_by desc nulls last, pr.code desc, pr.id desc
        ) from purchase_rows pr
      ), '[]'::jsonb)
    )
  ) || case when v_scope = 'finance' then jsonb_build_object(
         'unit_cost', (select i.unit_cost::text from item i),
         'valuation', (select case when i.unit_cost is null or s.bin_count = 0
                                   then null else (s.on_hand * i.unit_cost)::text end
                         from item i cross join stock s),
         'supplier', (select case when sup.id is null then null else jsonb_build_object(
                          'name', sup.name,
                          'lead_time_days', sup.lead_time_days::text
                        ) end
                        from item i
                        left join public.suppliers sup
                          on sup.id = i.preferred_supplier_id and sup.org_id = p_org)
       ) else '{}'::jsonb end
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.fn_inventory_item_snapshot(uuid, uuid, integer, integer) from public;
revoke all on function public.fn_inventory_item_snapshot(uuid, uuid, integer, integer) from anon;
grant execute on function public.fn_inventory_item_snapshot(uuid, uuid, integer, integer) to authenticated;

comment on function public.fn_inventory_item_snapshot(uuid, uuid, integer, integer) is
  'Exact inventory item 360 snapshot for the active organization: identity, recorded reorder policy, an all-bin aggregate whose unknown state is never zero, every physical location in full, and independently bounded recent movements and related purchase lines each published beside their exact recorded total. Returns null when the item is outside the active organization. Storekeepers receive the operational scope, whose JSON contains no cost, valuation, supplier, purchase reason or purchase-request id at all.';

commit;
