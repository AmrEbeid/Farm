-- Farm OS — #317/#229 grant hygiene: close prod default-privilege drift.
--
-- Prod evidence (2026-06-29, issue #317) showed Supabase platform default ACLs had granted broad
-- table privileges to the client roles on tables created after the early lockdown migrations:
-- `anon=arwdDxtm` / `authenticated=arwdDxtm`. FORCE RLS and policies prevented a live row leak, but
-- DELETE/TRUNCATE grants are unnecessary defense-in-depth exposure, and TRUNCATE is especially wrong
-- for client roles because it is table-level destructive access rather than row-policy-governed DML.
--
-- Current-table sweep:
--   * no `anon`/`authenticated` TRUNCATE on any public table
--   * no `anon`/`authenticated` DELETE on any public table except authenticated `plan_checks`
--     (the plan builder recompute path intentionally deletes and reinserts checks; RLS policy 0069
--      still gates the row deletion on plan.write)
--
-- Future-table posture:
--   * revoke public-schema table default privileges from `anon`/`authenticated` for the `postgres`
--     grantor role observed in prod. New tables must grant their intended SELECT/INSERT/UPDATE access
--     explicitly, matching the post-0046 migration pattern.
--
-- Review/apply note: `ALTER DEFAULT PRIVILEGES` affects only objects created after this migration and
-- only for the targeted grantor role. The 2026-06-30 prod pre-apply probe showed table default ACL
-- grantors `postgres` and `supabase_admin`. The migration role can administer the `postgres` default ACL
-- but is not a member of `supabase_admin`, so that platform-owned default ACL is reported as a residual
-- follow-up instead of failing the deploy.

-- Existing public tables: remove destructive client-role privileges.
revoke truncate on all tables in schema public from anon, authenticated;
revoke delete   on all tables in schema public from anon, authenticated;

-- Preserve the single intentional client DELETE path. Row deletion remains RLS-gated by migration 0069.
grant delete on public.plan_checks to authenticated;

-- Future public tables created by the Supabase/Postgres owner role should not auto-expose to clients.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    if pg_has_role(current_user, 'supabase_admin', 'member') then
      execute 'alter default privileges for role supabase_admin in schema public revoke all privileges on tables from anon, authenticated';
    else
      raise notice 'supabase_admin public table default ACL requires platform-owner remediation; migration role % is not a member', current_user;
    end if;
  end if;
end
$$;
