-- Farm OS MVP-0 — AUDIT-1: audit organization_member changes (membership = privilege changes).
--
-- The audit triggers (migration 0008) cover purchase_requests, budgets, budget_lines, farm_event,
-- expenses and inventory_movements — but NOT organization_member, so a join/leave/role-change (which
-- is a privilege change) left no audit trail. That matters even though client writes are revoked
-- (HIGH-1, migration 0010): the server-side invite/relink flow runs as service_role, and those
-- membership grants are exactly what an audit log exists to record.
--
-- The generic fn_audit can't be reused here: it keys the audit row on `new.id`, but
-- organization_member has a COMPOSITE PK (org_id, user_id) and no `id` column. So this adds a
-- dedicated SECURITY DEFINER trigger that records the membership row keyed on the member's user_id.
-- Mirrors fn_audit otherwise (actor = auth.uid(), full before/after JSONB), and writes into the
-- append-only audit_log the same way (the function is the only writer; AP-4 immutability is intact).
create or replace function public.fn_audit_org_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log(org_id, actor_user_id, action, entity_type, entity_id, before, after)
  values (
    coalesce(new.org_id, old.org_id),
    (select auth.uid()),
    tg_op,
    'organization_member',
    coalesce(new.user_id::text, old.user_id::text),   -- the member whose membership changed
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_org_member
  after insert or update or delete on public.organization_member
  for each row execute function public.fn_audit_org_member();
