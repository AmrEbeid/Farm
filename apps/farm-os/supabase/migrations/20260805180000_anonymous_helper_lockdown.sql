-- Problem: authorize(text, uuid) and user_org_ids() are SECURITY DEFINER helpers
-- exposed to the anonymous API role. Anonymous callers do not need either helper.
--
-- Intent: remove PUBLIC/anon execution while preserving the authenticated RLS and
-- service-role call paths. Function bodies, policies, tables, and data are unchanged.
--
-- Security implications: closes two unauthenticated SECURITY DEFINER entry points.
-- Rollback: grant EXECUTE to anon only after a documented public-call requirement and
-- independent security review; user_org_ids() would also require a PUBLIC grant to
-- restore its historical posture.

revoke execute on function public.authorize(text, uuid) from public, anon;
revoke execute on function public.user_org_ids() from public, anon;

grant execute on function public.authorize(text, uuid) to authenticated, service_role;
grant execute on function public.user_org_ids() to authenticated, service_role;
