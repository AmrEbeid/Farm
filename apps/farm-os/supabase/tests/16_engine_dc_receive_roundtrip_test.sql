-- 16 — ENGINE-DC: the approve→receive round-trip must stay disjoint (migration 0018 invariant).
-- on_hand = Σ(receipt movements); forward projection = APPROVED-not-received PRs. The model hinges on
-- the hand-off at receipt: a received PR flips 'approved'→'received' (leaves the projection) at the same
-- moment a receipt lands in on_hand. This pins that TRANSITION ("approved a PO, then received it"),
-- where a regression would re-introduce the double-count.
--
-- Self-contained + current_date-relative (so the in-window PO is genuinely future under the #270 C2
-- forward-anchor, migration 0094): own item on_hand 300, a fertilization op TODAY needs 500 →
-- v_period_start = current_date, baseline forward PAB[period 2] = 300 - 500 = -200.
-- Run via supabase test db or test-shims/run-pgtap-local.sh.
begin;
select plan(3);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item '16160001-0000-0000-0000-000000000016'
\set plan '16160002-0000-0000-0000-000000000016'
\set op   '16160003-0000-0000-0000-000000000016'
\set pr   '16160000-0000-0000-0000-0000000000a1'

insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'DC-RT item', 'kg', 1, 0, 0);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved)
  values (:'orgA', :'item', 'main', 0, 0);
-- opening 300 via a receipt movement (NOT a direct on_hand write) — so fn_bin_rebuild after the receive
-- in step 2 keeps on_hand consistent (rebuild recomputes on_hand = Σ receipt movements).
insert into public.inventory_movements (org_id, item_id, type, qty, location, occurred_at)
  values (:'orgA', :'item', 'receipt', 300, 'main', current_date - 30);
select public.fn_bin_rebuild(:'item', 'main');   -- on_hand → 300
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'approved');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'op', :'orgA', :'plan', 'fertilization', current_date, 'planned');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', :'op', :'item', 500, 'kg');

-- ── baseline: no scheduled supply ────────────────────────────────────────────────────────────────
select set_config('t.pab2_base',
  ((public.fn_stock_coverage(:'item', 'main', 8))->'pab'->>1), false);

-- ── 1) APPROVE a PO for 100 kg needed TODAY (period 1) → it must project forward ONCE ───────────────
set local session_replication_role = replica;
insert into public.purchase_requests (id, org_id, code, requested_by, needed_by, reason, plan_id, status, version)
  values (:'pr', :'orgA', 'PR-DC-RT', gen_random_uuid(), current_date, 'dc roundtrip', :'plan', 'approved', 1);
insert into public.purchase_request_items (org_id, pr_id, item_id, qty, unit)
  values (:'orgA', :'pr', :'item', 100, 'kg');
set local session_replication_role = origin;

select set_config('t.pab2_approved',
  ((public.fn_stock_coverage(:'item', 'main', 8))->'pab'->>1), false);
select is(
  current_setting('t.pab2_approved')::numeric - current_setting('t.pab2_base')::numeric, 100::numeric,
  'ENGINE-DC: an approved open PO raises forward PAB by its qty once (not twice)');

-- ── 2) RECEIVE the PO: PR flips approved→received (leaves projection) AND a receipt lands in on_hand.
--        Forward picture must be UNCHANGED — the qty moved source, it did not duplicate.
update public.purchase_requests set status = 'received' where id = :'pr';
insert into public.inventory_movements (org_id, item_id, type, qty, location, occurred_at)
  values (:'orgA', :'item', 'receipt', 100, 'main', current_date + 2);
select public.fn_bin_rebuild(:'item', 'main');
select is(
  ((public.fn_stock_coverage(:'item', 'main', 8))->'pab'->>1)::numeric,
  current_setting('t.pab2_approved')::numeric,
  'ENGINE-DC: receiving the PO leaves forward PAB unchanged — on_hand and projection stay disjoint');

-- ── 3) the real period-1 shortage (500 demand vs 400 available) is never masked ─────────────────────
select is(
  ((public.fn_stock_coverage(:'item', 'main', 8))->>'shortage')::boolean, true,
  'ENGINE-DC: the receipt does not mask the real period-1 shortage');

select * from finish();
rollback;
