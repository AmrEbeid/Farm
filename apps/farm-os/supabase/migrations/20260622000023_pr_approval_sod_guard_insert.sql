-- Farm OS MVP-0 — AP-5 follow-up (issue #76 item 2): close the INSERT-side separation-of-duties gap.
--
-- pr_guard_approval (migration 0017) is a BEFORE UPDATE trigger, so it only governs the approval
-- *transition*. A member could sidestep it entirely by INSERTing a born-approved purchase request —
-- `status='approved'` (optionally with approved_by/approved_at pre-stamped) — which never passes
-- through the gated UPDATE path where requester≠approver is enforced and approved_by/at are
-- session-stamped. The prod-push assurance flagged this as the upstream sidestep of the AP-5 control.
--
-- Fix: extend the guard to also fire BEFORE INSERT. A purchase request is born unapproved; approval
-- is an UPDATE-only transition. Reject an insert that arrives already approved or pre-stamped.
--
-- Safe — the app always creates PRs with status='draft' and no approver fields
-- (app/(app)/inventory/[itemId]/coverage/actions.ts), so no legitimate path is affected. The
-- service_role/admin path (null auth.uid()) is governed by RLS, not this app-role guard.
create or replace function public.pr_guard_approval()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
begin
  -- INSERT: a purchase request is born unapproved; approval happens only via the gated UPDATE path.
  -- Guard only a real authenticated caller (the threat — a member self-issuing an approved PR). The
  -- service_role/admin path (null auth.uid(): seeding, data migration, test setup) may legitimately
  -- create already-approved records and is governed by RLS, mirroring the UPDATE SoD check below.
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null
       and (new.status = 'approved'
            or new.approved_by is not null
            or new.approved_at is not null) then
      raise exception 'a purchase request cannot be created already approved (insert-side SoD)'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE (unchanged from 0017):
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

-- Recreate the trigger to also cover INSERT.
drop trigger if exists pr_guard_approval on public.purchase_requests;
create trigger pr_guard_approval
  before insert or update on public.purchase_requests
  for each row
  execute function public.pr_guard_approval();
