-- SPEC-0033 R3f: the storekeeper home is role-exact, active-org-only, current-Cairo-date-only,
-- bounded, finance-free, person-free, and its receivability mirrors the CURRENT shipped
-- fn_post_receipt rather than inventing a gate. It also proves the deliberate ABSENCE of a
-- completed-stock-take claim: fn_record_stock_take writes no provenance row and posts nothing at all
-- when the physical count matches the book, so a stock-take is unobservable and is never counted.
begin;
select no_plan();

\set org '22800000-0000-0000-0000-0000000000a0'
\set org_b '22800000-0000-0000-0000-0000000000b0'
\set item_low '22800000-0000-0000-0000-000000000001'
\set item_ok '22800000-0000-0000-0000-000000000002'
\set item_zero_threshold '22800000-0000-0000-0000-000000000003'
\set item_no_threshold '22800000-0000-0000-0000-000000000004'
\set item_unknown '22800000-0000-0000-0000-000000000005'
\set item_minonly '22800000-0000-0000-0000-000000000006'
\set item_nounit '22800000-0000-0000-0000-000000000007'
\set b_item '22800000-0000-0000-0000-0000000000f1'
\set b_pr '22800000-0000-0000-0000-0000000000f2'

select set_config('test.today', ((pg_catalog.now() at time zone 'Africa/Cairo')::date)::text, false);
select set_config('test.storekeeper', (select user_id::text from public.organization_member where role = 'storekeeper' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member where role = 'farm_manager' limit 1), false);
select set_config('test.owner', (select user_id::text from public.organization_member where role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member where role = 'supervisor' limit 1), false);

insert into public.organization(id, name) values
  (:'org', 'Exact storekeeper home org'),
  (:'org_b', 'Exact storekeeper foreign org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.storekeeper')::uuid, 'storekeeper'),
  (:'org', current_setting('test.manager')::uuid, 'farm_manager'),
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org', current_setting('test.accountant')::uuid, 'accountant'),
  (:'org', current_setting('test.supervisor')::uuid, 'supervisor'),
  (:'org_b', current_setting('test.storekeeper')::uuid, 'storekeeper');
-- Deliberately PARTIAL: an incomplete source must NOT blank an exact recorded count.
insert into public.data_authority_status(org_id, domain, status, source_label, record_count, notes) values
  (:'org', 'inventory', 'partial', 'fixture', 7, 'partial test fixture');

-- ── items: every threshold shape the reorder rule must distinguish ─────────────────────────────
insert into public.inventory_items(id, org_id, name, unit, reorder_point, min_stock) values
  -- reorder_point wins over min_stock; stock is spread across TWO bins
  (:'item_low', :'org', 'سماد اختبار', 'كجم', 10, 5),
  (:'item_ok', :'org', 'مبيد اختبار', 'كجم', 10, null),
  -- reorder_point 0 is NOT a positive threshold, even though min_stock is: coalesce takes the 0
  (:'item_zero_threshold', :'org', 'صنف بحد صفري', 'كجم', 0, 8),
  (:'item_no_threshold', :'org', 'صنف بلا حد', 'كجم', null, null),
  -- no bin row at all → unknown, never zero
  (:'item_unknown', :'org', 'صنف بلا رصيد', 'كجم', 12, null),
  -- min_stock is the threshold when reorder_point is null
  (:'item_minonly', :'org', 'صنف بحد أدنى', 'كجم', null, 4),
  (:'item_nounit', :'org', 'صنف بلا وحدة', null, null, null),
  (:'b_item', :'org_b', 'صنف أجنبي', 'كجم', 1, null);

insert into public.inventory_bin(org_id, item_id, location, on_hand, reserved) values
  -- 4 - 1 + 2 = 5 available across all bins, under the threshold of 10
  (:'org', :'item_low', 'main', 4, 1),
  (:'org', :'item_low', 'store2', 2, 0),
  (:'org', :'item_ok', 'main', 50, 0),
  (:'org', :'item_zero_threshold', 'main', 0, 0),
  (:'org', :'item_no_threshold', 'main', 0, 0),
  (:'org', :'item_minonly', 'main', 1, 0),
  (:'org', :'item_nounit', 'main', 3, 0),
  (:'org_b', :'b_item', 'main', 0, 0);

