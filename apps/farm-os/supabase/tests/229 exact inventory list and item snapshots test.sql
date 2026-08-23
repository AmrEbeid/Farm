-- SPEC-0033 R4a: the inventory LIST and ITEM 360 snapshots are exact, bounded, active-organisation
-- only, and ROLE-SEPARATED IN POSTGRESQL — the storekeeper's payload is BUILT without money,
-- supplier, purchase free text and purchase-request id, rather than having them stripped later.
--
-- The three facts this file exists to pin:
--   1. every balance sums EVERY bin of the item (the surface it replaces read the FIRST bin only);
--   2. an item with no bin row is `unknown` with JSON-null balances — never zero;
--   3. the storekeeper payload contains no money/counterparty key anywhere, and the finance payload
--      still carries exactly what those roles have today.
begin;
select no_plan();

\set org '22900000-0000-0000-0000-0000000000a0'
\set org_b '22900000-0000-0000-0000-0000000000b0'
\set item_low '22900000-0000-0000-0000-000000000001'
\set item_ok '22900000-0000-0000-0000-000000000002'
\set item_zero '22900000-0000-0000-0000-000000000003'
\set item_unknown '22900000-0000-0000-0000-000000000004'
\set item_minonly '22900000-0000-0000-0000-000000000005'
\set item_many '22900000-0000-0000-0000-000000000006'
\set supplier '22900000-0000-0000-0000-0000000000c1'
\set b_supplier '22900000-0000-0000-0000-0000000000c2'
\set b_item '22900000-0000-0000-0000-0000000000f1'
\set b_pr '22900000-0000-0000-0000-0000000000f2'
\set missing '22900000-0000-0000-0000-0000000000ff'

select set_config('test.storekeeper', (select user_id::text from public.organization_member where role = 'storekeeper' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member where role = 'farm_manager' limit 1), false);
select set_config('test.owner', (select user_id::text from public.organization_member where role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member where role = 'supervisor' limit 1), false);

insert into public.organization(id, name) values
  (:'org', 'Exact inventory list org'),
  (:'org_b', 'Exact inventory foreign org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.storekeeper')::uuid, 'storekeeper'),
  (:'org', current_setting('test.manager')::uuid, 'farm_manager'),
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org', current_setting('test.accountant')::uuid, 'accountant'),
  (:'org', current_setting('test.supervisor')::uuid, 'supervisor'),
  (:'org_b', current_setting('test.storekeeper')::uuid, 'storekeeper'),
  (:'org_b', current_setting('test.owner')::uuid, 'owner');
-- Deliberately PARTIAL: an incomplete source must NOT blank an exact recorded count.
insert into public.data_authority_status(org_id, domain, status, source_label, record_count, notes) values
  (:'org', 'inventory', 'partial', 'fixture', 5, 'partial test fixture');

insert into public.suppliers(id, org_id, name, lead_time_days, phone) values
  (:'supplier', :'org', 'تبارك للأسمدة', 4, '0100000000'),
  (:'b_supplier', :'org_b', 'مورد أجنبي', 9, '0199999999');

-- ── items: one per stock state, plus every threshold shape the rule must distinguish ───────────
insert into public.inventory_items(
  id, org_id, name, category, unit, unit_cost, reorder_point, min_stock, lead_time_days,
  preferred_supplier_id, criticality, expiry_tracked)
values
  -- stock spread across TWO bins: 4-1 + 2-0 = 5 available, under a reorder point of 10
  (:'item_low', :'org', 'سماد اختبار', 'أسمدة', 'كجم', 12.5, 10, 5, 3, :'supplier', 'عالية', false),
  (:'item_ok', :'org', 'مبيد اختبار', 'مبيدات', 'كجم', 2, 10, null, null, null, null, false),
  -- reorder_point 0 is NOT a positive threshold even though min_stock is; and it has no cost
  (:'item_zero', :'org', 'صنف بحد صفري', null, 'كجم', null, 0, 8, null, null, null, false),
  -- no bin row at all → unknown, never zero, whatever its recorded cost
  (:'item_unknown', :'org', 'صنف بلا رصيد', null, 'كجم', 3, 12, null, null, null, null, false),
  -- min_stock is the threshold when reorder_point is null; also uncosted
  (:'item_minonly', :'org', 'صنف بحد أدنى', null, 'كجم', null, null, 4, null, null, null, false),
  (:'b_item', :'org_b', 'صنف أجنبي', null, 'كجم', 99, 1, null, null, null, null, false);

-- `ordered` is pinned to 0 by inventory_bin_ordered_zero_until_writer (migration 20260629140248):
-- nothing writes an on-order balance yet, so a non-zero fixture would test a column the product
-- cannot produce. `projected` = on_hand - reserved + ordered, per the table's own comment.
insert into public.inventory_bin(org_id, item_id, location, on_hand, reserved, ordered, projected) values
  (:'org', :'item_low', 'main', 4, 1, 0, 3),
  (:'org', :'item_low', 'store2', 2, 0, 0, 2),
  (:'org', :'item_ok', 'main', 50, 0, 0, 50),
  (:'org', :'item_zero', 'main', 0, 0, 0, 0),
  (:'org', :'item_minonly', 'main', 1, 0, 0, 1),
  (:'org_b', :'b_item', 'main', 0, 0, 0, 0);

