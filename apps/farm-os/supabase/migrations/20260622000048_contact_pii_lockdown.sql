-- Farm OS — PII-1 (#173), CONTACT slice: staff phone/email are CONFIDENTIAL (deny-by-default).
--
-- THE BUG. `public.people.phone` and `public.people.email` are readable by ANY authenticated member
-- of the org. people's only policy is the org-scoped `tenant_all` (migration 0002): scoped by org,
-- with NO role gate. So every supervisor, storekeeper, engineer, etc. can `select phone, email from
-- people` and read every colleague's personal contact details — over-exposed staff PII. The WAGE half
-- of #173 (`people.rate`) was already remediated in migration 0046 (moved to people_compensation).
-- This is the CONTACT half.
--
-- THE FIX (deny-by-default, per CLAUDE.md least-privilege). No org member may read phone/email via the
-- table at all. There is currently NO app code that reads these as a member (lib/auth.ts selects only
-- id,name); the only readers are the service-role/admin clients in lib/seed-auth.ts and
-- e2e/global-setup.ts, which use the service_role key and BYPASS RLS *and* grants — so this lockdown
-- does not touch them. When a future feature needs staff contact info, the read path will be an
-- owner-gated SECURITY DEFINER RPC, not a direct member SELECT.
--
-- WHY THE COLUMNS STAY. `people.phone` is the demo-linking key used by seed-auth/e2e global-setup to
-- map seeded GoTrue users onto people rows (`update people set user_id=… where phone=…`). Those run as
-- service_role (RLS/grant-bypassing), so the column MUST remain on people. We do NOT move or drop it;
-- we only restrict member SELECT.
--
-- MECHANISM (mirrors migration 0045's `received_qty` / 0045 column-lockdown pattern). A bare
-- column-level `revoke select (phone, email)` is INEFFECTIVE: `authenticated` holds a TABLE-level
-- SELECT grant from migration 0009's blanket `grant select … on all tables`, and Postgres will not let
-- a column-level REVOKE restrict a role that already holds the table-wide grant. So we revoke the
-- table-level SELECT grant and re-grant SELECT on every people column EXCEPT phone and email. INSERT
-- and UPDATE grants are left exactly as they are (only SELECT of phone/email is being restricted), and
-- service_role keeps its own 0009 blanket grant, so demo-linking is unaffected.
--
-- ADR-0006 conventions: fully schema-qualified; additive/idempotent where possible.

revoke select on public.people from authenticated;

-- Re-grant SELECT on every column of public.people EXCEPT phone and email. Column list is the post-0046
-- shape (migration 0002 minus `rate`, dropped in 0046): id, org_id, name, phone, email, position,
-- employment_type, user_id, active, reports_to_person_id, created_at.
grant select (
  id,
  org_id,
  name,
  position,
  employment_type,
  user_id,
  active,
  reports_to_person_id,
  created_at
) on public.people to authenticated;

comment on column public.people.phone is
  'PII-1 (#173): staff contact PII — deny-by-default. authenticated has NO column SELECT grant; '
  'readable only by service_role (RLS/grant-bypassing demo-linking key) or a future owner-gated RPC. '
  'Column intentionally retained on people as the seed-auth/e2e user→person linking key.';
comment on column public.people.email is
  'PII-1 (#173): staff contact PII — deny-by-default. authenticated has NO column SELECT grant; '
  'readable only by service_role or a future owner-gated RPC.';
