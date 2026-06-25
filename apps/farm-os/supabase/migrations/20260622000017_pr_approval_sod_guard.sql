-- Farm OS MVP-0 — AP-5: close the purchase-request self-approval (separation-of-duties) bypass.
--
-- The `pr_update` policy (migration 0007) enforces AP-2 — "the approver is not the requester" — in
-- its WITH CHECK as `requested_by is distinct from auth.uid()`. But WITH CHECK can only see the NEW
-- row, and the *same* UPDATE can mutate `requested_by`. So an owner (the only role with pr.approve)
-- who authored a PR could self-approve it by rewriting `requested_by` to another member in one
-- statement:
--     update purchase_requests set status='approved', requested_by=<someone-else> where id=…;
-- The WITH CHECK then sees the NEW requested_by (≠ self) and passes. This defeats the financial
-- control AND falsifies the provenance/audit trail (requested_by now points at an innocent member).
-- (Confirmed on the live local stack: the owner-author self-approved this way.)
--
-- Fix: a BEFORE UPDATE trigger that (a) makes `requested_by` immutable — so the policy's AP-2 check
-- is always evaluated against the ORIGINAL author — and (b) on the transition into 'approved',
-- re-asserts the requester≠approver rule against the OLD row and stamps `approved_by`/`approved_at`
-- from `auth.uid()` (so the approver cannot be spoofed either). RLS expresses the org/role gate;
-- the trigger expresses the OLD-row invariants RLS structurally cannot. SECURITY DEFINER + pinned
-- search_path, matching the other helper functions.
--
-- Safe — the legitimate flow is unchanged: a non-author owner approving a submitted PR still
-- succeeds (and now reliably records who approved it), and non-approval edits by any org member are
-- untouched. The service_role admin path (null auth.uid()) is unaffected. Verified by test 12 and
-- the existing SoD tests (01, 02).
create or replace function public.pr_guard_approval()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
begin
  -- (a) requested_by is set at creation and never changes — provenance + the anchor for AP-2.
  if new.requested_by is distinct from old.requested_by then
    raise exception 'purchase_requests.requested_by is immutable'
      using errcode = '42501';
  end if;

  -- (b) on the transition into 'approved': the approver must not be the original requester, and the
  --     approver identity is taken from the session, not from client-supplied columns.
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if (select auth.uid()) is not distinct from old.requested_by then
      raise exception 'separation of duties: the requester cannot approve their own purchase request'
        using errcode = '42501';
    end if;
    new.approved_by := (select auth.uid());
    new.approved_at := now();
  end if;

  return new;
end
$fn$;

create trigger pr_guard_approval
  before update on public.purchase_requests
  for each row
  execute function public.pr_guard_approval();
