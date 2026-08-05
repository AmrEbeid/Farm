begin;

select plan(8);

select ok(
  not has_function_privilege('public', 'public.authorize(text, uuid)', 'execute'),
  'PUBLIC cannot execute authorize'
);
select ok(
  not has_function_privilege('anon', 'public.authorize(text, uuid)', 'execute'),
  'anon cannot execute authorize'
);
select ok(
  has_function_privilege('authenticated', 'public.authorize(text, uuid)', 'execute'),
  'authenticated can execute authorize'
);
select ok(
  has_function_privilege('service_role', 'public.authorize(text, uuid)', 'execute'),
  'service_role can execute authorize'
);

select ok(
  not has_function_privilege('public', 'public.user_org_ids()', 'execute'),
  'PUBLIC cannot execute user_org_ids'
);
select ok(
  not has_function_privilege('anon', 'public.user_org_ids()', 'execute'),
  'anon cannot execute user_org_ids'
);
select ok(
  has_function_privilege('authenticated', 'public.user_org_ids()', 'execute'),
  'authenticated can execute user_org_ids'
);
select ok(
  has_function_privilege('service_role', 'public.user_org_ids()', 'execute'),
  'service_role can execute user_org_ids'
);

select * from finish();
rollback;
