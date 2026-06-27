-- Farm OS — Stage 1: org settings (the "settings" scope item).
--
-- organization INSERT/UPDATE/DELETE is revoked from authenticated (migration 0010, HIGH-1) so the
-- tenancy spine can't be tampered with from the client. To let an OWNER edit their own org's
-- profile (name / locale / currency / area unit / fiscal year) we expose a single SECURITY DEFINER
-- setter, gated to the owner role of that exact org, that updates only the whitelisted columns.

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

  -- whitelisted columns only; coalesce keeps the current value when an optional arg is omitted.
  update public.organization set
    name              = btrim(p_name),
    locale            = coalesce(p_locale, locale),
    currency          = coalesce(p_currency, currency),
    area_unit         = coalesce(p_area_unit, area_unit),
    fiscal_year_start = p_fiscal_year_start
  where id = p_org;
end;
$$;

revoke all     on function public.fn_update_org_settings(uuid, text, text, text, text, date) from public;
grant  execute on function public.fn_update_org_settings(uuid, text, text, text, text, date) to authenticated;