-- ── purchase requests: only the two receivable statuses, only lines that still owe stock ───────
-- auth.uid() is null in this setup context, so the insert-side separation-of-duties guard and the
-- decided-PR line lock are both exempt (their documented service/test path).
insert into public.purchase_requests(id, org_id, code, status, needed_by) values
  ('22800000-0000-0000-0000-000000000101', :'org', 'PR-OVERDUE', 'approved', current_setting('test.today')::date - 2),
  ('22800000-0000-0000-0000-000000000102', :'org', 'PR-TODAY', 'partially_received', current_setting('test.today')::date),
  ('22800000-0000-0000-0000-000000000103', :'org', 'PR-FUTURE', 'approved', current_setting('test.today')::date + 5),
  ('22800000-0000-0000-0000-000000000104', :'org', 'PR-UNDATED', 'approved', null),
  -- line unit differs from the item unit: NOT a blocker on the shipped path
  ('22800000-0000-0000-0000-000000000105', :'org', 'PR-UNITDIFF', 'approved', current_setting('test.today')::date),
  -- carries a line with no quantity: fn_post_receipt raises 22023 for the WHOLE request
  ('22800000-0000-0000-0000-000000000106', :'org', 'PR-NOQTY', 'approved', current_setting('test.today')::date),
  -- fully received: nothing left to receive, so it is not open work
  ('22800000-0000-0000-0000-000000000107', :'org', 'PR-FULL', 'approved', current_setting('test.today')::date),
  -- statuses fn_post_receipt will never claim
  ('22800000-0000-0000-0000-000000000108', :'org', 'PR-DRAFT', 'draft', current_setting('test.today')::date),
  ('22800000-0000-0000-0000-000000000109', :'org', 'PR-SUBMITTED', 'submitted', current_setting('test.today')::date),
  ('22800000-0000-0000-0000-000000000110', :'org', 'PR-RECEIVED', 'received', current_setting('test.today')::date),
  ('22800000-0000-0000-0000-000000000111', :'org', 'PR-REJECTED', 'rejected', current_setting('test.today')::date),
  -- only an unquantified line: still blocked work, never allowed to disappear
  ('22800000-0000-0000-0000-000000000112', :'org', 'PR-ONLY-NOQTY', 'approved', current_setting('test.today')::date),
  (:'b_pr', :'org_b', 'PR-FOREIGN', 'approved', current_setting('test.today')::date);

insert into public.purchase_request_items(id, org_id, pr_id, item_id, qty, unit, received_qty) values
  ('22800000-0000-0000-0000-000000000201', :'org', '22800000-0000-0000-0000-000000000101', :'item_low', 10, 'كجم', 4),
  -- fully received line on an otherwise open request: counted in neither the open lines nor the list
  ('22800000-0000-0000-0000-000000000202', :'org', '22800000-0000-0000-0000-000000000101', :'item_ok', 5, 'كجم', 5),
  ('22800000-0000-0000-0000-000000000203', :'org', '22800000-0000-0000-0000-000000000102', :'item_low', 8, 'كجم', 3),
  ('22800000-0000-0000-0000-000000000204', :'org', '22800000-0000-0000-0000-000000000103', :'item_ok', 6, 'كجم', 0),
  ('22800000-0000-0000-0000-000000000205', :'org', '22800000-0000-0000-0000-000000000104', :'item_low', 2, 'كجم', 0),
  ('22800000-0000-0000-0000-000000000206', :'org', '22800000-0000-0000-0000-000000000105', :'item_ok', 4, 'لتر', 0),
  ('22800000-0000-0000-0000-000000000207', :'org', '22800000-0000-0000-0000-000000000106', :'item_low', 7, 'كجم', 0),
  ('22800000-0000-0000-0000-000000000208', :'org', '22800000-0000-0000-0000-000000000106', :'item_ok', null, 'كجم', 0),
  ('22800000-0000-0000-0000-000000000209', :'org', '22800000-0000-0000-0000-000000000107', :'item_low', 3, 'كجم', 3),
  ('22800000-0000-0000-0000-000000000210', :'org', '22800000-0000-0000-0000-000000000108', :'item_low', 3, 'كجم', 0),
  ('22800000-0000-0000-0000-000000000211', :'org', '22800000-0000-0000-0000-000000000109', :'item_low', 3, 'كجم', 0),
  ('22800000-0000-0000-0000-000000000212', :'org', '22800000-0000-0000-0000-000000000110', :'item_low', 3, 'كجم', 0),
  ('22800000-0000-0000-0000-000000000213', :'org', '22800000-0000-0000-0000-000000000111', :'item_low', 3, 'كجم', 0),
  ('22800000-0000-0000-0000-000000000214', :'org', '22800000-0000-0000-0000-000000000112', :'item_low', null, 'كجم', 0),
  ('22800000-0000-0000-0000-0000000002f1', :'org_b', :'b_pr', :'b_item', 3, 'كجم', 0);

