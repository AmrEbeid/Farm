-- Farm OS — attendance may be assigned only to a currently active worker.
--
-- Problem: the attendance picker hides archived people, but a stale browser or direct client insert can
-- still name one. A blanket RLS active-person check would also reject harmless corrections to an open-period
-- historical row after its worker is archived. Closed-period immutability already belongs to
-- fn_guard_labor_log_payroll_freeze and is deliberately unchanged here.
--
-- Contract: lock and validate the referenced people row only for INSERT or when person/org attribution
-- changes. The FOR SHARE lock serializes this decision with a concurrent people.active update: whichever
-- transaction obtains the worker row first defines the valid ordering. Ordinary edits that retain an
-- archived historical person remain possible until the existing payroll freeze closes that period.
--
-- Security: SECURITY DEFINER is needed to lock the referenced worker without depending on people-read RLS.
-- Unauthorized/cross-active-org callers return before that lookup and are still denied by labor_logs RLS,
-- avoiding a worker-existence oracle. Direct EXECUTE is revoked; the function is trigger-only.
-- Rollback: drop zz_guard_labor_log_active_person and private.fn_guard_labor_log_active_person().

begin;

create or replace function private.fn_guard_labor_log_active_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
  v_person_org uuid;
  v_privileged boolean;
  v_database_role text;
  v_request_role text;
begin
  if new.person_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.person_id is not distinct from old.person_id
     and new.org_id is not distinct from old.org_id then
    return new;
  end if;

  v_request_role := auth.role();
  v_database_role := current_setting('role', true);
  select coalesce(r.rolsuper or r.rolbypassrls, false)
    into v_privileged
    from pg_catalog.pg_roles r
   where r.rolname = session_user;
  v_privileged := coalesce(v_database_role = 'service_role', false)
    or coalesce(v_request_role = 'service_role', false)
    or (
      coalesce(v_database_role, 'none') not in ('authenticated', 'anon')
      and coalesce(v_privileged, false)
    );

  -- Untrusted JWT callers must reach RLS without a worker-status oracle. Privileged service/admin
  -- sessions bypass RLS, so they continue into the integrity check regardless of JWT membership.
  if not v_privileged
     and v_request_role in ('authenticated', 'anon')
     and (
       new.org_id not in (select public.user_org_ids())
       or not public.authorize('labor.write', new.org_id)
     ) then
    return new;
  end if;

  if v_privileged then
    select pe.org_id, pe.active
      into v_person_org, v_active
      from public.people pe
     where pe.id = new.person_id
     for share;
  else
    select pe.org_id, pe.active
      into v_person_org, v_active
      from public.people pe
     where pe.id = new.person_id
       and pe.org_id = new.org_id
     for share;
  end if;

  if not found then
    if v_privileged then
      raise exception 'labor log person is unavailable'
        using errcode = 'P7001';
    end if;
    return new; -- existing RLS policy produces 42501 for an untrusted missing/cross-org reference
  end if;

  if v_person_org is distinct from new.org_id or not v_active then
    raise exception 'labor log person is unavailable'
      using errcode = 'P7001';
  end if;

  return new;
end;
$$;

revoke all on function private.fn_guard_labor_log_active_person() from public;
revoke all on function private.fn_guard_labor_log_active_person() from anon;
revoke all on function private.fn_guard_labor_log_active_person() from authenticated;

drop trigger if exists guard_labor_log_active_person on public.labor_logs;
drop trigger if exists zz_guard_labor_log_active_person on public.labor_logs;
create trigger zz_guard_labor_log_active_person
  before insert or update of person_id, org_id on public.labor_logs
  for each row execute function private.fn_guard_labor_log_active_person();

comment on function private.fn_guard_labor_log_active_person() is
  'Trigger-only guard: serializes attendance assignment with worker archival and rejects an inactive same-org person using non-leaking SQLSTATE P7001; tenancy remains enforced by labor_logs RLS.';

commit;
