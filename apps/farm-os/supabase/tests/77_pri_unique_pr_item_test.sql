-- 77 — C1 (#270): purchase_request_items holds at most ONE line per (pr_id, item_id). fn_post_receipt
-- keys received_qty + the p_lines receive-qty by item_id, so a duplicate-item line would double-post the
-- receipt into on_hand and MASK a shortage (non-negotiable #1). The unique constraint (0074) makes the
-- item-per-PR uniqueness the receipt code assumes explicit, failing fast at creation instead. A different
-- item in the same PR stays allowed.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(3);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set prid  '07700000-0000-0000-0000-0000000000c1'
\set itm1  '07700000-0000-0000-0000-0000000000d1'
\set itm2  '07700000-0000-0000-0000-0000000000d2'

insert into public.inventory_items (id, org_id, name) values
  (:'itm1', :'orgA', 'صنف ج1'), (:'itm2', :'orgA', 'صنف ج2');
insert into public.purchase_requests (id, org_id, code) values (:'prid', :'orgA', 'PR-C1TEST');
insert into public.purchase_request_items (pr_id, org_id, item_id) values (:'prid', :'orgA', :'itm1');

-- a SECOND line for the same item in the same PR is rejected (the C1 double-post source)
select throws_ok(
  format($$ insert into public.purchase_request_items (pr_id, org_id, item_id) values (%L, %L, %L) $$,
         :'prid', :'orgA', :'itm1'),
  '23505', null, 'C1 #270: a 2nd line for the SAME item in a PR is rejected (no double-post)');

-- a DIFFERENT item in the same PR is allowed (no over-constraint)
select lives_ok(
  format($$ insert into public.purchase_request_items (pr_id, org_id, item_id) values (%L, %L, %L) $$,
         :'prid', :'orgA', :'itm2'),
  'C1 #270: a DIFFERENT item in the same PR is allowed');

select is(
  (select count(*)::int from pg_constraint
     where conrelid = 'public.purchase_request_items'::regclass
       and conname = 'purchase_request_items_pr_item_uniq' and contype = 'u'),
  1, 'C1 #270: the unique (pr_id, item_id) constraint is present');

select * from finish();
rollback;
