-- Farm OS — #383: pre-apply hardening of the org-switcher migrations (0085/0086), both on main.
--
-- 1) HIGH — user_member_org_ids() (0085) shipped WITHOUT the least-privilege revoke/grant stanza every
--    adjacent function has (fn_set_active_org, custom_access_token_hook, fn_update_org_settings). Supabase
--    auto-grants anon/authenticated EXECUTE on new public functions, so it is currently anon-executable —
--    the exact anon-exec SECURITY DEFINER pattern hardened across 21 prior migrations (#229). Lock it down.
-- 2) HIGH — fn_update_org_settings (0086) set `fiscal_year_start = p_fiscal_year_start` with NO coalesce,
--    while the other four optional fields use coalesce(p_x, x). Since p_fiscal_year_start defaults null,
--    a settings update that omits the fiscal-year arg WIPED a previously-set value (production data loss).
--    Re-emit VERBATIM from 0086 with the one-line fix: coalesce(p_fiscal_year_start, fiscal_year_start).

-- ── 1) least-privilege lockdown of the full-membership helper ────────────────────────────────────────
revoke all     on function public.user_member_org_ids() from public;
revoke execute on function public.user_member_org_ids() from anon;
grant  execute on function public.user_member_org_ids() to authenticated;

-- ── 2) preserve-on-null fiscal_year_start (re-emit; create-or-replace preserves the existing ACL) ──────
create or replace function public.fn_update_org_settings(
  p_org               uuid,
  p_name              text,
  p_locale            text default null,
  p_currency          text default null,
  p_area_unit         text default null,
  p_fiscal_year_start date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- owner of THIS org only (definer bypasses RLS, so the org scope must be checked explicitly)
  if not exists (
    select 1 from public.organization_member
    where user_id = (select auth.uid()) and org_id = p_org and role = 'owner'
  ) then
    raise exception 'only the owner may edit organization settings' using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'organization name is required' using errcode = '23514';
  end if;

  -- whitelisted columns only; coalesce keeps the current value when an optional arg is omitted
  -- (#383: fiscal_year_start now coalesces too — omitting it must NOT wipe a previously-set value).
  update public.organization set
    name              = btrim(p_name),
    locale            = coalesce(p_locale, locale),
    currency          = coalesce(p_currency, currency),
    area_unit         = coalesce(p_area_unit, area_unit),
    fiscal_year_start = coalesce(p_fiscal_year_start, fiscal_year_start)
  where id = p_org;
end;
$$;