-- ── movements: written with triggers disabled so this is pure recorded ledger state, not a live
-- posting (the append-only ledger is normally RPC-only; the audit trigger and the open-PO receipt
-- guard are irrelevant to what this snapshot reads). ─────────────────────────────────────────────
set local session_replication_role = replica;
insert into public.inventory_movements(id, org_id, item_id, type, qty, unit, location, occurred_at) values
  -- today's OUTBOUND issues
  ('22800000-0000-0000-0000-000000000301', :'org', :'item_low', 'issue', 2, 'كجم', 'main',
    (current_setting('test.today')::date + time '09:00') at time zone 'Africa/Cairo'),
  ('22800000-0000-0000-0000-000000000302', :'org', :'item_ok', 'issue', 5, 'كجم', 'main',
    (current_setting('test.today')::date + time '11:00') at time zone 'Africa/Cairo'),
  -- inbound and earmark movements today are NOT outbound issues
  ('22800000-0000-0000-0000-000000000303', :'org', :'item_ok', 'receipt', 9, 'كجم', 'main',
    (current_setting('test.today')::date + time '08:00') at time zone 'Africa/Cairo'),
  ('22800000-0000-0000-0000-000000000304', :'org', :'item_ok', 'return', 1, 'كجم', 'main',
    (current_setting('test.today')::date + time '08:30') at time zone 'Africa/Cairo'),
  ('22800000-0000-0000-0000-000000000305', :'org', :'item_ok', 'reserve', 1, 'كجم', 'main',
    (current_setting('test.today')::date + time '08:45') at time zone 'Africa/Cairo'),
  -- an issue recorded YESTERDAY is not today's work
  ('22800000-0000-0000-0000-000000000306', :'org', :'item_low', 'issue', 3, 'كجم', 'main',
    ((current_setting('test.today')::date - 1) + time '09:00') at time zone 'Africa/Cairo'),
  -- recorded movement EVIDENCE: adjustment / loss / expiry inside the 7-day window
  ('22800000-0000-0000-0000-000000000307', :'org', :'item_low', 'loss', 1, 'كجم', 'main',
    (current_setting('test.today')::date + time '12:00') at time zone 'Africa/Cairo'),
  ('22800000-0000-0000-0000-000000000308', :'org', :'item_ok', 'adjustment', 4, 'كجم', 'main',
    ((current_setting('test.today')::date - 3) + time '12:00') at time zone 'Africa/Cairo'),
  ('22800000-0000-0000-0000-000000000309', :'org', :'item_ok', 'expiry', 2, 'كجم', 'main',
    ((current_setting('test.today')::date - 6) + time '23:00') at time zone 'Africa/Cairo'),
  -- one day older than the window: outside the exact evidence total
  ('22800000-0000-0000-0000-000000000310', :'org', :'item_ok', 'loss', 8, 'كجم', 'main',
    ((current_setting('test.today')::date - 7) + time '12:00') at time zone 'Africa/Cairo'),
  -- another organisation's ledger is never read
  ('22800000-0000-0000-0000-0000000003f1', :'org_b', :'b_item', 'issue', 5, 'كجم', 'main',
    (current_setting('test.today')::date + time '09:00') at time zone 'Africa/Cairo');
set local session_replication_role = origin;

