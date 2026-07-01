-- 99 — #494: the plan subsystem + event quantities write to audit_log (migration 20260701100000).
-- fn_audit is generic (logs coalesce(new.org_id, old.org_id), id, to_jsonb), so one functional insert
-- (plans — minimal FKs) plus a structural check that all five triggers are wired covers the mechanism.
-- Rows seeded as superuser. orgA from seed.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(6);

\set orgA '00000000-0000-0000-0000-000000000001'
\set plan 'aaaa0494-0000-0000-0000-000000000001'

-- functional: a plans insert is audited (plans only requires org_id)
insert into public.plans (id, org_id) values (:'plan', :'orgA');
select is(
  (select count(*)::int from public.audit_log where entity_type = 'plan' and entity_id = :'plan'),
  1, '#494: a plans change is written to audit_log (entity_type=plan)');

-- structural: every targeted table carries an fn_audit trigger
select is(
  (select count(*)::int from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     join pg_proc p on p.oid = t.tgfoid
    where c.relname = 'plan_operations' and p.proname = 'fn_audit' and not t.tgisinternal),
  1, '#494: plan_operations has an fn_audit trigger');

select is(
  (select count(*)::int from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     join pg_proc p on p.oid = t.tgfoid
    where c.relname = 'plan_material_requirements' and p.proname = 'fn_audit' and not t.tgisinternal),
  1, '#494: plan_material_requirements has an fn_audit trigger');

select is(
  (select count(*)::int from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     join pg_proc p on p.oid = t.tgfoid
    where c.relname = 'plan_labor_requirements' and p.proname = 'fn_audit' and not t.tgisinternal),
  1, '#494: plan_labor_requirements has an fn_audit trigger');

select is(
  (select count(*)::int from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     join pg_proc p on p.oid = t.tgfoid
    where c.relname = 'plans' and p.proname = 'fn_audit' and not t.tgisinternal),
  1, '#494: plans has an fn_audit trigger');

select is(
  (select count(*)::int from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     join pg_proc p on p.oid = t.tgfoid
    where c.relname = 'quantities' and p.proname = 'fn_audit' and not t.tgisinternal),
  1, '#494: quantities has an fn_audit trigger');

select * from finish();
rollback;
