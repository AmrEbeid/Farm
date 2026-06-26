-- Farm OS MVP-0 — #280 F2: only fn_post_receipt may move a PR to partially_received/received
-- (close the forged-PR phantom-supply shortage-mask).
--
-- THE BUG (live on prod, CRITICAL shortage-mask). SPEC-0009 added the `partially_received` status AND
-- made fn_stock_coverage project `qty - received_qty` for `('approved','partially_received')`. But the
-- `pr_update` RLS WITH CHECK (latest migration 0035) only role-gates the transition INTO `'approved'`:
-- its `status <> 'approved' OR authorize('pr.approve', …)` clause passes for ANY other target with mere
-- org membership. So a member with no pr.approve can: create a draft PR, add a line `{item, qty:999999}`
-- while it's draft (the 0050 line-lock only fires on a decided parent), then `PATCH /rest/v1/
-- purchase_requests {"status":"partially_received"}`. received_qty defaults 0, so the engine projects
-- 999999 as phantom future supply → `shortage=false` on a genuinely short item. No approval, no receipt,
-- no movement.
--
-- THE FIX. `partially_received`/`received` are RECEIPT states — they may be set ONLY by the SECURITY
-- DEFINER fn_post_receipt, which sets the txn-local marker `app.posting_receipt='1'` (and runs as the
-- table owner; the seed/service path has a null auth.uid()). A PostgREST client cannot set a txn-local
-- GUC in the same statement, so AND-ing this gate into the WITH CHECK blocks the forged transition while
-- leaving fn_post_receipt's legitimate approved→partially_received→received flow untouched. Re-emitted
-- VERBATIM from 0035 with ONLY the receipt-state clause added.

drop policy if exists pr_update on public.purchase_requests;
create policy pr_update on public.purchase_requests
  for update to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and (
      status <> 'approved'
      or ( public.authorize('pr.approve', org_id)
           and requested_by is distinct from (select auth.uid()) )
    )
    -- #280 F2: only the trusted receipt path (fn_post_receipt: GUC marker, or the null-uid
    -- service/seed path) may set a receipt status. A REST client cannot set the txn-local GUC.
    and (
      status not in ('partially_received', 'received')
      or (select auth.uid()) is null
      or coalesce(current_setting('app.posting_receipt', true), '') = '1'
    )
  );