-- ── grants and metadata ────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('public', 'public.fn_storekeeper_home_snapshot(uuid,date,integer)', 'EXECUTE'), 'PUBLIC cannot execute the storekeeper home snapshot');
select ok(not has_function_privilege('anon', 'public.fn_storekeeper_home_snapshot(uuid,date,integer)', 'EXECUTE'), 'anon cannot execute the storekeeper home snapshot');
select ok(has_function_privilege('authenticated', 'public.fn_storekeeper_home_snapshot(uuid,date,integer)', 'EXECUTE'), 'authenticated reaches internal gates');
select ok(not (select prosecdef from pg_proc where oid = 'public.fn_storekeeper_home_snapshot(uuid,date,integer)'::regprocedure), 'snapshot is SECURITY INVOKER');
select is((select provolatile::text from pg_proc where oid = 'public.fn_storekeeper_home_snapshot(uuid,date,integer)'::regprocedure), 's', 'snapshot is stable');
select is((select proconfig[1] from pg_proc where oid = 'public.fn_storekeeper_home_snapshot(uuid,date,integer)'::regprocedure), 'search_path=""', 'snapshot has empty search_path');

create or replace function pg_temp.as_user(uid text, active_org uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when active_org is null
    then json_build_object('sub', uid, 'role', 'authenticated')
    else json_build_object('sub', uid, 'role', 'authenticated', 'active_org_id', active_org) end::text, true);
  execute 'set local role authenticated';
end $$;

-- ── the storekeeper's own snapshot ─────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select set_config('test.snapshot', public.fn_storekeeper_home_snapshot(:'org', current_setting('test.today')::date, 2)::text, false);
select set_config('test.wide', public.fn_storekeeper_home_snapshot(:'org', current_setting('test.today')::date, 8)::text, false);

select is(current_setting('test.snapshot')::jsonb->>'version', 'farm-os.storekeeper-home.v1', 'snapshot version is pinned');
select is(current_setting('test.snapshot')::jsonb->>'org_id', :'org', 'snapshot is bound to the active organization');
select is(current_setting('test.snapshot')::jsonb->>'as_of', current_setting('test.today'), 'snapshot carries the current Cairo date');
select is((current_setting('test.snapshot')::jsonb->>'detail_limit')::integer, 2, 'snapshot echoes its detail bound');
select is((current_setting('test.snapshot')::jsonb->>'evidence_window_days')::integer, 7, 'snapshot publishes the window its evidence total covers');
select is(current_setting('test.snapshot')::jsonb->'authority'->>'inventory', 'partial', 'inventory authority is reported as partial');

-- Recorded counts stay exact while the source authority is only partial.
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'open_receipts')::integer, 7, 'open receipts include receivable-status requests blocked by an unquantified-only line');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'receivable_now')::integer, 5, 'receivable work is open work with no recorded blocker');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'blocked_receipts')::integer, 2, 'blocked work includes every request the RPC would refuse outright');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'overdue_receipts')::integer, 1, 'overdue starts the day after the needed-by date');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'due_today_receipts')::integer, 4, 'due today is exactly the needed-by date');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'upcoming_receipts')::integer, 1, 'future work is counted separately');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'undated_receipts')::integer, 1, 'undated open work stays explicit');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'open_receipt_lines')::integer, 6, 'a fully received line on an open request is not an open line');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'issued_today')::integer, 2, 'today counts recorded OUTBOUND issues only');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'below_reorder')::integer, 2, 'reorder readings need a positive threshold and every bin');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'unknown_stock')::integer, 1, 'an item with no bin row is unknown, never zero');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'recent_shrink')::integer, 3, 'movement evidence is exactly the seven-day window');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'receivable_now')::bigint
        + (current_setting('test.snapshot')::jsonb->'recorded'->>'blocked_receipts')::bigint,
          (current_setting('test.snapshot')::jsonb->'recorded'->>'open_receipts')::bigint,
  'receivable and blocked reconcile exactly with the open total');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'overdue_receipts')::bigint
        + (current_setting('test.snapshot')::jsonb->'recorded'->>'due_today_receipts')::bigint
        + (current_setting('test.snapshot')::jsonb->'recorded'->>'upcoming_receipts')::bigint
        + (current_setting('test.snapshot')::jsonb->'recorded'->>'undated_receipts')::bigint,
          (current_setting('test.snapshot')::jsonb->'recorded'->>'open_receipts')::bigint,
  'every open request lands in exactly one urgency bucket');
select ok(jsonb_typeof(current_setting('test.snapshot')::jsonb->'recorded'->'open_receipts') = 'string',
  'counts leave PostgreSQL as exact text');