insert into public.purchase_requests(id, org_id, code, status, needed_by, reason) values
  ('22900000-0000-0000-0000-000000000101', :'org', 'PR-OPEN', 'approved',
    (pg_catalog.now() at time zone 'Africa/Cairo')::date + 5, 'تجهيز الموسم'),
  ('22900000-0000-0000-0000-000000000102', :'org', 'PR-DONE', 'received',
    (pg_catalog.now() at time zone 'Africa/Cairo')::date - 5, 'دفعة سابقة'),
  ('22900000-0000-0000-0000-000000000103', :'org', 'PR-UNQUANTIFIED', 'approved',
    (pg_catalog.now() at time zone 'Africa/Cairo')::date + 2, 'كمية لم تحدد بعد'),
  ('22900000-0000-0000-0000-000000000104', :'org', 'PR-CLEAN', 'approved',
    (pg_catalog.now() at time zone 'Africa/Cairo')::date + 1, 'طلب قابل للاستلام'),
  (:'b_pr', :'org_b', 'PR-FOREIGN', 'approved',
    (pg_catalog.now() at time zone 'Africa/Cairo')::date, 'طلب أجنبي');

insert into public.purchase_request_items(id, org_id, pr_id, item_id, qty, unit, est_cost, received_qty) values
  ('22900000-0000-0000-0000-000000000201', :'org', '22900000-0000-0000-0000-000000000101', :'item_low', 10, 'لتر', 120, 4),
  ('22900000-0000-0000-0000-000000000202', :'org', '22900000-0000-0000-0000-000000000102', :'item_low', 3, 'كجم', 30, 3),
  ('22900000-0000-0000-0000-000000000203', :'org', '22900000-0000-0000-0000-000000000103', :'item_low', null, 'كجم', null, 0),
  -- A quantified line whose request has an unquantified SIBLING is not receivable: fn_post_receipt
  -- loops every line and rejects the whole request.
  ('22900000-0000-0000-0000-000000000204', :'org', '22900000-0000-0000-0000-000000000101', :'item_ok', null, 'كجم', null, 0),
  ('22900000-0000-0000-0000-000000000205', :'org', '22900000-0000-0000-0000-000000000104', :'item_low', 2, 'كجم', 20, 0),
  ('22900000-0000-0000-0000-0000000002f1', :'org_b', :'b_pr', :'b_item', 3, 'كجم', 9, 0);

-- Movements written with triggers disabled: this is recorded ledger STATE, not a live posting.
set local session_replication_role = replica;
insert into public.inventory_movements(id, org_id, item_id, type, qty, unit, unit_cost, location, occurred_at, batch_no, expiry_date) values
  ('22900000-0000-0000-0000-000000000301', :'org', :'item_low', 'issue', 2, 'كجم', null, 'main',
    (pg_catalog.now() at time zone 'Africa/Cairo')::date at time zone 'Africa/Cairo', null, null),
  ('22900000-0000-0000-0000-000000000302', :'org', :'item_low', 'receipt', 4, 'كجم', 12.5, 'main',
    ((pg_catalog.now() at time zone 'Africa/Cairo')::date - 1) at time zone 'Africa/Cairo', 'B-1', '2027-01-01'),
  ('22900000-0000-0000-0000-000000000303', :'org', :'item_low', 'adjustment', 1, 'كجم', null, 'store2',
    ((pg_catalog.now() at time zone 'Africa/Cairo')::date - 2) at time zone 'Africa/Cairo', null, null),
  ('22900000-0000-0000-0000-0000000003f1', :'org_b', :'b_item', 'issue', 1, 'كجم', 99, 'main',
    (pg_catalog.now() at time zone 'Africa/Cairo')::date at time zone 'Africa/Cairo', null, null);
set local session_replication_role = origin;

