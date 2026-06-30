-- Farm OS — #314: gate responsibility-assignment writes.
--
-- THE GAP. `responsibility_assignments` drives the RACI / accountability routing model. It is not an
-- authorization source (`authorize()` still comes from `organization_member.role`), so this is not a
-- privilege-escalation bug. But the table's direct-REST policy was org-only: any org member could
-- insert/update accountability labels. Product docs already assign People & Responsibility management to
-- owner/farm_manager.
--
-- THE FIX. Add `responsibility.write` (owner/farm_manager) to the org-scoped authorize overload and
-- re-emit the table policy so reads stay org-wide while writes require the new permission. Preserve the
-- 0063 same-org person guard. This is a direct-REST hardening change; no app writer exists yet.
--
-- MIGRATION-ORDER NOTE. `authorize()` is re-emitted by in-flight draft migrations. Carry the full current
-- in-flight union here so this migration is safe even if it is applied after #366/#400/#438.

create or replace function public.authorize(perm text, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_member m
    where m.user_id = (select auth.uid())
      and m.org_id = p_org
      and ( (perm = 'pr.approve'             and m.role = 'owner')
         or (perm = 'plan.write'             and m.role in ('owner','farm_manager'))
         or (perm = 'op.execute'             and m.role in ('owner','farm_manager','agri_engineer','supervisor'))
         or (perm = 'inventory.write'        and m.role in ('owner','farm_manager','storekeeper'))
         or (perm = 'budget.write'           and m.role in ('owner','accountant'))
         or (perm = 'payroll.read'           and m.role in ('owner','accountant'))
         or (perm = 'structure.write'        and m.role in ('owner','farm_manager'))
         or (perm = 'academy.write'          and m.role in ('owner','agri_engineer'))   -- in-flight #366
         or (perm = 'export.write'           and m.role in ('owner','farm_manager'))     -- in-flight #400
         or (perm = 'responsibility.write'   and m.role in ('owner','farm_manager'))
         or (perm = 'finance.read'           and m.role in ('owner','accountant'))        -- in-flight #438
         or (perm = 'custody.write'          and m.role in ('owner','farm_manager','accountant'))   -- in-flight #438
         or (perm = 'request.prepare'        and m.role in ('owner','farm_manager','accountant'))   -- in-flight #438
         or (perm = 'request.approve.op'     and m.role in ('owner','farm_manager'))     -- in-flight #438
         or (perm = 'request.approve.final'  and m.role = 'owner') )                     -- in-flight #438
  )
$$;

drop policy if exists tenant_all on public.responsibility_assignments;
create policy tenant_all on public.responsibility_assignments for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('responsibility.write', org_id)
    and exists (select 1 from public.people pe
                where pe.id = responsibility_assignments.person_id and pe.org_id = responsibility_assignments.org_id)
  );