-- ── no finance, no person, anywhere ────────────────────────────────────────────────────────────
select ok(not (current_setting('test.wide')::jsonb ? 'finance'), 'snapshot exposes no finance branch');
select ok(current_setting('test.wide') not like '%est_cost%', 'snapshot never carries est_cost');
select ok(current_setting('test.wide') not like '%unit_cost%'
      and current_setting('test.wide') not like '%amount%'
      and current_setting('test.wide') not like '%"rate"%'
      and current_setting('test.wide') not like '%cost%'
      and current_setting('test.wide') not like '%price%',
  'snapshot carries no money key at all');
select ok(current_setting('test.wide') not like '%requested_by%'
      and current_setting('test.wide') not like '%approved_by%'
      and current_setting('test.wide') not like '%person%'
      and current_setting('test.wide') not like '%supplier%'
      and current_setting('test.wide') not like '%phone%',
  'snapshot names nobody and carries no counterparty identity');
select ok(current_setting('test.wide') not like '%reason%', 'the free-text purchase reason is never echoed');

-- ── the deliberate ABSENCE of a completed-stock-take claim ─────────────────────────────────────
-- fn_record_stock_take posts NOTHING when the count matches, so a completed stock-take is
-- unobservable. Prove that first, then prove the snapshot never claims one.
select is((select pg_catalog.count(*)::integer from public.inventory_movements
            where org_id = :'org' and item_id = :'item_ok'), 7,
  'baseline movement count for the item about to be counted');
reset role;
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select is(public.fn_record_stock_take(:'item_ok', 50, 'main'), 50::numeric,
  'a stock-take whose count matches the book reconciles to the same on_hand');
select is((select pg_catalog.count(*)::integer from public.inventory_movements
            where org_id = :'org' and item_id = :'item_ok'), 7,
  'a matching stock-take posts NO movement — it leaves no stored trace at all');
select ok(current_setting('test.wide') not like '%stock_take%'
      and current_setting('test.wide') not like '%stocktake%'
      and current_setting('test.wide') not like '%counted%',
  'the snapshot claims no stock-take of any kind');
select ok(not (current_setting('test.wide')::jsonb->'recorded' ? 'stock_takes')
      and not (current_setting('test.wide')::jsonb->'recorded' ? 'stock_takes_today')
      and not (current_setting('test.wide')::jsonb->'drivers' ? 'stock_takes'),
  'no recorded count and no driver list pretends to be a stock-take log');
-- The adjustment / loss / expiry rows are exposed only as recorded MOVEMENTS, typed as such.
select ok(not exists (
    select 1 from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'recent_shrink') d
     where d->>'type' not in ('adjustment', 'loss', 'expiry')),
  'movement evidence carries only recorded movement types');
reset role;

-- ── receivability mirrors the CURRENT shipped receipt path ─────────────────────────────────────
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select is((select d->'blockers'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'blocked') d
            where d->>'code' = 'PR-NOQTY'),
  '["unquantified_line"]'::jsonb, 'a line with no quantity blocks the whole request');
select is((select d->'blockers'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'blocked') d
            where d->>'code' = 'PR-ONLY-NOQTY'),
  '["unquantified_line"]'::jsonb, 'a request with only an unquantified line remains visible as blocked');
select is((select pg_catalog.count(*)::integer
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'blocked') d),
  2, 'nothing else is called a blocker');
-- A line unit that differs from the item unit is NOT a blocker: since migration 20260701210000
-- fn_post_receipt passes NULL as the movement unit so fn_post_movement uses the ITEM's unit.
select ok((select (d->>'receivable')::boolean
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'receivable') d
            where d->>'code' = 'PR-UNITDIFF'),
  'a purchase-request line unit that differs from the item unit stays receivable');
select is((select l->>'item_unit'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'receivable') d,
                  jsonb_array_elements(d->'lines') l
            where d->>'code' = 'PR-UNITDIFF'),
  'كجم', 'the unit the receipt will actually be recorded in is published');
select is((select l->>'unit'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'receivable') d,
                  jsonb_array_elements(d->'lines') l
            where d->>'code' = 'PR-UNITDIFF'),
  'لتر', 'the unit recorded on the order line is published beside it');
