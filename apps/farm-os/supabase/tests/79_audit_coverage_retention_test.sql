-- 79 — audit-coverage RETENTION invariant. test 56 guards that AUDITED tables don't leak PII/role-
-- restricted columns; test 60 behaviorally checks four specific triggers. NOTHING guards that the
-- sensitive tables STAY audited: a future re-emit or migration that DROPS an audit trigger silently
-- removes a table from the audit trail, and test 56 won't catch it (the table is no longer in the
-- audited set it inspects). This pins the curated must-audit set — every one must retain a row-level
-- trigger running fn_audit / fn_audit_people / fn_audit_org_member. Adding a NEW sensitive table forces
-- an explicit decision here (add it to the list). Catalog-level, so it auto-holds no matter which
-- migration lands next.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(2);

with must_audit(tbl) as (values
  ('purchase_requests'), ('purchase_request_items'), ('budgets'), ('budget_lines'), ('expenses'),
  ('farm_event'), ('inventory_items'), ('inventory_movements'), ('suppliers'), ('people'),
  ('people_compensation'), ('organization_member'), ('responsibility_assignments')
)
select is(
  (select coalesce(string_agg(m.tbl, ', ' order by m.tbl), '(none)')
     from must_audit m
     where not exists (
       select 1 from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = m.tbl and not t.tgisinternal
         and pg_get_triggerdef(t.oid) ilike '%fn_audit%')),
  '(none)',
  'audit retention: every curated sensitive table still carries an fn_audit* trigger');

-- non-vacuity: the curated set is populated (a refactor can't empty it into a silent pass)
select cmp_ok(
  (select count(*)::int from (values
    ('purchase_requests'),('purchase_request_items'),('budgets'),('budget_lines'),('expenses'),
    ('farm_event'),('inventory_items'),('inventory_movements'),('suppliers'),('people'),
    ('people_compensation'),('organization_member'),('responsibility_assignments')) v(t)),
  '>=', 13, 'audit retention: the must-audit set is populated (>=13 tables)');

select * from finish();
rollback;
