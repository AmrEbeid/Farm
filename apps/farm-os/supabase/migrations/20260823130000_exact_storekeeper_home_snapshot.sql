-- SPEC-0033 R3f: one exact, bounded, storekeeper-only snapshot of the STORE DAY.
-- Counts leave PostgreSQL as text; no finance value of any kind is exposed (no est_cost, no
-- unit_cost, no supplier terms, no price/amount/rate), and no person is named anywhere.
--
-- HONESTY CONTRACT (docs/CLAUDE.md #1). Every number here is an EXACT COUNT OF RECORDED ROWS in the
-- active organisation. It is never a claim that the store is fully counted, nor that every physical
-- movement has been recorded, nor that stock on the shelf matches the book.
--
-- WHAT THIS DELIBERATELY DOES NOT COUNT: COMPLETED STOCK-TAKES.
-- `fn_record_stock_take` (migration 20260705160000) writes NO provenance row of its own. It posts a
-- reconciling 'adjustment' or 'loss' movement when the count differs from the book, and when the
-- variance is exactly zero it posts NOTHING AT ALL. So there is no stored row that means "a
-- stock-take happened": a perfectly matching count is indistinguishable from never having counted,
-- and an adjustment row is indistinguishable from an ordinary correction posted by hand. Any
-- "stock-takes done today" number would therefore be fabricated, and the most dangerous direction of
-- fabrication too — it would read as "the store has been verified". The stock-take appears in this
-- product ONLY as an available legal action (a link to /inventory/stock-take). The adjustment, loss
-- and expiry rows below are exposed strictly as RECORDED MOVEMENT EVIDENCE and are never labelled a
-- stock-take. The missing provenance is a recorded residual gap, not a migration in this slice.
--
-- RECEIVABILITY MIRRORS fn_post_receipt, IT DOES NOT INVENT GATES.
-- A purchase request enters this snapshot when its status is one of the two the RPC will claim
-- ('approved', 'partially_received') AND either a line still has a positive remaining balance
-- (qty - received_qty) or an unquantified line makes the whole request blocked. `receivable` is true
-- only when the one stored rejection below is absent, and
-- it was read off the CURRENT shipped receipt path — fn_post_receipt as last re-emitted by
-- 20260701210000, plus fn_post_movement as last re-emitted by 20260701180000 — not guessed:
--   * `unquantified_line` — fn_post_receipt loops over EVERY line of the request and raises 22023
--     the moment it meets `qty is null`. One such line makes the WHOLE receipt unpostable, not just
--     that line, because the body is a single transaction. It is fully determined by stored rows.
--
-- A LINE UNIT THAT DIFFERS FROM THE ITEM'S UNIT IS NOT A BLOCKER. It looks like one — fn_post_movement
-- does raise 22023 on a unit mismatch — but since 20260701210000 fn_post_receipt passes NULL as the
-- movement unit precisely so fn_post_movement DEFAULTS to the item's canonical unit. The mismatch can
-- therefore never fire on this path, and calling it a blocker would invent a gate the database does
-- not have. What is true, and what `item_unit` is carried for, is that the receipt is recorded in the
-- ITEM's unit whatever the order line says — so that is the unit the storekeeper must be shown.
--
-- Everything else the RPC can still refuse (an over-receipt of a quantity the storekeeper types in, a
-- concurrent claim of the same request) depends on input or on live state and is NOT preflighted
-- here. The server RPC remains the only enforcement; `receivable` only decides whether the fast
-- receive shortcut is offered, and the UI must never present it as a guarantee that the receipt will
-- post.
--
-- CURRENT STOCK IS A POINT-IN-TIME THRESHOLD READING, NOT THE COVERAGE ENGINE.
-- `below_reorder` compares the sum of ALL bins of an item (every location, on_hand minus reserved)
-- against a POSITIVE `coalesce(reorder_point, min_stock)`. It is not fn_stock_coverage: it knows
-- nothing about planned demand or scheduled receipts, so it can be quiet for an item the engine
-- would call short. Items with NO bin row at all are kept in their own explicit `unknown_stock`
-- bucket — never folded into zero, because "we have never recorded a balance" is not "we have none".
-- An item whose threshold is not positive is in neither bucket: there is no recorded threshold to
-- read it against.
--
-- Today is the current Cairo business date, applied to `occurred_at` in Africa/Cairo. The shrink
-- evidence window is a fixed 7 days ending on that date, and its exact recorded total is published
-- alongside the bounded sample so a truncated list can never read as the whole story.

begin;

create or replace function public.fn_storekeeper_home_snapshot(
  p_org uuid,
  p_as_of date,
  p_detail_limit integer default 6
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
  v_window_days constant integer := 7;
  v_result jsonb;
begin
  if p_org is null or p_as_of is null then
    raise exception 'organization and as-of date are required' using errcode = '23502';
  end if;
  if p_detail_limit is null or p_detail_limit < 1 or p_detail_limit > 20 then
    raise exception 'detail limit must be between 1 and 20' using errcode = '22023';
  end if;
  if p_as_of <> (pg_catalog.now() at time zone 'Africa/Cairo')::date then
    raise exception 'storekeeper home as-of must equal the current Cairo business date' using errcode = '22007';
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
    raise exception 'forbidden: storekeeper home requires the active organization' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_member m
     where m.user_id = v_uid and m.org_id = p_org and m.role = 'storekeeper'
  ) then
    raise exception 'forbidden: storekeeper membership is required' using errcode = '42501';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: organization is outside the active scope' using errcode = '42501';
  end if;

  -- Active-organisation relationship integrity fails CLOSED: a corrupt child row in this organisation
  -- must never be silently summarised into a receivable request or stock reading. Covers every join —
  -- line-to-request, line-to-item, bin-to-item and movement-to-item. Reverse foreign-child links cannot
  -- enter this active-org snapshot and are prevented by the database's cross-org write invariants.
  -- There is no per-row degradation
  -- here (unlike the supervisor's per-operation target) because a corrupt link on this surface would
  -- move real stock into or out of the wrong organisation's book.
  if exists (
    select 1 from public.purchase_request_items l
    left join public.purchase_requests pr on pr.id = l.pr_id and pr.org_id = p_org
    where l.org_id = p_org and pr.id is null
  ) or exists (
    select 1 from public.purchase_request_items l
    left join public.inventory_items i on i.id = l.item_id and i.org_id = p_org
    where l.org_id = p_org and i.id is null
  ) or exists (
    select 1 from public.inventory_bin b
    left join public.inventory_items i on i.id = b.item_id and i.org_id = p_org
    where b.org_id = p_org and i.id is null
  ) or exists (
    select 1 from public.inventory_movements mv
    left join public.inventory_items i on i.id = mv.item_id and i.org_id = p_org
    where mv.org_id = p_org and i.id is null
  ) then
    raise exception 'storekeeper home organization relationship mismatch' using errcode = '23514';
  end if;

  with
  -- Only the two statuses fn_post_receipt will claim. Everything else (draft, submitted, rejected,
  -- received) is not receivable, so it never enters the store day.
  open_prs as materialized (
    select pr.id, pr.code, pr.status, pr.needed_by
      from public.purchase_requests pr
     where pr.org_id = p_org
       and pr.status in ('approved', 'partially_received')
  ),
  pr_lines as materialized (
    select l.pr_id, l.item_id, i.name as item_name, l.unit, i.unit as item_unit,
           l.qty, coalesce(l.received_qty, 0) as received_qty,
           l.qty - coalesce(l.received_qty, 0) as remaining_qty,
           (l.qty is not null and l.qty - coalesce(l.received_qty, 0) > 0) as is_open,
           l.id as line_id
      from public.purchase_request_items l
      join open_prs pr on pr.id = l.pr_id
      join public.inventory_items i on i.id = l.item_id and i.org_id = p_org
     where l.org_id = p_org
  ),
  -- A request is in the store day while it owes stock or has an unquantified line that blocks the
  -- whole receipt. Its recorded blocker is the literal fn_post_receipt rejection documented above.
  classified_prs as materialized (
    select pr.id, pr.code, pr.status, pr.needed_by,
           (select pg_catalog.count(*) from pr_lines l where l.pr_id = pr.id and l.is_open)::bigint as open_line_count,
           exists (
             select 1 from pr_lines l where l.pr_id = pr.id and l.qty is null
           ) as unquantified_line,
           case
             when pr.needed_by is null then 'undated'
             when pr.needed_by < p_as_of then 'overdue'
             when pr.needed_by = p_as_of then 'today'
             else 'upcoming'
           end as urgency
      from open_prs pr
  ),
  receipts as materialized (
    select c.*, (not c.unquantified_line) as receivable
      from classified_prs c
     where c.open_line_count > 0 or c.unquantified_line
  ),
  receipt_summary as (
    select (select pg_catalog.count(*) from receipts)::bigint as open_count,
           (select pg_catalog.count(*) from receipts where receivable)::bigint as receivable_count,
           (select pg_catalog.count(*) from receipts where not receivable)::bigint as blocked_count,
           (select pg_catalog.count(*) from receipts where urgency = 'overdue')::bigint as overdue_count,
           (select pg_catalog.count(*) from receipts where urgency = 'today')::bigint as today_count,
           (select pg_catalog.count(*) from receipts where urgency = 'upcoming')::bigint as upcoming_count,
           (select pg_catalog.count(*) from receipts where urgency = 'undated')::bigint as undated_count,
           (select coalesce(sum(r.open_line_count), 0) from receipts r)::bigint as open_line_count
  ),
  receivable_rows as materialized (
    select r.*, row_number() over (
             order by case r.urgency when 'overdue' then 0 when 'today' then 1 when 'upcoming' then 2 else 3 end,
                      r.needed_by asc nulls last, r.code, r.id
           ) as display_order
      from receipts r where r.receivable
     order by case r.urgency when 'overdue' then 0 when 'today' then 1 when 'upcoming' then 2 else 3 end,
              r.needed_by asc nulls last, r.code, r.id
     limit p_detail_limit
  ),
  blocked_rows as materialized (
    select r.*, row_number() over (
             order by case r.urgency when 'overdue' then 0 when 'today' then 1 when 'upcoming' then 2 else 3 end,
                      r.needed_by asc nulls last, r.code, r.id
           ) as display_order
      from receipts r where not r.receivable
     order by case r.urgency when 'overdue' then 0 when 'today' then 1 when 'upcoming' then 2 else 3 end,
              r.needed_by asc nulls last, r.code, r.id
     limit p_detail_limit
  ),
  all_receipt_rows as materialized (
    select 'receivable' as bucket, r.* from receivable_rows r
    union all
    select 'blocked', r.* from blocked_rows r
  ),
  -- The still-owed lines of each shown request. Bounded INDEPENDENTLY by the same detail limit and
  -- carrying its own exact recorded total, so a truncated sample can never read as the whole order.
  -- Quantities only — the line's est_cost is never read.
  receipt_rows as (
    select r.bucket, r.display_order, r.id, r.code, r.status, r.needed_by, r.urgency,
           r.receivable, r.unquantified_line, r.open_line_count,
           coalesce((
             select jsonb_agg(bounded.entry order by bounded.sort_name, bounded.sort_id)
               from (
                 select l.item_name as sort_name, l.line_id as sort_id, jsonb_build_object(
                          'item_id', l.item_id::text,
                          'item_name', l.item_name,
                          'unit', l.unit,
                          'item_unit', l.item_unit,
                          'ordered', l.qty::text,
                          'received', l.received_qty::text,
                          'remaining', l.remaining_qty::text
                        ) as entry
                   from pr_lines l
                  where l.pr_id = r.id and l.is_open
                  order by l.item_name, l.line_id
                  limit p_detail_limit
               ) bounded
           ), '[]'::jsonb) as lines
      from all_receipt_rows r
  ),
  receipt_json as (
    select d.bucket, jsonb_agg(jsonb_build_object(
             'id', d.id::text,
             'code', d.code,
             'status', d.status,
             'needed_by', d.needed_by::text,
             'urgency', d.urgency,
             'receivable', d.receivable,
             'blockers', (
               case when d.unquantified_line then jsonb_build_array('unquantified_line') else '[]'::jsonb end
             ),
             'open_line_count', d.open_line_count::text,
             'lines', d.lines
           -- Preserve the exact rank assigned before each independent bucket was bounded.
           ) order by d.display_order
         ) as rows
      from receipt_rows d
     group by d.bucket
  ),
  -- Current stock: EVERY bin of the item contributes, and an item with no bin row at all stays
  -- unknown rather than zero.
  item_stock as materialized (
    select i.id, i.name, i.unit,
           pg_catalog.count(b.item_id)::bigint as bin_count,
           coalesce(sum(b.on_hand), 0) - coalesce(sum(b.reserved), 0) as available,
           coalesce(i.reorder_point, i.min_stock, 0) as threshold
      from public.inventory_items i
      left join public.inventory_bin b on b.item_id = i.id and b.org_id = i.org_id
     where i.org_id = p_org
     group by i.id, i.name, i.unit, i.reorder_point, i.min_stock
  ),
  stock_summary as (
    select pg_catalog.count(*) filter (
             where bin_count > 0 and threshold > 0 and available < threshold)::bigint as below_reorder_count,
           pg_catalog.count(*) filter (where bin_count = 0)::bigint as unknown_stock_count
      from item_stock
  ),
  below_reorder_rows as materialized (
    select s.id, s.name, s.unit, s.available, s.threshold, s.bin_count
      from item_stock s
     where s.bin_count > 0 and s.threshold > 0 and s.available < s.threshold
     order by s.available - s.threshold, s.name, s.id
     limit p_detail_limit
  ),
  unknown_stock_rows as materialized (
    select s.id, s.name, s.unit
      from item_stock s
     where s.bin_count = 0
     order by s.name, s.id
     limit p_detail_limit
  ),
  -- Today's recorded OUTBOUND issues. This is what left the store today according to the ledger; it
  -- is not a claim that everything that physically left was recorded.
  issues_today as materialized (
    select mv.id, mv.item_id, i.name as item_name, mv.qty, mv.unit, mv.location, mv.occurred_at
      from public.inventory_movements mv
      join public.inventory_items i on i.id = mv.item_id and i.org_id = p_org
     where mv.org_id = p_org and mv.type = 'issue'
       and (mv.occurred_at at time zone 'Africa/Cairo')::date = p_as_of
  ),
  issue_rows as materialized (
    select t.* from issues_today t
     order by t.occurred_at desc, t.id
     limit p_detail_limit
  ),
  -- Bounded recent movement evidence. These are the leakage-sensitive movement types exactly as
  -- lib/movements-console.ts groups them. A row here is a RECORDED MOVEMENT and nothing more: it is
  -- never presented as a completed stock-take, because no stored row records that a count happened.
  recent_shrink as materialized (
    select mv.id, mv.item_id, i.name as item_name, mv.type, mv.qty, mv.unit, mv.occurred_at
      from public.inventory_movements mv
      join public.inventory_items i on i.id = mv.item_id and i.org_id = p_org
     where mv.org_id = p_org and mv.type in ('adjustment', 'loss', 'expiry')
       and (mv.occurred_at at time zone 'Africa/Cairo')::date
             between (p_as_of - (v_window_days - 1)) and p_as_of
  ),
  shrink_rows as materialized (
    select s.* from recent_shrink s
     order by s.occurred_at desc, s.id
     limit p_detail_limit
  ),
  movement_summary as (
    select (select pg_catalog.count(*) from issues_today)::bigint as issued_today_count,
           (select pg_catalog.count(*) from recent_shrink)::bigint as recent_shrink_count
  ),
  authority as (
    select jsonb_object_agg(a.domain, a.status) as statuses
      from public.data_authority_status a
     where a.org_id = p_org and a.domain = 'inventory'
  )
  select jsonb_build_object(
    'version', 'farm-os.storekeeper-home.v1',
    'org_id', p_org,
    'as_of', p_as_of::text,
    'detail_limit', p_detail_limit,
    'evidence_window_days', v_window_days,
    'authority', coalesce((select statuses from authority), '{}'::jsonb),
    -- `recorded` is deliberately named: these are exact counts of rows RECORDED in this
    -- organisation, not a statement about the physical store.
    'recorded', jsonb_build_object(
      'open_receipts', (select open_count::text from receipt_summary),
      'receivable_now', (select receivable_count::text from receipt_summary),
      'blocked_receipts', (select blocked_count::text from receipt_summary),
      'overdue_receipts', (select overdue_count::text from receipt_summary),
      'due_today_receipts', (select today_count::text from receipt_summary),
      'upcoming_receipts', (select upcoming_count::text from receipt_summary),
      'undated_receipts', (select undated_count::text from receipt_summary),
      'open_receipt_lines', (select open_line_count::text from receipt_summary),
      'issued_today', (select issued_today_count::text from movement_summary),
      'below_reorder', (select below_reorder_count::text from stock_summary),
      'unknown_stock', (select unknown_stock_count::text from stock_summary),
      'recent_shrink', (select recent_shrink_count::text from movement_summary)
    ),
    'drivers', jsonb_build_object(
      'receivable', coalesce((select rows from receipt_json where bucket = 'receivable'), '[]'::jsonb),
      'blocked', coalesce((select rows from receipt_json where bucket = 'blocked'), '[]'::jsonb),
      'below_reorder', coalesce((select jsonb_agg(jsonb_build_object(
        'item_id', id::text, 'name', name, 'unit', unit,
        'available', available::text, 'threshold', threshold::text, 'bin_count', bin_count::text
      ) order by available - threshold, name, id) from below_reorder_rows), '[]'::jsonb),
      'unknown_stock', coalesce((select jsonb_agg(jsonb_build_object(
        'item_id', id::text, 'name', name, 'unit', unit
      ) order by name, id) from unknown_stock_rows), '[]'::jsonb),
      'issued_today', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id::text, 'item_id', item_id::text, 'item_name', item_name,
        'qty', qty::text, 'unit', unit, 'location', location,
        'occurred_on', (occurred_at at time zone 'Africa/Cairo')::date::text
      ) order by occurred_at desc, id) from issue_rows), '[]'::jsonb),
      'recent_shrink', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id::text, 'item_id', item_id::text, 'item_name', item_name,
        'type', type, 'qty', qty::text, 'unit', unit,
        'occurred_on', (occurred_at at time zone 'Africa/Cairo')::date::text
      ) order by occurred_at desc, id) from shrink_rows), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.fn_storekeeper_home_snapshot(uuid, date, integer) from public;
revoke all on function public.fn_storekeeper_home_snapshot(uuid, date, integer) from anon;
grant execute on function public.fn_storekeeper_home_snapshot(uuid, date, integer) to authenticated;

comment on function public.fn_storekeeper_home_snapshot(uuid, date, integer) is
  'Exact bounded storekeeper home snapshot of the RECORDED store day for the active organization and current Cairo business date; open receipts whose receivability mirrors fn_post_receipt, today''s recorded issues, current reorder-threshold and unknown-stock items, and bounded recent movement evidence. No finance value, no person, and no completed-stock-take claim.';

commit;
