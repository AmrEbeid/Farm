-- Farm OS — SPEC-0018 «العهدة وطلبات الصرف» slice 2: payment requests + approval lifecycle.
-- Builds on the custody/payment-status migration (custody + the request.* permissions). A payment request groups
-- a period's expenses into the monthly «إذن صرف»; its totals are DERIVED (never stored) so it is always live.
-- Lifecycle:
--   implemented in this slice: draft → submitted → approved_operational → approved_final
--   paid/closed are reserved for the later disbursement/month-close slice and intentionally have no RPC here.
-- gated: prepare/submit = request.prepare (owner/accountant); operational approval = request.approve.op
-- (owner/accountant); FINAL approval = request.approve.final (owner only). Lines are RPC-only (cross-org FK safety).
-- Money (#6): net request = Σ(post_paid_unpaid expenses in the request) + MAX(0, target_float − current custody);
-- paid-from-custody and non-operating expenses are NOT in the request math. Owner-gated draft.
begin;

-- ── 1) payment_requests ─────────────────────────────────────────────────────────────────────────────────
create table public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  request_no int not null,
  period_start date,
  period_end date,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved_operational','approved_final','paid','closed')),
  custody_account_id uuid references public.custody_accounts(id),  -- which float this request tops up
  note text,
  prepared_by uuid default auth.uid(),
  approved_op_by uuid,
  approved_final_by uuid,
  submitted_at timestamptz,
  approved_op_at timestamptz,
  approved_final_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists payment_requests_org_idx on public.payment_requests(org_id, created_at);
create index if not exists payment_requests_acct_idx on public.payment_requests(custody_account_id);
create unique index if not exists payment_requests_org_no_uniq on public.payment_requests(org_id, request_no);
alter table public.payment_requests enable row level security;
alter table public.payment_requests force row level security;
drop policy if exists tenant_read on public.payment_requests;
create policy tenant_read on public.payment_requests for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('finance.read', org_id));
grant  select on public.payment_requests to authenticated;  -- RPC-only writes (create/submit/approve…); reads finance-gated. (custody_account_id FK not member-writable → cross-org-FK invariant 74 satisfied)
revoke insert, update, delete on public.payment_requests from authenticated, anon;
drop trigger if exists audit_payment_request on public.payment_requests;
create trigger audit_payment_request after insert or update or delete on public.payment_requests
  for each row execute function public.fn_audit('payment_request');

-- ── 2) payment_request_lines (RPC-only → cross-org FKs not member-writable) ─────────────────────────────
create table public.payment_request_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  payment_request_id uuid not null references public.payment_requests(id) on delete cascade,
  expense_id uuid not null references public.expenses(id),
  created_at timestamptz not null default now(),
  unique (payment_request_id, expense_id)
);
create index if not exists prl_org_idx on public.payment_request_lines(org_id);
create index if not exists prl_request_idx on public.payment_request_lines(payment_request_id);
create index if not exists prl_expense_idx on public.payment_request_lines(expense_id);
create unique index if not exists prl_expense_once_uniq on public.payment_request_lines(expense_id);
alter table public.payment_request_lines enable row level security;
alter table public.payment_request_lines force row level security;
drop policy if exists tenant_read on public.payment_request_lines;
create policy tenant_read on public.payment_request_lines for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('finance.read', org_id));
grant  select on public.payment_request_lines to authenticated;
revoke insert, update, delete on public.payment_request_lines from authenticated, anon;  -- RPC-only
drop trigger if exists audit_prl on public.payment_request_lines;
create trigger audit_prl after insert or update or delete on public.payment_request_lines
  for each row execute function public.fn_audit('payment_request_line');

-- Mirror finance-confidential base-table reads onto audit_log. The generic audit trigger stores full rows, so
-- audit rows for custody/payment entities must be at least as restricted as the source tables. Preserve the
-- existing people_compensation payroll gate from 0053.
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated
  using (
    org_id in (select public.user_org_ids())
    and (
      (
        entity_type is distinct from 'people_compensation'
        and entity_type not in ('custody_account','custody_movement','payment_request','payment_request_line')
      )
      or (entity_type = 'people_compensation' and public.authorize('payroll.read', org_id))
      or (
        entity_type in ('custody_account','custody_movement','payment_request','payment_request_line')
        and public.authorize('finance.read', org_id)
      )
    )
  );

