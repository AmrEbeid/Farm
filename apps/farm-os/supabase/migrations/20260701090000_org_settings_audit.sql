-- Farm OS — close the org-settings audit gap (#215 research finding, 2026-06-30 prod probe).
--
-- Problem: org-profile edits (name / locale / currency / area_unit / fiscal_year_start) go through
-- `fn_update_org_settings` (0086) — the ONLY write path, since direct client DML on `organization` is
-- revoked (0010). But that RPC writes no audit row, and there is NO audit trigger on `organization`
-- (the 0008 audit triggers cover PRs/budgets/events/expenses/movements only). Prod probe confirmed:
-- zero non-internal triggers on `public.organization` and zero `audit_log` rows for entity 'organization'.
-- So every owner edit to the tenancy spine's profile is currently UN-audited — a compliance hole.
--
-- Why not a generic fn_audit trigger: `fn_audit()` reads `coalesce(new.org_id, old.org_id)`, but the
-- `organization` table has no `org_id` column (its tenant id IS `id`). A fn_audit trigger on it would
-- raise "record new has no field org_id" and break ALL org-settings updates. So we audit explicitly
-- inside the gated SECURITY DEFINER RPC instead — it already runs as the owner and can INSERT into the
-- append-only `audit_log` (client INSERT is revoked, 0008), and it is the only write path, so every
-- change is captured with before/after.
--
-- Security: the owner-of-this-org check, name validation, whitelisted columns (incl. the #383/0095
-- fiscal_year_start coalesce-on-null preserve fix), search_path='', and EXECUTE grants are re-emitted
-- from the CURRENT definition (migration 0095, the latest re-emit) — this migration ONLY adds the audit
-- write. No access-control logic changes. (Re-emit footgun: base on the latest def, not an older one.)
--
-- Rollback: re-emit 0086's function body (without the before/after capture + audit insert).
-- Validation: pgTAP 86_org_settings_test.sql (asserts an 'organization' audit row is written on a
-- successful owner edit); then prod re-probe after a controlled settings change.

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
declare
  v_before jsonb;
  v_after  jsonb;
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

  select to_jsonb(o) into v_before from public.organization o where o.id = p_org;

  -- whitelisted columns only; coalesce keeps the current value when an optional arg is omitted
  -- (#383, migration 0095: fiscal_year_start coalesces too — omitting it must NOT wipe a set value).
  update public.organization set
    name              = btrim(p_name),
    locale            = coalesce(p_locale, locale),
    currency          = coalesce(p_currency, currency),
    area_unit         = coalesce(p_area_unit, area_unit),
    fiscal_year_start = coalesce(p_fiscal_year_start, fiscal_year_start)
  where id = p_org;

  select to_jsonb(o) into v_after from public.organization o where o.id = p_org;

  -- Audit the change directly (organization has no org_id column → can't use the fn_audit trigger).
  insert into public.audit_log(org_id, actor_user_id, action, entity_type, entity_id, before, after)
  values (p_org, (select auth.uid()), 'UPDATE', 'organization', p_org::text, v_before, v_after);
end;
$$;

revoke all     on function public.fn_update_org_settings(uuid, text, text, text, text, date) from public;
grant  execute on function public.fn_update_org_settings(uuid, text, text, text, text, date) to authenticated;