-- ── grants and metadata ────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('public', 'public.fn_inventory_list_snapshot(uuid,text,text,integer,integer)', 'EXECUTE'), 'PUBLIC cannot execute the inventory list snapshot');
select ok(not has_function_privilege('anon', 'public.fn_inventory_list_snapshot(uuid,text,text,integer,integer)', 'EXECUTE'), 'anon cannot execute the inventory list snapshot');
select ok(has_function_privilege('authenticated', 'public.fn_inventory_list_snapshot(uuid,text,text,integer,integer)', 'EXECUTE'), 'authenticated reaches the inventory list gate');
select ok(not has_function_privilege('public', 'public.fn_inventory_item_snapshot(uuid,uuid,integer,integer)', 'EXECUTE'), 'PUBLIC cannot execute the inventory item snapshot');
select ok(not has_function_privilege('anon', 'public.fn_inventory_item_snapshot(uuid,uuid,integer,integer)', 'EXECUTE'), 'anon cannot execute the inventory item snapshot');
select ok(has_function_privilege('authenticated', 'public.fn_inventory_item_snapshot(uuid,uuid,integer,integer)', 'EXECUTE'), 'authenticated reaches the inventory item gate');
select ok(not (select prosecdef from pg_proc where oid = 'public.fn_inventory_list_snapshot(uuid,text,text,integer,integer)'::regprocedure), 'list snapshot is SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid = 'public.fn_inventory_item_snapshot(uuid,uuid,integer,integer)'::regprocedure), 'item snapshot is SECURITY INVOKER');
select is((select provolatile::text from pg_proc where oid = 'public.fn_inventory_list_snapshot(uuid,text,text,integer,integer)'::regprocedure), 's', 'list snapshot is stable');
select is((select provolatile::text from pg_proc where oid = 'public.fn_inventory_item_snapshot(uuid,uuid,integer,integer)'::regprocedure), 's', 'item snapshot is stable');
select is((select proconfig[1] from pg_proc where oid = 'public.fn_inventory_list_snapshot(uuid,text,text,integer,integer)'::regprocedure), 'search_path=""', 'list snapshot has an empty search_path');
select is((select proconfig[1] from pg_proc where oid = 'public.fn_inventory_item_snapshot(uuid,uuid,integer,integer)'::regprocedure), 'search_path=""', 'item snapshot has an empty search_path');

create or replace function pg_temp.as_user(uid text, active_org uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when active_org is null
    then json_build_object('sub', uid, 'role', 'authenticated')
    else json_build_object('sub', uid, 'role', 'authenticated', 'active_org_id', active_org) end::text, true);
  execute 'set local role authenticated';
end $$;

-- ── the finance list: exact totals, exact state counts, honest valuation ───────────────────────
select pg_temp.as_user(current_setting('test.owner'), :'org');
select set_config('test.list', public.fn_inventory_list_snapshot(:'org', null, 'all', 20, 0)::text, false);

select is(current_setting('test.list')::jsonb->>'version', 'farm-os.inventory-list.v1', 'list version is pinned');
select is(current_setting('test.list')::jsonb->>'org_id', :'org', 'list is bound to the active organization');
select is(current_setting('test.list')::jsonb->>'scope', 'finance', 'a non-store role receives the finance scope');
select is(current_setting('test.list')::jsonb->'authority'->>'inventory', 'partial', 'inventory authority is reported as partial');
select ok(current_setting('test.list')::jsonb->'query' = 'null'::jsonb, 'an absent search is published as null, not an empty string');

select is((current_setting('test.list')::jsonb->'counts'->>'total_items')::integer, 5, 'every recorded item in the organization is counted');
select is((current_setting('test.list')::jsonb->'counts'->>'query_total')::integer, 5, 'with no search the searched total is the whole book');
select is((current_setting('test.list')::jsonb->'counts'->>'matching')::integer, 5, 'with no filter the page denominator is the searched total');
select is((current_setting('test.list')::jsonb->'counts'->>'below_reorder')::integer, 2, 'a reorder reading needs a positive threshold and every bin');
select is((current_setting('test.list')::jsonb->'counts'->>'unknown_stock')::integer, 1, 'an item with no bin row is unknown, never zero');
select is((current_setting('test.list')::jsonb->'counts'->>'no_threshold')::integer, 1, 'a non-positive recorded threshold is no threshold at all');
select is((current_setting('test.list')::jsonb->'counts'->>'ok_stock')::integer, 1, 'the rest read as above their recorded threshold');
select is((current_setting('test.list')::jsonb->'counts'->>'uncosted')::integer, 2, 'the finance scope publishes how many items have no recorded cost');
select is((current_setting('test.list')::jsonb->'counts'->>'below_reorder')::bigint
        + (current_setting('test.list')::jsonb->'counts'->>'unknown_stock')::bigint
        + (current_setting('test.list')::jsonb->'counts'->>'no_threshold')::bigint
        + (current_setting('test.list')::jsonb->'counts'->>'ok_stock')::bigint,
          (current_setting('test.list')::jsonb->'counts'->>'query_total')::bigint,
  'the four states partition the searched items exactly');
select ok(jsonb_typeof(current_setting('test.list')::jsonb->'counts'->'total_items') = 'string',
  'counts leave PostgreSQL as exact text');

-- Valuation excludes what cannot honestly be valued, and publishes the size of its own gap.
select is((current_setting('test.list')::jsonb->'valuation'->>'known_total')::numeric, 175::numeric,
  'valuation totals only the items with BOTH a recorded balance and a recorded cost');
select is((current_setting('test.list')::jsonb->'valuation'->>'valued_items')::integer, 2, 'the number of valued items is published');
select is((current_setting('test.list')::jsonb->'valuation'->>'unknown_cost_items')::integer, 2, 'stocked items with no recorded cost are published as the gap');
select is((current_setting('test.list')::jsonb->'valuation'->>'unknown_stock_items')::integer, 1, 'items with no recorded balance are published as the other gap');
select is((current_setting('test.list')::jsonb->'valuation'->>'valued_items')::bigint
        + (current_setting('test.list')::jsonb->'valuation'->>'unknown_cost_items')::bigint
        + (current_setting('test.list')::jsonb->'valuation'->>'unknown_stock_items')::bigint,
          (current_setting('test.list')::jsonb->'counts'->>'query_total')::bigint,
  'valued and unvaluable items account for every searched item');

-- ── all-bin math, and unknown kept unknown ─────────────────────────────────────────────────────
select is((select r->>'available' from jsonb_array_elements(current_setting('test.list')::jsonb->'rows') r
            where r->>'name' = 'سماد اختبار'), '5',
  'availability sums EVERY bin of the item, net of reservations');
select is((select r->>'on_hand' from jsonb_array_elements(current_setting('test.list')::jsonb->'rows') r
            where r->>'name' = 'سماد اختبار'), '6',
  'on hand sums every bin too — not the first one');
select is((select r->>'bin_count' from jsonb_array_elements(current_setting('test.list')::jsonb->'rows') r
            where r->>'name' = 'سماد اختبار'), '2',
  'the number of bins behind the reading is published');
select is((select (r->>'valuation')::numeric from jsonb_array_elements(current_setting('test.list')::jsonb->'rows') r
            where r->>'name' = 'سماد اختبار'), 75::numeric,
  'a row is valued at its whole balance times its recorded cost');
select ok((select r->'on_hand' = 'null'::jsonb and r->'available' = 'null'::jsonb and r->'reserved' = 'null'::jsonb
             from jsonb_array_elements(current_setting('test.list')::jsonb->'rows') r
            where r->>'name' = 'صنف بلا رصيد'),
  'an item with no bin row carries JSON null balances, never zero');
select is((select r->>'state' from jsonb_array_elements(current_setting('test.list')::jsonb->'rows') r
            where r->>'name' = 'صنف بلا رصيد'), 'unknown',
  'and it is stated as unknown');
select ok((select r->'valuation' = 'null'::jsonb
             from jsonb_array_elements(current_setting('test.list')::jsonb->'rows') r
            where r->>'name' = 'صنف بلا رصيد'),
  'an item with no recorded balance is not valued, whatever its cost');
select ok((select r->'unit_cost' = 'null'::jsonb and r->'valuation' = 'null'::jsonb
             from jsonb_array_elements(current_setting('test.list')::jsonb->'rows') r
            where r->>'name' = 'صنف بحد صفري'),
  'an unknown unit cost is null, never a zero, and its item is not valued');
select is((select r->>'state' from jsonb_array_elements(current_setting('test.list')::jsonb->'rows') r
            where r->>'name' = 'صنف بحد صفري'), 'no_threshold',
  'a recorded reorder point of zero leaves nothing to read the balance against');
select is((select r->>'threshold' from jsonb_array_elements(current_setting('test.list')::jsonb->'rows') r
            where r->>'name' = 'صنف بحد أدنى'), '4',
  'min_stock becomes the threshold when no reorder point is recorded');
select is((select r->>'threshold_source' from jsonb_array_elements(current_setting('test.list')::jsonb->'rows') r
            where r->>'name' = 'صنف بحد أدنى'), 'min_stock',
  'and the published threshold says which recorded value it came from');
select is((select r->>'threshold_source' from jsonb_array_elements(current_setting('test.list')::jsonb->'rows') r
            where r->>'name' = 'سماد اختبار'), 'reorder_point',
  'a recorded reorder point wins over min_stock');
select ok(not exists (
    select 1 from jsonb_array_elements(current_setting('test.list')::jsonb->'rows') r
     where r->>'name' = 'صنف أجنبي'),
  'another organization''s item never appears');

-- ── deterministic order and real paging ────────────────────────────────────────────────────────
select is(current_setting('test.list')::jsonb->'rows'->0->>'state', 'below_reorder', 'exceptions lead the list');
select is(current_setting('test.list')::jsonb->'rows'->1->>'state', 'below_reorder', 'both exceptions lead it');
select is(current_setting('test.list')::jsonb->'rows'->2->>'state', 'unknown', 'then the unknown balances');
select is(current_setting('test.list')::jsonb->'rows'->3->>'state', 'no_threshold', 'then the items with no threshold');
select is(current_setting('test.list')::jsonb->'rows'->4->>'state', 'ok', 'and the quiet items last');
select is(jsonb_array_length(current_setting('test.list')::jsonb->'rows'), 5, 'the page holds every matching item when it fits');
select is(jsonb_array_length(public.fn_inventory_list_snapshot(:'org', null, 'all', 2, 0)->'rows'), 2, 'the page obeys its limit');
select is(jsonb_array_length(public.fn_inventory_list_snapshot(:'org', null, 'all', 2, 4)->'rows'), 1, 'the last page holds only what is left');
select is(jsonb_array_length(public.fn_inventory_list_snapshot(:'org', null, 'all', 2, 6)->'rows'), 0, 'a page past the end is empty, not an error');
select is((public.fn_inventory_list_snapshot(:'org', null, 'all', 2, 0)->'counts'->>'matching')::integer, 5,
  'the exact total is published SEPARATELY from the bounded page');
select is(public.fn_inventory_list_snapshot(:'org', null, 'all', 2, 4)->'rows'->0->>'state', 'ok',
  'the offset lands on the row the deterministic order puts there');

-- ── search: matches name and category, and escapes its own metacharacters ──────────────────────
select is((public.fn_inventory_list_snapshot(:'org', 'سماد', 'all', 20, 0)->'counts'->>'query_total')::integer, 1,
  'a search matches the item name');
select is((public.fn_inventory_list_snapshot(:'org', 'مبيدات', 'all', 20, 0)->'counts'->>'query_total')::integer, 1,
  'a search matches the item category too');
select is((public.fn_inventory_list_snapshot(:'org', 'سماد', 'all', 20, 0)->'counts'->>'total_items')::integer, 5,
  'a search narrows the searched total but never the organization total');
select is(public.fn_inventory_list_snapshot(:'org', '  سماد  ', 'all', 20, 0)->>'query', 'سماد',
  'the published search is the trimmed value the query actually used');
-- A typed metacharacter must search for that character, not match the whole book.
select is((public.fn_inventory_list_snapshot(:'org', '%', 'all', 20, 0)->'counts'->>'query_total')::integer, 0,
  'a typed per-cent sign is escaped and matches nothing');
select is((public.fn_inventory_list_snapshot(:'org', '_', 'all', 20, 0)->'counts'->>'query_total')::integer, 0,
  'a typed underscore is escaped and matches nothing');
select is((public.fn_inventory_list_snapshot(:'org', '\', 'all', 20, 0)->'counts'->>'query_total')::integer, 0,
  'a typed backslash is escaped and matches nothing');

-- ── filters reconcile with the chip that selected them ─────────────────────────────────────────
select is((public.fn_inventory_list_snapshot(:'org', null, 'below_reorder', 20, 0)->'counts'->>'matching')::integer, 2,
  'the reorder filter matches exactly its own count');
select ok(not exists (
    select 1 from jsonb_array_elements(public.fn_inventory_list_snapshot(:'org', null, 'below_reorder', 20, 0)->'rows') r
     where r->>'state' <> 'below_reorder'),
  'a filtered page contains only rows of that state');
select is((public.fn_inventory_list_snapshot(:'org', null, 'unknown', 20, 0)->'counts'->>'matching')::integer, 1,
  'the unknown-stock filter matches exactly its own count');
select is((public.fn_inventory_list_snapshot(:'org', null, 'uncosted', 20, 0)->'counts'->>'matching')::integer, 2,
  'the uncosted filter matches exactly its own count');
reset role;

-- ── the storekeeper payload is BUILT without money, supplier, free text or a person ────────────
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select set_config('test.store_list', public.fn_inventory_list_snapshot(:'org', null, 'all', 20, 0)::text, false);
select is(current_setting('test.store_list')::jsonb->>'scope', 'operational', 'the storekeeper receives the operational scope');
select ok(current_setting('test.store_list') not like '%unit_cost%'
      and current_setting('test.store_list') not like '%est_cost%'
      and current_setting('test.store_list') not like '%valuation%'
      and current_setting('test.store_list') not like '%uncosted%'
      and current_setting('test.store_list') not like '%price%'
      and current_setting('test.store_list') not like '%amount%',
  'the operational list carries no money key at all');
select ok(current_setting('test.store_list') not like '%supplier%'
      and current_setting('test.store_list') not like '%reason%'
      and current_setting('test.store_list') not like '%requested_by%'
      and current_setting('test.store_list') not like '%approved_by%'
      and current_setting('test.store_list') not like '%person%'
      and current_setting('test.store_list') not like '%phone%',
  'the operational list names no counterparty and no person');
select ok(not (current_setting('test.store_list')::jsonb->'counts' ? 'uncosted'),
  'the uncosted count does not even exist for the store scope');
-- The store still gets the whole operational truth: same exact totals, same all-bin math.
select is((current_setting('test.store_list')::jsonb->'counts'->>'below_reorder')::integer, 2,
  'the store sees the same exact reorder count as finance does');
select is((select r->>'available' from jsonb_array_elements(current_setting('test.store_list')::jsonb->'rows') r
            where r->>'name' = 'سماد اختبار'), '5',
  'the store sees the same all-bin availability');
select ok((select r->'on_hand' = 'null'::jsonb
             from jsonb_array_elements(current_setting('test.store_list')::jsonb->'rows') r
            where r->>'name' = 'صنف بلا رصيد'),
  'and the same explicit unknown, never a zero');
-- «بلا تكلفة» is a finance question. Offering it to the store would also confirm cost data exists.
select throws_ok(format($$select public.fn_inventory_list_snapshot(%L, null, 'uncosted', 20, 0)$$, :'org'),
  '42501', null, 'the uncosted filter is refused for the store scope');
reset role;

-- ── the item 360: every location in full, bounded samples beside exact totals ──────────────────
select pg_temp.as_user(current_setting('test.owner'), :'org');
select set_config('test.item', public.fn_inventory_item_snapshot(:'org', :'item_low', 2, 10)::text, false);

select is(current_setting('test.item')::jsonb->>'version', 'farm-os.inventory-item.v1', 'item version is pinned');
select is(current_setting('test.item')::jsonb->>'item_id', :'item_low', 'the item snapshot is bound to its item');
select is(current_setting('test.item')::jsonb->>'scope', 'finance', 'a non-store role receives the finance scope here too');
select is(current_setting('test.item')::jsonb->'stock'->>'on_hand', '6', 'the item aggregate sums EVERY bin');
select is(current_setting('test.item')::jsonb->'stock'->>'reserved', '1', 'reservations are summed over every bin too');
select is(current_setting('test.item')::jsonb->'stock'->>'available', '5', 'available is the all-bin balance net of reservations');
select is(current_setting('test.item')::jsonb->'stock'->>'projected', '5', 'the projected balance is summed over every bin too');
select is(current_setting('test.item')::jsonb->'stock'->>'ordered', '0',
  'the on-order balance is published as the zero the schema currently pins it to');
select is(current_setting('test.item')::jsonb->'stock'->>'bin_count', '2', 'the bin count is published beside the aggregate');
select is(current_setting('test.item')::jsonb->'stock'->>'state', 'below_reorder', 'the state is read from the all-bin balance');
select is(jsonb_array_length(current_setting('test.item')::jsonb->'locations'), 2,
  'EVERY physical location is published — this is the whole point of the contract');
select is((select pg_catalog.sum((l->>'on_hand')::numeric)
             from jsonb_array_elements(current_setting('test.item')::jsonb->'locations') l),
  (current_setting('test.item')::jsonb->'stock'->>'on_hand')::numeric,
  'the published locations sum to exactly the published aggregate');
select is((select l->>'available' from jsonb_array_elements(current_setting('test.item')::jsonb->'locations') l
            where l->>'location' = 'main'), '3',
  'each location publishes its own balance, so the aggregate can be checked');
select is(current_setting('test.item')::jsonb->'policy'->>'threshold', '10', 'the recorded threshold is published');
select is(current_setting('test.item')::jsonb->'policy'->>'threshold_source', 'reorder_point', 'and where it came from');
select is(current_setting('test.item')::jsonb->'policy'->>'lead_time_days', '3', 'the recorded lead time is exact text');
select is((current_setting('test.item')::jsonb->>'valuation')::numeric, 75::numeric, 'the item is valued at its whole balance');
select is(current_setting('test.item')::jsonb->'supplier'->>'name', 'تبارك للأسمدة', 'the finance scope keeps the preferred supplier');

select is(current_setting('test.item')::jsonb->'movements'->>'total', '3', 'the exact recorded movement total is published');
select is(jsonb_array_length(current_setting('test.item')::jsonb->'movements'->'rows'), 2,
  'the movement sample obeys its own limit');
select is(jsonb_array_length(public.fn_inventory_item_snapshot(:'org', :'item_low', 10, 10)->'movements'->'rows'), 3,
  'a wider bound reveals every recorded movement');
select is(current_setting('test.item')::jsonb->'movements'->'rows'->0->>'occurred_on',
  ((pg_catalog.now() at time zone 'Africa/Cairo')::date)::text,
  'the most recent movement leads the sample');
select is(current_setting('test.item')::jsonb->'purchases'->>'total', '4', 'the exact recorded purchase-line total is published');
select is(current_setting('test.item')::jsonb->'purchases'->>'open_total', '1',
  'only a line that still owes stock on a wholly quantified claimable request is open');
select ok((select p->'remaining' = 'null'::jsonb
             from jsonb_array_elements(current_setting('test.item')::jsonb->'purchases'->'rows') p
            where p->>'code' = 'PR-UNQUANTIFIED'),
  'an unquantified line stays visible as unknown but is not counted as waiting for receipt');
select is((select p->>'remaining' from jsonb_array_elements(current_setting('test.item')::jsonb->'purchases'->'rows') p
            where p->>'code' = 'PR-OPEN'), '6',
  'the quantified line on a request with an unquantified sibling remains visible as recorded history');
select is((select p->>'item_unit' from jsonb_array_elements(current_setting('test.item')::jsonb->'purchases'->'rows') p
            where p->>'code' = 'PR-OPEN'), 'كجم',
  'the unit a receipt is actually recorded in is published beside the order line unit');
select is((select p->>'unit' from jsonb_array_elements(current_setting('test.item')::jsonb->'purchases'->'rows') p
            where p->>'code' = 'PR-OPEN'), 'لتر',
  'and the order line unit is published rather than silently overwritten');
select ok(not exists (
    select 1 from jsonb_array_elements(current_setting('test.item')::jsonb->'purchases'->'rows') p
     where p->>'code' = 'PR-FOREIGN'),
  'another organization''s purchase line never appears');

-- An item outside the active organization is NOT FOUND, not forbidden: the caller must not learn
-- from the error whether another organization happens to own that id.
select ok(public.fn_inventory_item_snapshot(:'org', :'b_item', 10, 10) is null,
  'another organization''s item reads as not found');
select ok(public.fn_inventory_item_snapshot(:'org', :'missing', 10, 10) is null,
  'and an id that exists nowhere reads exactly the same');
-- An item with no bin row at all keeps every balance null.
select ok(public.fn_inventory_item_snapshot(:'org', :'item_unknown', 10, 10)->'stock'->'on_hand' = 'null'::jsonb
      and public.fn_inventory_item_snapshot(:'org', :'item_unknown', 10, 10)->'stock'->'ordered' = 'null'::jsonb,
  'an item with no bin carries no balance at all on its 360, not a zero');
select is(public.fn_inventory_item_snapshot(:'org', :'item_unknown', 10, 10)->'stock'->>'state', 'unknown',
  'and its state is unknown');
select is(jsonb_array_length(public.fn_inventory_item_snapshot(:'org', :'item_unknown', 10, 10)->'locations'), 0,
  'with no location to publish');
reset role;

-- ── the storekeeper item 360 is built without money, supplier, free text or a request id ───────
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select set_config('test.store_item', public.fn_inventory_item_snapshot(:'org', :'item_low', 10, 10)::text, false);
select is(current_setting('test.store_item')::jsonb->>'scope', 'operational', 'the storekeeper receives the operational item scope');
select ok(current_setting('test.store_item') not like '%unit_cost%'
      and current_setting('test.store_item') not like '%est_cost%'
      and current_setting('test.store_item') not like '%valuation%'
      and current_setting('test.store_item') not like '%price%'
      and current_setting('test.store_item') not like '%amount%',
  'the operational item carries no money key at all');
select ok(current_setting('test.store_item') not like '%supplier%'
      and current_setting('test.store_item') not like '%reason%'
      and current_setting('test.store_item') not like '%requested_by%'
      and current_setting('test.store_item') not like '%approved_by%'
      and current_setting('test.store_item') not like '%person%'
      and current_setting('test.store_item') not like '%phone%',
  'the operational item names no counterparty and no person');
-- No purchase-request id means no link to the money-bearing purchase-request page can be built.
select ok(not exists (
    select 1 from jsonb_array_elements(current_setting('test.store_item')::jsonb->'purchases'->'rows') p
     where p ? 'pr_id'),
  'the operational item cannot even construct a link to a purchase request');
select is(current_setting('test.store_item')::jsonb->'stock'->>'available', '5',
  'the store still sees the same all-bin availability');
select is(jsonb_array_length(current_setting('test.store_item')::jsonb->'locations'), 2,
  'and still sees every physical location of the item');
select is(current_setting('test.store_item')::jsonb->'purchases'->>'open_total', '1',
  'and still sees exactly how much is still owed to the store');
reset role;

-- ── every other member role keeps the finance capability it has today ──────────────────────────
select pg_temp.as_user(current_setting('test.manager'), :'org');
select is(public.fn_inventory_list_snapshot(:'org', null, 'all', 20, 0)->>'scope', 'finance', 'farm manager keeps the finance scope');
reset role;
select pg_temp.as_user(current_setting('test.accountant'), :'org');
select is(public.fn_inventory_item_snapshot(:'org', :'item_low', 10, 10)->>'scope', 'finance', 'accountant keeps the finance scope');
reset role;
select pg_temp.as_user(current_setting('test.supervisor'), :'org');
select is(public.fn_inventory_list_snapshot(:'org', null, 'uncosted', 20, 0)->>'scope', 'finance',
  'supervisor keeps exactly the capability the enforced policy already gives it');
reset role;

-- ── tenant, claim and argument gates ───────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_inventory_list_snapshot(%L, null, 'all', 20, 0)$$, :'org'), '42501', null, 'a missing active org fails closed on the list');
select throws_ok(format($$select public.fn_inventory_item_snapshot(%L, %L, 10, 10)$$, :'org', :'item_low'), '42501', null, 'a missing active org fails closed on the item');
reset role;
select pg_temp.as_user(current_setting('test.owner'), :'org_b');
select throws_ok(format($$select public.fn_inventory_list_snapshot(%L, null, 'all', 20, 0)$$, :'org'), '42501', null, 'an active-org mismatch fails closed on the list');
select throws_ok(format($$select public.fn_inventory_item_snapshot(%L, %L, 10, 10)$$, :'org', :'item_low'), '42501', null, 'an active-org mismatch fails closed on the item');
reset role;
select pg_temp.as_user(current_setting('test.manager'), :'org_b');
select throws_ok(format($$select public.fn_inventory_list_snapshot(%L, null, 'all', 20, 0)$$, :'org_b'), '42501', null, 'a non-member of the active org is refused');
reset role;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_inventory_list_snapshot(%L, null, 'nonsense', 20, 0)$$, :'org'), '22023', null, 'an unknown filter is refused');
select throws_ok(format($$select public.fn_inventory_list_snapshot(%L, null, 'all', 0, 0)$$, :'org'), '22023', null, 'a zero limit is refused');
select throws_ok(format($$select public.fn_inventory_list_snapshot(%L, null, 'all', 51, 0)$$, :'org'), '22023', null, 'a limit above fifty is refused');
select throws_ok(format($$select public.fn_inventory_list_snapshot(%L, null, 'all', 20, -1)$$, :'org'), '22023', null, 'a negative offset is refused');
select throws_ok(format($$select public.fn_inventory_list_snapshot(%L, %L, 'all', 20, 0)$$, :'org', pg_catalog.repeat('س', 61)), '22023', null, 'a search longer than a search box is refused');
select throws_ok(format($$select public.fn_inventory_list_snapshot(%L, %L, 'all', 20, 0)$$, :'org', pg_catalog.repeat('س', 400)), '22023', null, 'an unbounded search value is refused before it is even trimmed');
select throws_ok(format($$select public.fn_inventory_item_snapshot(%L, %L, 0, 10)$$, :'org', :'item_low'), '22023', null, 'a zero movement limit is refused');
select throws_ok(format($$select public.fn_inventory_item_snapshot(%L, %L, 10, 51)$$, :'org', :'item_low'), '22023', null, 'a purchase limit above fifty is refused');
select throws_ok(format($$select public.fn_inventory_list_snapshot(null, null, 'all', 20, 0)$$), '23502', null, 'a null organization is refused');
select throws_ok(format($$select public.fn_inventory_item_snapshot(%L, null, 10, 10)$$, :'org'), '23502', null, 'a null item is refused');
reset role;

