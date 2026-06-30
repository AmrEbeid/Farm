-- Farm OS — claim-first guards on the payment-request lifecycle (#503).
--
-- fn_submit / fn_approve_operational / fn_approve_final did read-status-then-`UPDATE … WHERE id=` — a
-- TOCTOU window: two concurrent valid calls both pass the `if v_status <> '<expected>'` read-check, then
-- both UPDATE (last-writer-wins on the actor/timestamp + a duplicate transition). Benign today (the
-- transition carries no money side effect — the paid/closed disbursement is a later slice), but it
-- deviates from the repo's claim-first standard (fn_execute_operation, fn_post_receipt) and would become a
-- double-disbursement the moment a side effect is attached.
--
-- FIX: make each transition atomic — add the expected status to the UPDATE's WHERE clause and raise if it
-- matched no row (the concurrent loser). The read-check is kept for its clear wrong-status message; the
-- WHERE guard closes the race. Re-emitted VERBATIM from the 0150100 definitions; the ONLY change per
-- function is the `and status='<expected>'` on the UPDATE + the `if not found` raise. SECURITY DEFINER,
-- search_path='', org+role gates, and EXECUTE grants all preserved. Additive-safe (a normal single call is
-- unchanged; only a concurrent double-fire now errors instead of silently double-applying).
-- Validation: pgTAP 103 (full lifecycle still works) + prod re-probe (the WHERE guard is present).

create or replace function public.fn_submit_payment_request(p_request uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_status text;
begin
  select org_id, status into v_org, v_status from public.payment_requests where id = p_request;
  if v_org is null then raise exception 'request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org' using errcode='42501'; end if;
  if not public.authorize('request.prepare', v_org) then raise exception 'forbidden: request.prepare' using errcode='42501'; end if;
  if v_status <> 'draft' then raise exception 'only a draft can be submitted (is %)', v_status using errcode='22023'; end if;
  update public.payment_requests set status='submitted', submitted_at=now() where id=p_request and status='draft';
  if not found then raise exception 'request % is no longer draft (concurrent transition)', p_request using errcode='40001'; end if;
end; $$;
revoke execute on function public.fn_submit_payment_request(uuid) from public, anon, authenticated;
grant execute on function public.fn_submit_payment_request(uuid) to authenticated;

create or replace function public.fn_approve_request_operational(p_request uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_status text;
begin
  select org_id, status into v_org, v_status from public.payment_requests where id = p_request;
  if v_org is null then raise exception 'request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org' using errcode='42501'; end if;
  if not public.authorize('request.approve.op', v_org) then raise exception 'forbidden: request.approve.op' using errcode='42501'; end if;
  if v_status <> 'submitted' then raise exception 'only a submitted request can be operationally approved (is %)', v_status using errcode='22023'; end if;
  update public.payment_requests set status='approved_operational', approved_op_by=(select auth.uid()), approved_op_at=now() where id=p_request and status='submitted';
  if not found then raise exception 'request % is no longer submitted (concurrent transition)', p_request using errcode='40001'; end if;
end; $$;
revoke execute on function public.fn_approve_request_operational(uuid) from public, anon, authenticated;
grant execute on function public.fn_approve_request_operational(uuid) to authenticated;

create or replace function public.fn_approve_request_final(p_request uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_status text;
begin
  select org_id, status into v_org, v_status from public.payment_requests where id = p_request;
  if v_org is null then raise exception 'request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org' using errcode='42501'; end if;
  if not public.authorize('request.approve.final', v_org) then raise exception 'forbidden: request.approve.final (owner only)' using errcode='42501'; end if;
  if v_status <> 'approved_operational' then raise exception 'only an operationally-approved request can be finalized (is %)', v_status using errcode='22023'; end if;
  update public.payment_requests set status='approved_final', approved_final_by=(select auth.uid()), approved_final_at=now() where id=p_request and status='approved_operational';
  if not found then raise exception 'request % is no longer operationally-approved (concurrent transition)', p_request using errcode='40001'; end if;
end; $$;
revoke execute on function public.fn_approve_request_final(uuid) from public, anon, authenticated;
grant execute on function public.fn_approve_request_final(uuid) to authenticated;
