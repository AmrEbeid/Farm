-- Farm OS MVP-0 — #270 H4: reverting a DECIDED purchase request back to an editable/cancelled state
-- is an approval-authority action — gate it on pr.approve and clear the stale approval provenance.
--
-- THE BUG (live on prod, HIGH — SoD bypass). pr_guard_approval (latest migration 0023) gates the
-- transition INTO 'approved' (requester≠approver, session-stamped) and the born-approved INSERT, but
-- says nothing about leaving 'approved'. So a member with no pr.approve can take an approved PR,
-- `PATCH status='draft'` (the pr_update WITH CHECK's `status <> 'approved'` disjunct passes for any
-- non-approved target), which RELEASES the 0050 line-lock (it fires only while the parent is decided),
-- EDIT the lines, then resubmit/re-approve — laundering edited content past the approval that was
-- granted on the original lines. The reverted row also keeps its stale approved_by/approved_at,
-- misrepresenting provenance. Same hole lets a member revert partially_received/received.
--
-- THE FIX. A revert out of a decided status (approved / partially_received / received) into an
-- editable-or-cancelled status (draft / submitted / rejected) requires pr.approve, and always clears
-- approved_by/approved_at (the prior approval no longer holds). The forward receipt path
-- (approved → partially_received → received, driven by the SECURITY DEFINER fn_post_receipt) is NOT a
-- revert — its targets are not in (draft, submitted, rejected) — so it is untouched. The null-uid
-- service/seed/migration path is exempt (governed by RLS), mirroring the existing INSERT/UPDATE guards.
-- The INSERT guard is also widened to reject a born-partially_received/received row (a receipt status
-- is, like approved, never a birth state).
--
-- Re-emitted from 0023 with ONLY the widened INSERT list (clause at INSERT) and the new revert block
-- (clause c) added; clauses (a) requested_by-immutable and (b) into-approved SoD are byte-identical.

create or replace function public.pr_guard_approval()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
begin
  -- INSERT: a purchase request is born unapproved AND un-received; approval and receipt are UPDATE-only
  -- transitions. Guard only a real authenticated caller (the threat — a member self-issuing a decided
  -- PR). The service_role/admin path (null auth.uid(): seeding, data migration, test setup) may
  -- legitimately create decided records and is governed by RLS, mirroring the UPDATE checks below.
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null
       and (new.status in ('approved', 'partially_received', 'received')
            or new.approved_by is not null
            or new.approved_at is not null) then
      raise exception 'a purchase request cannot be created already approved/received (insert-side SoD)'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE:
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

  -- (c) #270 H4: reverting a DECIDED PR back to an editable/cancelled state releases the line-lock and
  --     the coverage/budget commitment the approval authorized — an approval-authority action. A
  --     non-approver must not do it (else: revert → edit lines → resubmit launders content past
  --     approval). The forward receipt path (→ partially_received/received) is not a revert and is not
  --     caught. The null-uid service path is exempt (RLS-governed), mirroring (b).
  if old.status in ('approved', 'partially_received', 'received')
     and new.status in ('draft', 'submitted', 'rejected') then
    if (select auth.uid()) is not null
       and not public.authorize('pr.approve', new.org_id) then
      raise exception 'separation of duties: only an approver can revert a decided purchase request'
        using errcode = '42501';
    end if;
    -- the prior approval no longer holds — stale provenance must not survive the revert
    new.approved_by := null;
    new.approved_at := null;
  end if;

  return new;
end
$fn$;

-- Trigger already covers BEFORE INSERT OR UPDATE (migration 0023); CREATE OR REPLACE keeps it bound.
