-- Owner correction: the saved public-site English company name is Ebeid, not Obaid/Obeid.
-- Exercise the real migration twice to prove the live-row patch and no-op replay behavior.
begin;
select plan(5);

\set org '00000000-0000-0000-0000-000000000001'

insert into public.site_content (org_id, content)
values (
  :'org',
  jsonb_build_object(
    'brand', jsonb_build_object(
      'registeredName', jsonb_build_object('en', 'Obaid Company for Dates')
    ),
    'certifications', jsonb_build_object(
      'items', jsonb_build_array(
        '{}'::jsonb,
        jsonb_build_object(
          'detail', jsonb_build_object(
            'en', 'Obaid Company for Dates · Reg. QEGY1425102400002 · Code 55.09.30.03.DAF'
          )
        )
      )
    ),
    'about', jsonb_build_object(
      'heading', jsonb_build_object('en', 'Owner-edited copy')
    )
  )
)
on conflict (org_id) do update
set content = excluded.content;

\ir '../migrations/20260827120000 correct ebeid company name.sql'

select is(
  (select content #>> '{brand,registeredName,en}' from public.site_content where org_id = :'org'),
  'Ebeid Company for Dates',
  'saved registered company name is corrected'
);
select is(
  (select content #>> '{certifications,items,1,detail,en}' from public.site_content where org_id = :'org'),
  'Ebeid Company for Dates · Reg. QEGY1425102400002 · Code 55.09.30.03.DAF',
  'saved GACC company detail is corrected'
);
select is(
  (select content #>> '{about,heading,en}' from public.site_content where org_id = :'org'),
  'Owner-edited copy',
  'unrelated owner-edited content is preserved'
);
select cmp_ok(
  (select count(*)::int from public.audit_log where entity_type = 'site_content' and org_id = :'org'),
  '>=',
  2,
  'the initial fixture and first correction are audited'
);

select set_config(
  'test.ebeid_company_name_audit_count',
  (select count(*)::text from public.audit_log where entity_type = 'site_content' and org_id = :'org'),
  true
);

\ir '../migrations/20260827120000 correct ebeid company name.sql'

select is(
  (select count(*)::int from public.audit_log where entity_type = 'site_content' and org_id = :'org'),
  current_setting('test.ebeid_company_name_audit_count')::int,
  'replaying the correction is a no-op with no false audit event'
);

select * from finish();
rollback;