-- Prove the claim rather than asserting it: the mismatched-unit request really does receive.
reset role;
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select lives_ok(
  $$select public.fn_post_receipt('22800000-0000-0000-0000-000000000105'::uuid)$$,
  'the mismatched-unit request is genuinely receivable, so it was right not to block it');
select throws_ok(
  $$select public.fn_post_receipt('22800000-0000-0000-0000-000000000106'::uuid)$$,
  '22023',
  null,
  'the unquantified-line request is genuinely refused, so it was right to block it');
select throws_ok(
  $$select public.fn_post_receipt('22800000-0000-0000-0000-000000000112'::uuid)$$,
  '22023',
  null,
  'the unquantified-only request is genuinely refused and must stay in blocked work');
select is((select status from public.purchase_requests where id = '22800000-0000-0000-0000-000000000106'),
  'approved', 'the refused receipt rolled back atomically and left the request untouched');
reset role;

-- ── bounded drivers, independently limited, deterministically ordered ──────────────────────────
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'receivable'), 2, 'receivable drivers obey the limit');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'blocked'), 2, 'blocked drivers obey their own count');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'below_reorder'), 2, 'reorder drivers obey their own count');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'unknown_stock'), 1, 'unknown-stock drivers obey their own count');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'issued_today'), 2, 'issue drivers obey their own count');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'recent_shrink'), 2, 'movement evidence obeys the limit independently');
select is(jsonb_array_length(current_setting('test.wide')::jsonb->'drivers'->'receivable'), 5, 'a wider bound reveals every receivable request');
select is(jsonb_array_length(current_setting('test.wide')::jsonb->'drivers'->'recent_shrink'), 3, 'a wider bound reveals every recorded movement in the window');
select is(current_setting('test.snapshot')::jsonb->'drivers'->'receivable'->0->>'urgency', 'overdue', 'overdue work leads the receivable list');
select is(current_setting('test.snapshot')::jsonb->'drivers'->'receivable'->0->>'code', 'PR-OVERDUE', 'the longest overdue request leads');
select is(current_setting('test.wide')::jsonb->'drivers'->'receivable'->4->>'urgency', 'undated', 'undated work sorts last, never dropped');
select is(current_setting('test.snapshot')::jsonb->'drivers'->'recent_shrink'->0->>'occurred_on', current_setting('test.today'),
  'the most recent recorded movement leads the evidence list');

-- ── what never enters the store day ────────────────────────────────────────────────────────────
select ok(not exists (
    select 1 from jsonb_array_elements(
      current_setting('test.wide')::jsonb->'drivers'->'receivable'
      || current_setting('test.wide')::jsonb->'drivers'->'blocked') d
     where d->>'code' in ('PR-FULL', 'PR-DRAFT', 'PR-SUBMITTED', 'PR-RECEIVED', 'PR-REJECTED', 'PR-FOREIGN')),
  'fully received, undecided, spent and foreign requests never appear');
select ok(not exists (
    select 1 from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'receivable') d,
         jsonb_array_elements(d->'lines') l
     where (l->>'remaining')::numeric <= 0),
  'no shown line has anything left to receive of zero or less');
select is((select d->>'open_line_count'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'receivable') d
            where d->>'code' = 'PR-OVERDUE'),
  '1', 'the exact open-line total excludes the fully received line');

-- ── current stock: all bins, positive threshold only, unknown kept unknown ─────────────────────
select is((select d->>'available'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'below_reorder') d
            where d->>'name' = 'سماد اختبار'),
  '5', 'availability sums EVERY bin of the item, net of reservations');
select is((select d->>'bin_count'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'below_reorder') d
            where d->>'name' = 'سماد اختبار'),
  '2', 'the number of bins behind the reading is published');
select is((select d->>'threshold'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'below_reorder') d
            where d->>'name' = 'صنف بحد أدنى'),
  '4', 'min_stock is the threshold when no reorder point is recorded');
select ok(not exists (
    select 1 from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'below_reorder') d
     where d->>'name' in ('صنف بحد صفري', 'صنف بلا حد', 'صنف بلا وحدة', 'مبيد اختبار')),
  'a non-positive threshold is not a reorder signal, and a stocked item is not either');
select is((select d->>'name'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'unknown_stock') d),
  'صنف بلا رصيد', 'the item with no bin row is the unknown one');
