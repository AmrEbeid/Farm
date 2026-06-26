-- 60 — #235: the newly-audited tables (supplier / purchase_request_item / inventory_item /
-- responsibility_assignment) write to audit_log. fn_audit is generic (logs coalesce(new.org_id,
-- old.org_id), id, to_jsonb), so proving it fires for the two minimal-FK tables + the PR line, plus a
-- structural check that all four triggers are wired, covers the mechanism. Rows seeded as superuser.
-- POTASSIUM item + orgA from seed.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(4);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'
\set sup  'aaaa0060-0000-0000-0000-0000000000a1'
\set inv  'aaaa0060-0000-0000-0000-0000000000a2'
\set pr   'aaaa0060-0000-0000-0000-0000000000a3'
\set pri  'aaaa0060-0000-0000-0000-0000000000a4'

-- supplier insert is audited
insert into public.suppliers (id, org_id, name) values (:'sup', :'orgA', 'مورد اختبار');
select is(
  (select count(*)::int from public.audit_log where entity_type = 'supplier' and entity_id = :'sup'),
  1, '#235: a suppliers change is written to audit_log (entity_type=supplier)');

-- inventory_item insert is audited
insert into public.inventory_items (id, org_id, name) values (:'inv', :'orgA', 'صنف اختبار');
select is(
  (select count(*)::int from public.audit_log where entity_type = 'inventory_item' and entity_id = :'inv'),
  1, '#235: an inventory_items change is written to audit_log (entity_type=inventory_item)');

-- purchase_request_item insert is audited (qty > 0 per 0056; parent PR seeded for the FK)
insert into public.purchase_requests (id, org_id, code, status) values (:'pr', :'orgA', 'PR-AUD-60', 'draft');
insert into public.purchase_request_items (id, pr_id, org_id, item_id, qty, unit)
  values (:'pri', :'pr', :'orgA', :'item', 10, 'kg');
select is(
  (select count(*)::int from public.audit_log
     where entity_type = 'purchase_request_item' and entity_id = :'pri'),
  1, '#235: a purchase_request_items change is written to audit_log (entity_type=purchase_request_item)');

-- structural: all four new audit triggers are wired
select is(
  (select count(distinct c.relname)::int
     from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal and pg_get_triggerdef(t.oid) ilike '%fn_audit%'
       and c.relname in ('suppliers','purchase_request_items','inventory_items','responsibility_assignments')),
  4, '#235: all four sensitive tables now carry an fn_audit trigger');

select * from finish();
rollback;