-- ── active-org child corruption fails closed on the joins these contracts make ─────────────────
set local session_replication_role = replica;
insert into public.inventory_bin(org_id, item_id, location, on_hand, reserved, ordered, projected)
values (:'org', :'b_item', 'smuggled', 1, 0, 0, 1);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_inventory_list_snapshot(%L, null, 'all', 20, 0)$$, :'org'),
  '23514', null, 'a bin holding another organization''s item fails the list closed');
reset role;
set local session_replication_role = replica;
delete from public.inventory_bin where item_id = :'b_item' and location = 'smuggled';

insert into public.purchase_request_items(id, org_id, pr_id, item_id, qty, unit, est_cost, received_qty)
values ('22900000-0000-0000-0000-000000000901', :'org', :'b_pr', :'item_low', 1, 'كجم', 1, 0);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_inventory_item_snapshot(%L, %L, 10, 10)$$, :'org', :'item_low'),
  '23514', null, 'a purchase line pointing at another organization''s request fails the item closed');
reset role;
set local session_replication_role = replica;
delete from public.purchase_request_items where id = '22900000-0000-0000-0000-000000000901';
set local session_replication_role = origin;

-- Finance supplier identity must fail closed rather than turn a corrupt foreign reference into
-- "no preferred supplier". The operational scope does not read that finance-only relationship.
set local session_replication_role = replica;
update public.inventory_items set preferred_supplier_id = :'b_supplier' where id = :'item_low';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_inventory_item_snapshot(%L, %L, 10, 10)$$, :'org', :'item_low'),
  '23514', null, 'a foreign preferred supplier fails the finance item snapshot closed');
