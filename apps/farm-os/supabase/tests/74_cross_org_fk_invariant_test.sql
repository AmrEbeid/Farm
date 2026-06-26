-- 74 — defensive invariant (the durable form of the #306 cross-org-FK work): every member-writable
-- (authenticated-INSERT) FK to an org-scoped table must be org-validated — either in the table's
-- INSERT/ALL WITH CHECK (the EXISTS-same-org pattern) OR by one of the documented non-RLS mechanisms
-- below. Fails if a FUTURE migration adds a member-writable cross-org FK without validating it —
-- replacing the manual "is it complete?" spot-checks with one authoritative CI gate.
--
-- MATCH PRECISION: a policy validates THIS fk iff its WITH CHECK references the qualified column
-- `<child>.<fk_col>` — which the same-org EXISTS pattern always does (`... where t.id = <child>.<fk_col>
-- and t.org_id = <child>.org_id`), and which Postgres stores fully-qualified in pg_policies.with_check.
-- An EARLIER version of this test matched the bare PARENT TABLE NAME as a substring; that false-passed
-- event_assets.asset_id (the child name "event_assets" contains "assets") and assets.parent_id (the
-- self-ref "assets" appears in its own policy) — both proven exploitable. The `<child>.<fk_col>` match
-- has no such collision: a column is "validated" only if its own qualified name appears in the predicate.
--
-- Documented non-RLS validations (each verified in the #306 reviews):
--   inventory_bin.item_id        — fn_post_movement resolves the item's org and rejects a cross-org caller
--   people.reports_to_person_id  — the people_reports_to_same_org trigger (self-ref; RLS can't express it)
--   assets.parent_id             — the assets_parent_same_org trigger (self-ref; RLS can't express it)
-- (palm_status_history.asset_id is NOT exempt — it is genuinely RLS-gated, so the precise match validates
--  it directly; keeping it exempt would hide a future regression of that real gate.)
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(2);

with member_fk as (
  select (select relname from pg_class where oid=c.conrelid) as child,
         a.attname as fk_col
  from pg_constraint c
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.connamespace='public'::regnamespace
    and a.attname <> 'org_id'
    and exists (select 1 from pg_attribute oa where oa.attrelid=c.confrelid and oa.attname='org_id' and not oa.attisdropped)
    and has_table_privilege('authenticated', c.conrelid, 'INSERT')
)
select cmp_ok((select count(*)::int from member_fk), '>=', 15,
  'non-vacuity: the detector finds many member-writable cross-org FKs to check');

with member_fk as (
  select (select relname from pg_class where oid=c.conrelid) as child,
         a.attname as fk_col
  from pg_constraint c
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.connamespace='public'::regnamespace
    and a.attname <> 'org_id'
    and exists (select 1 from pg_attribute oa where oa.attrelid=c.confrelid and oa.attname='org_id' and not oa.attisdropped)
    and has_table_privilege('authenticated', c.conrelid, 'INSERT')
),
exempt(child, fk_col) as (values
  ('inventory_bin','item_id'),
  ('people','reports_to_person_id'),
  ('assets','parent_id')
)
select is(
  (select coalesce(string_agg(m.child||'.'||m.fk_col, ', ' order by m.child||'.'||m.fk_col), '(none)')
     from member_fk m
     where not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=m.child
                       and p.cmd in ('ALL','INSERT')
                       and coalesce(p.with_check,'') ilike '%'||m.child||'.'||m.fk_col||'%')
       and not exists (select 1 from exempt e where e.child=m.child and e.fk_col=m.fk_col)),
  '(none)',
  'invariant: every member-writable cross-org FK is RLS-validated (precise <child>.<fk_col> match), except the documented RPC/trigger set');

select * from finish();
rollback;
