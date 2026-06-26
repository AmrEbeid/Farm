-- Farm OS MVP-0 — 360-review (security, advisor 0028/0029): revoke anon/PUBLIC EXECUTE on the two RLS
-- helper functions.
--
-- THE FINDING. get_advisors flags `public.authorize(text,uuid)` and `public.user_org_ids()` as SECURITY
-- DEFINER functions executable by anon via /rest/v1/rpc. They were re-created in later migrations (e.g.
-- 0035 recreated authorize as the org-scoped overload) and the EXECUTE-from-PUBLIC grant came along.
--
-- EXPLOITABILITY: none today — both resolve auth.uid() (NULL for anon) → authorize() returns false and
-- user_org_ids() returns the empty set, so an anon caller learns nothing and bypasses no policy. This is a
-- defense-in-depth / advisor-hygiene change, not a live-hole fix.
--
-- THE FIX. Revoke EXECUTE from PUBLIC and anon; keep it for authenticated (RLS policies call these as the
-- invoking role, so authenticated MUST retain EXECUTE or every tenant_all policy breaks). Idempotent.

revoke execute on function public.authorize(text, uuid)  from public, anon;
revoke execute on function public.user_org_ids()         from public, anon;

-- belt-and-braces: ensure the role RLS depends on still holds EXECUTE.
grant  execute on function public.authorize(text, uuid)  to authenticated;
grant  execute on function public.user_org_ids()         to authenticated;
