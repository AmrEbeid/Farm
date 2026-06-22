-- Farm OS MVP-0 — Phase B, migration 8
-- Audit-on-write: AFTER INSERT/UPDATE/DELETE triggers write an immutable audit_log row.
-- fn_audit is SECURITY DEFINER so it can INSERT into audit_log even though audit_log has
-- no INSERT policy for end users; combined with the missing UPDATE/DELETE policy this makes
-- audit_log append-only / immutable by omission (AP-4).

create or replace function public.fn_audit()
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
    tg_argv[0],
    coalesce(new.id::text, old.id::text),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_pr
  after insert or update or delete on public.purchase_requests
  for each row execute function public.fn_audit('purchase_request');

create trigger audit_budget
  after insert or update or delete on public.budgets
  for each row execute function public.fn_audit('budget');

create trigger audit_budget_line
  after insert or update or delete on public.budget_lines
  for each row execute function public.fn_audit('budget_line');

create trigger audit_event
  after insert or update or delete on public.farm_event
  for each row execute function public.fn_audit('farm_event');

create trigger audit_expense
  after insert or update or delete on public.expenses
  for each row execute function public.fn_audit('expense');

create trigger audit_movement
  after insert or update or delete on public.inventory_movements
  for each row execute function public.fn_audit('inventory_movement');

-- ---------------------------------------------------------------------------
-- Harden audit_log immutability (AP-4). RLS with no UPDATE/DELETE policy only
-- *filters* those statements to zero rows silently; it does not raise. To make
-- tampering a hard error (and immutable in the literal sense), REVOKE the
-- UPDATE/DELETE/TRUNCATE grants from the client roles. The fn_audit trigger is
-- SECURITY DEFINER (runs as the owner) so it can still INSERT. INSERT is also
-- revoked from clients so the ONLY writer is the trigger — clients can only SELECT.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.audit_log from authenticated, anon;
