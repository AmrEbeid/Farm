-- Problem (Supabase advisor ERROR `security_definer_view`, issue #229): `v_cost_center_rollup` and
--   `v_cost_center_reconciliation_flags` are SECURITY DEFINER views (the Postgres default — `security_invoker`
--   unset), granted SELECT to `authenticated`, and DO NOT self-filter by org. A definer view executes as the
--   view OWNER (postgres, a superuser that bypasses RLS), so an authenticated user could read **cross-org**
--   rollup/flags rows via `/rest/v1/v_cost_center_rollup` (or `_reconciliation_flags`) with no org filter —
--   a latent multi-tenant isolation leak (the #1 non-negotiable). (`anon` is NOT granted, so not anon-reachable.)
--
-- Intent: switch both views to `security_invoker = true` so they execute as the CALLER and enforce the caller's
--   RLS on every base table. Verified safe: all base tables the views read — cost_centers, sectors, accounts,
--   journal_entries, journal_lines — have an `authenticated` SELECT grant AND an RLS SELECT policy (finance.read),
--   so authorized owner/accountant reads (the /finance/insights + owner-dashboard surfaces) keep working while a
--   cross-org caller is now filtered to their own org by the base-table policies.
--
-- Security implications: TIGHTENS tenant isolation. No data change, no grant change, no policy change — only the
--   views' execution context. Confirm post-apply that the two `security_definer_view` advisor ERRORs clear.
--
-- Rollback: `alter view public.<v> reset (security_invoker);` reverts to definer — DO NOT, it re-opens the leak.
--
-- Idempotent: `set (security_invoker = true)` is idempotent, so a replay (and the MCP apply under its own version)
--   is a safe no-op.

alter view public.v_cost_center_rollup set (security_invoker = true);
alter view public.v_cost_center_reconciliation_flags set (security_invoker = true);
