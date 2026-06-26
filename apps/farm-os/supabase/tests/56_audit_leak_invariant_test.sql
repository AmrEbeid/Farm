-- 56 — defensive audit-PII-safety invariant (recommended in the #270 H2 review; column-restriction arm
-- added per the #301 review). fn_audit logs the FULL row (to_jsonb(NEW)/(OLD)) to audit_log, whose
-- audit_read is org-scoped. So auditing a table whose base read is MORE restricted than org-wide leaks
-- the restricted data to any org member. There are TWO restriction mechanisms, and this test pins both:
--   ROLE-restricted read  — an authorize() gate in the table's RLS policy (the H2 people_compensation
--                            wage class). Safe iff audit_read gates that entity_type.
--   COLUMN-restricted read — a column the `authenticated` role cannot SELECT (the people phone/email
--                            class, via the 0048 column-GRANT lockdown). Safe ONLY if the table is not
--                            audited as-is (it would need a redacting audit fn). RLS-policy text does
--                            NOT reveal this, so the role arm alone would miss it — hence this arm.
-- This FAILS if a future migration audits a role-restricted table without gating it, OR audits a
-- column-restricted table (e.g. gives `people` an fn_audit trigger) — catching the whole leak class.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(4);

-- ── ROLE-restriction arm ──────────────────────────────────────────────────────────────────────────

-- (1) NON-VACUITY GUARD (role): the invariant (2) is only meaningful if the role detector finds the
-- known case (people_compensation). If a regex/policy-shape change silently empties it, (2) would pass
-- vacuously; this catches that.
with audited as (
  select distinct c.relname as tbl,
         (regexp_match(pg_get_triggerdef(t.oid), $re$fn_audit\('([a-z_]+)'\)$re$))[1] as entity_type
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
    and pg_get_triggerdef(t.oid) ~ $re$fn_audit\('[a-z_]+'\)$re$
)
select is(
  (select count(*)::int from audited a
     where a.entity_type = 'people_compensation'
       and exists (select 1 from pg_policies p
                   where p.schemaname='public' and p.tablename=a.tbl
                     and p.cmd in ('SELECT','ALL') and coalesce(p.qual,'') ilike '%authorize%')),
  1,
  'non-vacuity (role): the detector finds people_compensation as a role-restricted audited table');

-- (2) INVARIANT (role): no role-restricted audited table is left ungated in audit_read.
with audited as (
  select distinct c.relname as tbl,
         (regexp_match(pg_get_triggerdef(t.oid), $re$fn_audit\('([a-z_]+)'\)$re$))[1] as entity_type
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
    and pg_get_triggerdef(t.oid) ~ $re$fn_audit\('[a-z_]+'\)$re$
),
role_restricted as (
  select a.tbl, a.entity_type
  from audited a
  where exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = a.tbl
      and p.cmd in ('SELECT','ALL') and coalesce(p.qual,'') ilike '%authorize%'
  )
),
audit_gate as (
  select coalesce(qual,'') as g
  from pg_policies
  where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_read'
)
select is(
  (select count(*)::int
     from role_restricted r
     where not exists (select 1 from audit_gate where g like '%' || r.entity_type || '%')),
  0,
  'audit invariant (role): every role-restricted audited table is gated in audit_read (no H2 wage-leak class)');

-- ── COLUMN-restriction arm ────────────────────────────────────────────────────────────────────────

-- (3) NON-VACUITY GUARD (column): the invariant (4) is only meaningful if the column detector finds the
-- known case (people, whose phone/email `authenticated` cannot SELECT via the 0048 lockdown). Proves
-- has_column_privilege resolves the grants in this environment.
select ok(
  (select count(*)
     from pg_attribute att
     where att.attrelid = 'public.people'::regclass and att.attnum > 0 and not att.attisdropped
       and not has_column_privilege('authenticated', 'public.people'::regclass, att.attname, 'SELECT')) > 0,
  'non-vacuity (column): the detector finds people has column(s) authenticated cannot SELECT (phone/email)');

-- (4) INVARIANT (column): no AUDITED table has a column `authenticated` cannot SELECT — else the audit
-- mirror leaks that column (the people class). `people` must therefore stay unaudited until a redacting
-- audit fn exists. (people_compensation is ROLE-restricted, not column-restricted — authenticated holds
-- table-level SELECT; RLS filters rows — so it is correctly not flagged here; the role arm covers it.)
with audited as (
  select distinct c.relname as tbl
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
    and pg_get_triggerdef(t.oid) ~ $re$fn_audit\('[a-z_]+'\)$re$
)
select is(
  (select count(distinct a.tbl)::int
     from audited a
     join pg_attribute att on att.attrelid = ('public.' || a.tbl)::regclass
       and att.attnum > 0 and not att.attisdropped
     where not has_column_privilege('authenticated', ('public.' || a.tbl)::regclass, att.attname, 'SELECT')),
  0,
  'audit invariant (column): no audited table has a column authenticated cannot read (no people-class column-PII leak)');

select * from finish();
rollback;
