-- Farm OS MVP-0 — #306: people.reports_to_person_id must be a SAME-ORG person (the self-referential FK
-- that 0070 deferred). An RLS WITH CHECK can't express this — it has no NEW alias, so a subquery
-- `from public.people pe` referencing the new row's org_id is ambiguous and resolves vacuously. A
-- BEFORE-INSERT/UPDATE trigger HAS new, so it can compare unambiguously. LOW severity (a cross-org
-- reporting line is an org-chart dangling reference to an RLS-invisible person), but this closes the last
-- direct-REST member-writable cross-org FK.
--
-- SECURITY DEFINER so the org check sees the manager regardless of the writer's RLS visibility (it
-- validates the manager's ACTUAL org, not just what the caller can see). EXECUTE revoked — the trigger
-- fires in the owner context regardless; a direct call is the only thing this prevents.

create or replace function public.people_reports_to_same_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.reports_to_person_id is not null
     and not exists (select 1 from public.people mgr
                     where mgr.id = new.reports_to_person_id and mgr.org_id = new.org_id) then
    raise exception 'reports_to_person_id % is not in the same org as the person', new.reports_to_person_id
      using errcode = '42501';
  end if;
  return new;
end
$fn$;

revoke execute on function public.people_reports_to_same_org() from public, anon, authenticated;

create trigger people_reports_to_same_org
  before insert or update on public.people
  for each row execute function public.people_reports_to_same_org();
