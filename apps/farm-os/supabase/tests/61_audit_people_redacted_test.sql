-- 61 — #235: people registry changes are audited WITH phone/email redacted. The generic fn_audit logs
-- the full row (to_jsonb), which would leak people's 0048-confidential phone/email via the org-scoped
-- audit_read; fn_audit_people (0060) strips those keys. This test is also the redaction GUARANTEE that
-- tests/56's generic column-invariant delegates to people's dedicated fn for — assertion 3 fails if a
-- future restricted column is not redacted. Seeded as superuser.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(4);

\set orgA '00000000-0000-0000-0000-000000000001'
\set p    'acce0061-0000-0000-0000-0000000000a1'

-- a person carrying the confidential columns
insert into public.people (id, org_id, name, phone, email, position)
  values (:'p', :'orgA', 'اختبار التدقيق', '0500000000', 'staff@example.com', 'engineer');

-- (1) the change is audited under entity_type='people'
select is(
  (select count(*)::int from public.audit_log where entity_type = 'people' and entity_id = :'p'),
  1, '#235: a people change is written to audit_log (entity_type=people)');

-- (2) phone + email are redacted from the audit row
select ok(
  (select not (after ? 'phone') and not (after ? 'email')
     from public.audit_log where entity_type = 'people' and entity_id = :'p' order by id desc limit 1),
  '#235: fn_audit_people redacts phone + email from the audit row');

-- (3) GUARANTEE: NO column authenticated cannot SELECT appears in the audit row (catches a future
--     restricted people column that fn_audit_people would need to be taught to redact)
select is(
  (select count(*)::int
     from pg_attribute att
     where att.attrelid = 'public.people'::regclass and att.attnum > 0 and not att.attisdropped
       and not has_column_privilege('authenticated', 'public.people'::regclass, att.attname, 'SELECT')
       and (select after from public.audit_log
              where entity_type = 'people' and entity_id = :'p' order by id desc limit 1) ? att.attname),
  0, '#235: every column authenticated cannot read is redacted from the people audit row (no PII leak)');

-- (4) the audit is still useful — non-PII registry fields are captured
select ok(
  (select (after ? 'name') and (after ? 'org_id') and (after ? 'position') and (after ? 'user_id')
     from public.audit_log where entity_type = 'people' and entity_id = :'p' order by id desc limit 1),
  '#235: the people audit row still captures the non-PII registry fields (name/org_id/position/user_id)');

select * from finish();
rollback;
