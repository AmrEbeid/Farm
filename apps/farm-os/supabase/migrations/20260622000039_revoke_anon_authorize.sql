-- Farm OS — close the anon-EXECUTE regression on authorize()/user_org_ids() (#229).
--
-- The prod security advisor flags both `public.authorize(text, uuid)` and `public.user_org_ids()`
-- as executable by the `anon` role via /rest/v1/rpc/*. Root cause is the recurring Supabase
-- default-privilege auto-grant: `0035`'s `create or replace function public.authorize(text, uuid)`
-- re-granted EXECUTE to anon (the exact mechanism `0021` closed for the write RPCs), and
-- `user_org_ids()` was never anon-revoked after GRANT-C1/`0010` (which only covered functions that
-- existed at that time).
--
-- Low exploitability today — anon holds no table grants (GRANT-C1), so it never triggers the
-- `TO authenticated` tenant RLS policies that call these helpers, and both return empty/false for a
-- null `auth.uid()`. But it is a standing posture gap the linter keeps surfacing, and a future helper
-- could leak. Revoke anon; `authenticated` KEEPS EXECUTE (RLS policy evaluation and the app require
-- it). Mirrors the `0021` pattern (revoke the explicit anon grant; leave authenticated).
revoke execute on function public.authorize(text, uuid) from anon;
revoke execute on function public.user_org_ids()        from anon;
