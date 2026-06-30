-- 0100 — revoke anon EXECUTE on the two action RPCs (least-privilege; Supabase advisor lint 0028).
--
-- GAP (defense-in-depth, non-exploitable but real). The live security advisor flagged that the `anon`
-- role can EXECUTE `public.fn_set_active_org(uuid)` and `public.fn_update_org_settings(...)` via
-- `/rest/v1/rpc/*`. Both are SECURITY DEFINER ACTION RPCs (the app calls them as `authenticated`), and
-- both already fail closed for anon (each checks `auth.uid()`, which is NULL for anon → membership/owner
-- check finds no row → raises), so this is NOT exploitable. But anon should not hold EXECUTE at all.
--
-- ROOT CAUSE: migrations 0085 (fn_set_active_org) and 0086 (fn_update_org_settings) did
-- `revoke all ... from public` + `grant execute ... to authenticated`. `anon` is a SEPARATE role from
-- `PUBLIC`, so the Supabase platform-default EXECUTE grant to `anon` survived the `revoke from public`.
-- The other ~30 SECURITY DEFINER RPCs revoke from anon explicitly; only these two missed it. (Sibling of
-- the table-grant hygiene in #439, which covers TABLE truncate/delete, not FUNCTION execute.)
--
-- HELPERS LEFT ALONE: public.authorize() and public.user_org_ids() are evaluated INSIDE RLS policies, so
-- they must stay broadly executable — revoking would break anon-reachable policy checks. Only the two
-- action RPCs are tightened here.
--
-- SECURITY: tightens least-privilege; no behaviour change for `authenticated` (the app path).
-- ROLLBACK: grant execute on function public.fn_set_active_org(uuid) to anon;
--           grant execute on function public.fn_update_org_settings(uuid,text,text,text,text,date) to anon;

revoke execute on function public.fn_set_active_org(uuid) from anon;
revoke execute on function public.fn_update_org_settings(uuid, text, text, text, text, date) from anon;
