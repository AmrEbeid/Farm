-- 115 — RPW-1: role-gating on the pest-scouting write paths. `op.execute` = owner/farm_manager/
-- agri_engineer/supervisor (migration 20260629150000's authorize() re-emit). A role WITHOUT op.execute
-- (accountant) must be rejected on every write RPC + direct insert; a role WITH it (supervisor) succeeds.
-- Mirrors 10_inventory_write_rolegate_test.sql's supervisor/storekeeper split.
--
-- NOTE: psql does NOT interpolate `:'var'` inside dollar-quoted ($$...$$) strings passed to
-- throws_ok/lives_ok (documented psql behaviour) — every literal below is hardcoded inside such blocks,
-- matching the convention already used by 10_inventory_write_rolegate_test.sql / 01_rls_isolation_test.sql.

begin;
select plan(8);

\set orgA '00000000-0000-0000-0000-000000000001'

select set_config('test.acct', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='accountant'), false);
select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='supervisor'), false);

-- fixture: one org-A trap, inserted as the RLS-bypassing superuser, so the "accountant can still read"
-- assertion below has something real to find.
insert into public.pest_traps (id, org_id, code, label, installed_at) values
  ('11111111-2222-3333-4444-555555555555', :'orgA', 'TRP-FIXTURE', 'مصيدة تجهيز', '2026-01-01');

-- ===== accountant: NO op.execute — every write path denied; reads still work =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.acct'), 'role','authenticated')::text, true);
set local role authenticated;

select throws_ok($$
  select public.fn_save_trap('00000000-0000-0000-0000-000000000001', 'TRP-ACCT', 'مصيدة محاسب', '2026-01-01')
$$, '42501', null, 'accountant (no op.execute) cannot register a trap via fn_save_trap');

select throws_ok($$
  insert into public.pest_traps (org_id, code, label, installed_at)
  values ('00000000-0000-0000-0000-000000000001', 'TRP-ACCT-DIRECT', 'مصيدة محاسب مباشر', '2026-01-01')
$$, '42501', null, 'accountant (no op.execute) cannot direct-insert pest_traps');

select is((select count(*) from public.pest_traps where org_id = :'orgA'), 1::bigint,
  'accountant can still read the org''s pest_traps (org-scoped reads for all members)');

reset role;

-- ===== supervisor: HAS op.execute — registers a trap, logs a catch, reports an incident =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.sup'), 'role','authenticated')::text, true);
set local role authenticated;

select lives_ok($$
  select public.fn_save_trap('00000000-0000-0000-0000-000000000001', 'TRP-SUP', 'مصيدة مشرف', '2026-01-01',
    '5248f695-6ca1-5fc3-9af1-3a0fda800f51')
$$, 'supervisor (op.execute) can register a trap via fn_save_trap');

select lives_ok($$
  select public.fn_log_trap_catch(
    (select id from public.pest_traps where org_id = '00000000-0000-0000-0000-000000000001' and code = 'TRP-SUP'),
    '2026-01-08', 4, 'رصد أسبوعي عادي')
$$, 'supervisor (op.execute) can log a trap catch via fn_log_trap_catch');

select lives_ok($$
  select public.fn_update_trap(
    (select id from public.pest_traps where org_id = '00000000-0000-0000-0000-000000000001' and code = 'TRP-SUP'),
    '2026-01-08', null, null)
$$, 'supervisor (op.execute) can mark a lure change via fn_update_trap');

select lives_ok($$
  select public.fn_report_pest_incident('2026-01-09', 'suspected',
    (select id from public.pest_traps where org_id = '00000000-0000-0000-0000-000000000001' and code = 'TRP-SUP'),
    '540c1dd2-ca9b-5e21-ad78-59969881e488', 'ثقوب واضحة في الجذع', 'جدولة حقن وقائي')
$$, 'supervisor (op.execute) can report a pest incident via fn_report_pest_incident');

-- append-only: even the writer role cannot UPDATE a catch log row directly (revoked from authenticated).
select throws_ok($$
  update public.pest_trap_catches set catch_count = 99
  where trap_id = (select id from public.pest_traps
    where org_id = '00000000-0000-0000-0000-000000000001' and code = 'TRP-SUP')
$$, '42501', null, 'pest_trap_catches is append-only — direct UPDATE is revoked even for op.execute roles');

reset role;
select * from finish();
rollback;