-- ── 3) derived totals — always live, never stored ───────────────────────────────────────────────────────
create or replace function public.fn_payment_request_totals(p_request uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_org uuid; v_acct uuid; v_unpaid numeric; v_target numeric; v_current numeric; v_topup numeric;
begin
  select org_id, custody_account_id into v_org, v_acct from public.payment_requests where id = p_request;
  if v_org is null then raise exception 'payment request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org request' using errcode='42501'; end if;
  if not public.authorize('finance.read', v_org) then
    raise exception 'forbidden: finance.read is required' using errcode='42501'; end if;
  -- Σ of operating post_paid_unpaid expenses linked to this request
  -- (paid-from-custody and drawings/capex are excluded → no double-count and #6).
  select coalesce(sum(e.total),0) into v_unpaid
    from public.payment_request_lines l join public.expenses e on e.id = l.expense_id
    where l.payment_request_id = p_request
      and e.payment_status = 'post_paid_unpaid'
      and e.kind = 'operating';
  if v_acct is null then
    v_target := 0;
    v_current := 0;
  else
    select coalesce(target_float,0) into v_target from public.custody_accounts where id = v_acct;
    v_current := coalesce(public.fn_custody_balance(v_acct), 0);
  end if;
  v_topup := greatest(0, coalesce(v_target,0) - v_current);
  return jsonb_build_object(
    'post_paid_unpaid', v_unpaid,
    'target_float', coalesce(v_target,0),
    'current_custody', v_current,
    'custody_top_up', v_topup,
    'net_request', v_unpaid + v_topup);
end;
$$;
revoke execute on function public.fn_payment_request_totals(uuid) from public, anon, authenticated;
grant  execute on function public.fn_payment_request_totals(uuid) to authenticated;

-- ── 4) lifecycle RPCs ───────────────────────────────────────────────────────────────────────────────────
-- create: next request_no per org; gated request.prepare.
create or replace function public.fn_create_payment_request(
  p_org uuid, p_period_start date default null, p_period_end date default null,
  p_custody_account uuid default null, p_note text default null)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id uuid; v_no int; v_acct_org uuid; v_acct_active boolean;
begin
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org' using errcode='42501'; end if;
  if not public.authorize('request.prepare', p_org) then
    raise exception 'forbidden: request.prepare is required' using errcode='42501'; end if;
  if p_custody_account is not null then
    select org_id, active into v_acct_org, v_acct_active from public.custody_accounts where id = p_custody_account;
    if v_acct_org is distinct from p_org then
      raise exception 'forbidden: cross-org custody account' using errcode='42501'; end if;
    if not coalesce(v_acct_active, false) then
      raise exception 'custody account is inactive' using errcode='22023'; end if;
  end if;
  select coalesce(max(request_no),0)+1 into v_no from public.payment_requests where org_id = p_org;
  insert into public.payment_requests(org_id, request_no, period_start, period_end, custody_account_id, note)
    values (p_org, v_no, p_period_start, p_period_end, p_custody_account, p_note)
    returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.fn_create_payment_request(uuid, date, date, uuid, text) from public, anon, authenticated;
grant  execute on function public.fn_create_payment_request(uuid, date, date, uuid, text) to authenticated;

-- add an expense line (RPC-only path; validates same-org for both FKs); request must be draft.
create or replace function public.fn_add_expense_to_request(p_request uuid, p_expense uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare v_org uuid; v_status text; v_exp_org uuid; v_exp_kind text; v_exp_payment_status text; v_id uuid;
begin
  select org_id, status into v_org, v_status from public.payment_requests where id = p_request;
  if v_org is null then raise exception 'request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org' using errcode='42501'; end if;
  if not public.authorize('request.prepare', v_org) then
    raise exception 'forbidden: request.prepare is required' using errcode='42501'; end if;
  if v_status <> 'draft' then raise exception 'request is not draft (%)', v_status using errcode='22023'; end if;
  select org_id, kind, payment_status
    into v_exp_org, v_exp_kind, v_exp_payment_status
    from public.expenses
   where id = p_expense
   for update;
  if v_exp_org is distinct from v_org then raise exception 'forbidden: cross-org expense' using errcode='42501'; end if;
  if coalesce(v_exp_kind, 'operating') <> 'operating' then
    raise exception 'only operating expenses can be added to a payment request (kind=%)', v_exp_kind using errcode='22023'; end if;
  if coalesce(v_exp_payment_status, '') <> 'post_paid_unpaid' then
    raise exception 'only post_paid_unpaid expenses can be added to a payment request (payment_status=%)', v_exp_payment_status using errcode='22023'; end if;
  if exists (
       select 1 from public.payment_request_lines l
        where l.expense_id = p_expense
          and l.payment_request_id <> p_request) then
    raise exception 'expense is already included in another payment request' using errcode='22023';
  end if;
  insert into public.payment_request_lines(org_id, payment_request_id, expense_id)
    values (v_org, p_request, p_expense)
    on conflict (payment_request_id, expense_id) do nothing
    returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.fn_add_expense_to_request(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.fn_add_expense_to_request(uuid, uuid) to authenticated;

-- shared transition helper (one function per gated transition keeps the EXECUTE surface explicit).
create or replace function public.fn_submit_payment_request(p_request uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_status text;
begin
  select org_id, status into v_org, v_status from public.payment_requests where id = p_request;
  if v_org is null then raise exception 'request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org' using errcode='42501'; end if;
  if not public.authorize('request.prepare', v_org) then raise exception 'forbidden: request.prepare' using errcode='42501'; end if;
  if v_status <> 'draft' then raise exception 'only a draft can be submitted (is %)', v_status using errcode='22023'; end if;
  update public.payment_requests set status='submitted', submitted_at=now() where id=p_request;
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
  update public.payment_requests set status='approved_operational', approved_op_by=(select auth.uid()), approved_op_at=now() where id=p_request;
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
  update public.payment_requests set status='approved_final', approved_final_by=(select auth.uid()), approved_final_at=now() where id=p_request;
end; $$;
revoke execute on function public.fn_approve_request_final(uuid) from public, anon, authenticated;
grant execute on function public.fn_approve_request_final(uuid) to authenticated;

commit;
