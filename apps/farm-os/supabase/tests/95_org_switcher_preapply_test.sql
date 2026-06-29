-- 95 — #383: pre-apply hardening of the org-switcher migrations (migration 0095).
-- (1) user_member_org_ids() must be anon-locked (least privilege, consistent with #229).
-- (2) fn_update_org_settings must PRESERVE fiscal_year_start when the arg is omitted (no data-loss).
-- Run via supabase test db or test-shims/run-pgtap-local.sh.
begin;
select plan(4);

\set orgA '00000000-0000-0000-0000-000000000001'

-- ── (1) least-privilege grant on the full-membership helper ──────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.user_member_org_ids()', 'EXECUTE'),
  '#383: anon cannot EXECUTE user_member_org_ids()');
select ok(has_function_privilege('authenticated', 'public.user_member_org_ids()', 'EXECUTE'),
  '#383: authenticated CAN EXECUTE user_member_org_ids() (RLS helper + switcher)');

-- ── (2) fiscal_year_start preserve-on-null (the data-loss fix) ───────────────────────────────────
-- the seed org has fiscal_year_start = 2025-01-01.
select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

-- update ONLY the name (omit locale/currency/area_unit AND fiscal_year_start).
select lives_ok(
  $$ select public.fn_update_org_settings('00000000-0000-0000-0000-000000000001', 'مزارع عبيد') $$,
  '#383: owner updates only the name, omitting the optional args');
reset role;

select is((select fiscal_year_start from public.organization where id = :'orgA'), '2025-01-01'::date,
  '#383: omitting p_fiscal_year_start PRESERVES the existing value (not wiped to NULL)');

select * from finish();
rollback;