select ok(not (current_setting('test.wide')::jsonb->'drivers'->'unknown_stock'->0 ? 'available'),
  'an unknown-stock item carries no balance at all, not a zero');

-- ── role and tenant gates ──────────────────────────────────────────────────────────────────────
reset role;
select pg_temp.as_user(current_setting('test.manager'), :'org');
select throws_ok(format($$select public.fn_storekeeper_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'farm manager is denied');
reset role;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_storekeeper_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'owner is denied');
reset role;
select pg_temp.as_user(current_setting('test.accountant'), :'org');
select throws_ok(format($$select public.fn_storekeeper_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'accountant is denied');
reset role;
select pg_temp.as_user(current_setting('test.supervisor'), :'org');
select throws_ok(format($$select public.fn_storekeeper_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'supervisor is denied');
reset role;
select pg_temp.as_user(current_setting('test.storekeeper'));
select throws_ok(format($$select public.fn_storekeeper_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'missing active org fails closed');
reset role;
select pg_temp.as_user(current_setting('test.storekeeper'), :'org_b');
select throws_ok(format($$select public.fn_storekeeper_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'active org mismatch fails closed');
reset role;
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select throws_ok(format($$select public.fn_storekeeper_home_snapshot(%L, %L::date, 0)$$, :'org', current_setting('test.today')), '22023', null, 'zero detail limit rejected');
select throws_ok(format($$select public.fn_storekeeper_home_snapshot(%L, %L::date, 21)$$, :'org', current_setting('test.today')), '22023', null, 'detail limit above twenty rejected');
select throws_ok(format($$select public.fn_storekeeper_home_snapshot(%L, (%L::date - 1), 8)$$, :'org', current_setting('test.today')), '22007', null, 'stale date rejected');
select throws_ok(format($$select public.fn_storekeeper_home_snapshot(%L, (%L::date + 1), 8)$$, :'org', current_setting('test.today')), '22007', null, 'future date rejected');
reset role;

-- ── active-org child corruption fails closed on every join this contract makes ─────────────────
set local session_replication_role = replica;
insert into public.purchase_request_items(id, org_id, pr_id, item_id, qty, unit, received_qty)
values ('22800000-0000-0000-0000-000000000901', :'org', :'b_pr', :'item_low', 1, 'كجم', 0);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select throws_ok(format($$select public.fn_storekeeper_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'a line pointing at another organization''s purchase request fails closed');
reset role;
set local session_replication_role = replica;
delete from public.purchase_request_items where id = '22800000-0000-0000-0000-000000000901';

insert into public.purchase_request_items(id, org_id, pr_id, item_id, qty, unit, received_qty)
values ('22800000-0000-0000-0000-000000000902', :'org', '22800000-0000-0000-0000-000000000103', :'b_item', 1, 'كجم', 0);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select throws_ok(format($$select public.fn_storekeeper_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'a line pointing at another organization''s item fails closed');
reset role;
set local session_replication_role = replica;
delete from public.purchase_request_items where id = '22800000-0000-0000-0000-000000000902';

insert into public.inventory_bin(org_id, item_id, location, on_hand, reserved)
values (:'org', :'b_item', 'smuggled', 1, 0);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select throws_ok(format($$select public.fn_storekeeper_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'a bin holding another organization''s item fails closed');
reset role;
set local session_replication_role = replica;
delete from public.inventory_bin where item_id = :'b_item' and location = 'smuggled';

insert into public.inventory_movements(id, org_id, item_id, type, qty, unit, location, occurred_at)
values ('22800000-0000-0000-0000-000000000903', :'org', :'b_item', 'issue', 1, 'كجم', 'main',
  (current_setting('test.today')::date + time '09:00') at time zone 'Africa/Cairo');
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select throws_ok(format($$select public.fn_storekeeper_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'a movement against another organization''s item fails closed');
reset role;
set local session_replication_role = replica;
delete from public.inventory_movements where id = '22800000-0000-0000-0000-000000000903';
set local session_replication_role = origin;

-- Once every corrupt link is removed the snapshot is readable again: the guard is a gate, not a wall.
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select lives_ok(format($$select public.fn_storekeeper_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  'a clean organization still reads its snapshot');
reset role;

select * from finish();
rollback;
