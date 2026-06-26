-- 57 — #235: a purchase-request line must order a strictly positive quantity. Before 0056,
-- purchase_request_items.qty had no positivity CHECK, so a 0/negative line was accepted but left the PR
-- permanently un-receivable (fn_post_receipt posts a 0|negative movement → fn_post_movement 22023 →
-- rollback). 0056 adds CHECK(qty > 0) (NOT a NOT NULL — a NULL qty already fails safely via the
-- tests/23 atomic rollback and the app never writes it; see the migration's SCOPE NOTE). Inserts run as
-- superuser — the CHECK is a table invariant, fired regardless of role. POTASSIUM item + orgA from seed;
-- a draft PR is seeded for the FK. NB: the zero-qty case is the one UNIQUELY closed by this CHECK — a
-- negative qty is also caught by 0045's pri_received_qty_valid (received_qty 0 <= -5 is false), so the
-- negative assertion below is defense-in-depth, while the zero assertion is the load-bearing one.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(4);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'
\set pr   'eeee0057-0000-0000-0000-0000000000a1'

insert into public.purchase_requests (id, org_id, code, status)
  values (:'pr', :'orgA', 'PR-QTY-0057', 'draft');

-- ===== a zero / negative / null qty line is rejected =====
select throws_ok(
  format($$ insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
            values (%L, %L, %L, 0, 'kg') $$, :'pr', :'orgA', :'item'),
  '23514', null,
  '#235: a zero-qty PR line is rejected (would be un-receivable)');

select throws_ok(
  format($$ insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
            values (%L, %L, %L, -5, 'kg') $$, :'pr', :'orgA', :'item'),
  '23514', null,
  '#235: a negative-qty PR line is rejected');

-- NOTE: a NULL qty is intentionally NOT rejected here — it already fails safely (tests/23 atomicity)
-- and a CHECK passes on NULL. See the migration's SCOPE NOTE. Only 0/negative are forbidden.

-- ===== a valid positive qty still inserts =====
select lives_ok(
  format($$ insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
            values (%L, %L, %L, 10, 'kg') $$, :'pr', :'orgA', :'item'),
  '#235: a positive-qty line still inserts normally');

-- structural invariant: the positivity CHECK exists
select is(
  (select count(*)::int from pg_constraint c join pg_class t on t.oid = c.conrelid
     where t.relname = 'purchase_request_items' and c.contype = 'c' and c.conname = 'pri_qty_positive'),
  1,
  '#235: pri_qty_positive CHECK is present on purchase_request_items');

select * from finish();
rollback;