reset role;
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select lives_ok(format($$select public.fn_inventory_item_snapshot(%L, %L, 10, 10)$$, :'org', :'item_low'),
  'the operational item does not read or validate a finance-only supplier relationship');
reset role;
set local session_replication_role = replica;
update public.inventory_items set preferred_supplier_id = :'supplier' where id = :'item_low';
set local session_replication_role = origin;

-- Once every corrupt link is removed both snapshots read again: the guard is a gate, not a wall.
select pg_temp.as_user(current_setting('test.owner'), :'org');
select lives_ok(format($$select public.fn_inventory_list_snapshot(%L, null, 'all', 20, 0)$$, :'org'),
  'a clean organization still reads its list');
select lives_ok(format($$select public.fn_inventory_item_snapshot(%L, %L, 10, 10)$$, :'org', :'item_low'),
  'a clean organization still reads its item');
reset role;

-- ── a pathological bin count fails LOUDLY rather than under-reporting the item's own stock ─────
-- Added last, so it cannot disturb any count asserted above.
insert into public.inventory_items(id, org_id, name, unit) values (:'item_many', :'org', 'صنف بمخازن كثيرة', 'كجم');
insert into public.inventory_bin(org_id, item_id, location, on_hand, reserved, ordered, projected)
select :'org', :'item_many', 'loc-' || g, 1, 0, 0, 1 from pg_catalog.generate_series(1, 200) g;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select is(public.fn_inventory_item_snapshot(:'org', :'item_many', 10, 10)->'stock'->>'on_hand', '200',
  'two hundred locations are still summed and published in full');
select is(jsonb_array_length(public.fn_inventory_item_snapshot(:'org', :'item_many', 10, 10)->'locations'), 200,
  'and every one of them is returned — the aggregate never hides a bin');
reset role;
insert into public.inventory_bin(org_id, item_id, location, on_hand, reserved, ordered, projected)
values (:'org', :'item_many', 'loc-201', 1, 0, 0, 1);
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_inventory_item_snapshot(%L, %L, 10, 10)$$, :'org', :'item_many'),
  '22023', null, 'beyond the published ceiling the contract fails loudly instead of truncating silently');
reset role;

select * from finish();
rollback;
