-- 79 — #270 coverage: DIRECT writes to palm_status_history require op.execute + a SAME-ORG asset
-- (migration 0073), and inventory_items input CHECKs reject negative sizing (migration 0072).
--
-- THE GAP (0073). palm_status_history.tenant_all (cmd=ALL) used to be org-only on writes:
-- `WITH CHECK (org_id IN user_org_ids())` — no role gate, no cross-org asset validation. The
-- intended writer is the SECURITY DEFINER fn_update_palm_status (0039, op.execute, BYPASSRLS), so
-- the org-only policy let ANY authenticated org member (accountant/storekeeper, no op.execute)
-- INSERT history rows directly via PostgREST and set asset_id to ANOTHER org's asset — forging a
-- palm-history timeline and planting a cross-org reference. 0049 (assets) tested the assets table;
-- 0039's test only exercises the RPC path. No test exercised a DIRECT member write being blocked on
-- the ONE log table 0073 covers. 0073 re-emits tenant_all adding to the WITH CHECK:
-- authorize('op.execute', org_id) AND a same-org asset EXISTS. USING stays org-only (reads intact).
--
-- THE GAP (0072). inventory_items.safety_stock / pack_size carried NO CHECK; fn_stock_coverage trusts
-- both (negative safety_stock masks a shortage; non-positive pack_size under-orders). 0072 adds
-- `safety_stock >= 0` and `pack_size > 0`. No test asserted a negative value is rejected (23514).
--
-- op.execute = owner/farm_manager/agri_engineer/supervisor (0001); accountant/storekeeper lack it.
-- Impersonation via request.jwt.claims + `set local role authenticated` (same harness as 39/49).
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(8);

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB '00000000-0000-0000-0000-000000000002'

-- expose orgA as a GUC so the format()-built statements inside throws_ok/lives_ok can read it.
select set_config('t.orgA', :'orgA', false);

-- a seeded palm in orgA (the legit target), and the role user_ids.
select set_config('t.palm', (select id::text from public.assets
  where org_id = :'orgA' and type = 'palm' order by id limit 1), false);
select set_config('t.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'supervisor' limit 1), false);   -- HAS op.execute
select set_config('t.sk', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);  -- NO op.execute
select set_config('t.acc', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);   -- NO op.execute

select isnt(current_setting('t.palm'), '', 'fixture: a palm asset exists in orgA');

-- a foreign-org asset (created here as the BYPASSRLS test runner; rolled back at end) for the
-- cross-org-reference assertion below — only org_id + type are NOT NULL on assets.
insert into public.organization (id, name) values (:'orgB', 'cross-org fixture')
  on conflict (id) do nothing;
insert into public.assets (id, org_id, type, name)
  values ('00000000-0000-0000-0000-0000000000b2', :'orgB', 'palm', 'orgB palm');

-- ===== (1) a non-op.execute member (storekeeper) cannot DIRECTLY insert history (0073 gate) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sk'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ insert into public.palm_status_history (org_id, asset_id, status, reason)
            values ('%s'::uuid, '%s'::uuid, 'sick', 'forged') $$,
    current_setting('t.orgA', true), current_setting('t.palm', true)),
  '42501', null,
  '#270/0073: a storekeeper (no op.execute) cannot DIRECTLY insert palm_status_history (REST hole closed)');
reset role;

-- ===== (2) an accountant (also no op.execute) is likewise blocked on a direct insert =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.acc'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ insert into public.palm_status_history (org_id, asset_id, status, reason)
            values ('%s'::uuid, '%s'::uuid, 'dead', 'forged') $$,
    current_setting('t.orgA', true), current_setting('t.palm', true)),
  '42501', null,
  '#270/0073: an accountant (no op.execute) cannot DIRECTLY insert palm_status_history');

-- ===== (3) reads stay org-only — USING is unchanged, so a non-op.execute member still SELECTs =====
select lives_ok(
  format($$ select count(*) from public.palm_status_history where org_id = '%s' $$,
    current_setting('t.orgA', true)),
  '#270/0073: a non-op.execute member can still READ org history (USING unchanged)');
reset role;

-- ===== (4) an op.execute member (supervisor) CAN directly insert a same-org row (gate not over-broad) ==
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  format($$ insert into public.palm_status_history (org_id, asset_id, status, reason)
            values ('%s'::uuid, '%s'::uuid, 'watch', 'legit field-role write') $$,
    current_setting('t.orgA', true), current_setting('t.palm', true)),
  '#270/0073: a supervisor (op.execute) CAN insert a same-org history row (gate not over-broad)');

-- ===== (5) cross-org forging blocked: even a supervisor cannot reference ANOTHER org''s asset =====
-- org_id=orgA passes user_org_ids + op.execute, but the same-org EXISTS guard fails (asset is orgB''s).
select throws_ok(
  format($$ insert into public.palm_status_history (org_id, asset_id, status, reason)
            values ('%s'::uuid, '00000000-0000-0000-0000-0000000000b2'::uuid, 'sick', 'cross-org forge') $$,
    current_setting('t.orgA', true)),
  '42501', null,
  '#270/0073: a supervisor cannot plant a CROSS-ORG asset reference (same-org EXISTS guard)');
reset role;

-- ===== inventory_items input CHECKs (migration 0072) — run as the BYPASSRLS test runner so the =====
-- ===== row-level role gate is out of the picture and the CHECK constraint is what raises (23514). ====
select throws_ok(
  format($$ insert into public.inventory_items (org_id, name, safety_stock)
            values ('%s'::uuid, 'neg safety', -1) $$, current_setting('t.orgA', true)),
  '23514', null,
  '#270/0072: a NEGATIVE safety_stock is rejected by the inventory_items_safety_stock_nonneg CHECK');

select throws_ok(
  format($$ insert into public.inventory_items (org_id, name, pack_size)
            values ('%s'::uuid, 'nonpos pack', 0) $$, current_setting('t.orgA', true)),
  '23514', null,
  '#270/0072: a non-positive pack_size (0) is rejected by the inventory_items_pack_size_positive CHECK');

select * from finish();
rollback;
