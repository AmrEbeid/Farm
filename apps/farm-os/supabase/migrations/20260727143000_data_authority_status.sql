-- Data authority status: report surfaces fail closed until an org's source is verified.
begin;

create table public.data_authority_status (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  domain text not null check (domain in (
    'finance_ledger', 'palm_registry', 'offshoots', 'budgets',
    'payroll', 'inventory', 'operations'
  )),
  status text not null check (status in ('verified', 'partial', 'unverified', 'blocked')),
  source_label text,
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  record_count bigint check (record_count is null or record_count >= 0),
  notes text,
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    status <> 'verified'
    or (
      source_label is not null and btrim(source_label) <> ''
      and record_count is not null
      and notes is not null and btrim(notes) <> ''
    )
  ),
  unique (org_id, domain)
);
create index data_authority_status_org_idx on public.data_authority_status(org_id);
create index data_authority_status_verified_by_idx on public.data_authority_status(verified_by)
  where verified_by is not null;

alter table public.data_authority_status enable row level security;
alter table public.data_authority_status force row level security;

create policy data_authority_status_read on public.data_authority_status
  for select to authenticated
  using (org_id in (select public.user_org_ids()));

revoke insert, update, delete, truncate on public.data_authority_status from authenticated, anon;
grant select on public.data_authority_status to authenticated;

create trigger audit_data_authority_status
  after insert or update or delete on public.data_authority_status
  for each row execute function public.fn_audit('data_authority_status');

create or replace function public.fn_set_data_authority_status(
  p_org uuid,
  p_domain text,
  p_status text,
  p_source_label text default null,
  p_source_sha256 text default null,
  p_record_count bigint default null,
  p_notes text default null
)
returns public.data_authority_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.data_authority_status;
begin
  if (select auth.uid()) is null
    or p_org not in (select public.user_org_ids())
    or not exists (
    select 1
    from public.organization_member m
    where m.org_id = p_org
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  ) then
    raise exception 'forbidden: owner membership is required' using errcode = '42501';
  end if;

  if p_status = 'verified' and (
    nullif(btrim(p_source_label), '') is null
    or p_record_count is null
    or nullif(btrim(p_notes), '') is null
  ) then
    raise exception 'verified status requires source label, record count, and evidence notes'
      using errcode = '23514';
  end if;

  insert into public.data_authority_status (
    org_id, domain, status, source_label, source_sha256, record_count, notes,
    verified_at, verified_by, updated_at
  )
  values (
    p_org, p_domain, p_status, nullif(btrim(p_source_label), ''),
    nullif(lower(btrim(p_source_sha256)), ''), p_record_count, nullif(btrim(p_notes), ''),
    case when p_status = 'verified' then now() else null end,
    case when p_status = 'verified' then (select auth.uid()) else null end,
    now()
  )
  on conflict (org_id, domain) do update set
    status = excluded.status,
    source_label = excluded.source_label,
    source_sha256 = excluded.source_sha256,
    record_count = excluded.record_count,
    notes = excluded.notes,
    verified_at = excluded.verified_at,
    verified_by = excluded.verified_by,
    updated_at = now()
  returning * into v_row;

  return v_row;
end
$$;

revoke all on function public.fn_set_data_authority_status(uuid, text, text, text, text, bigint, text)
  from public, anon;
grant execute on function public.fn_set_data_authority_status(uuid, text, text, text, text, bigint, text)
  to authenticated;

-- Extend the existing report contract so actual-only views can distinguish a budget-only
-- zero from a posted-GL category whose debits and credits legitimately net to zero.
create or replace function public.fn_budget_vs_actual(
  p_org uuid,
  p_from date,
  p_to date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_from is null then raise exception 'period start required' using errcode = '23502'; end if;
  if coalesce(p_to, current_date) < p_from then
    raise exception 'period end before start' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org budget-vs-actual' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  with budget as (
    select bl.category, sum(bl.planned) as planned
      from public.budget_lines bl
     where bl.org_id = p_org and bl.category is not null
     group by bl.category
  ),
  actual as (
    select e.category, sum(jl.debit - jl.credit) as actual
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.journal_entry_id
      join public.expenses e on e.id = jl.expense_id
      join public.accounts a on a.id = jl.account_id
     where jl.org_id = p_org and je.org_id = p_org
       and je.status = 'posted'
       and je.entry_date >= p_from
       and je.entry_date <= coalesce(p_to, current_date)
       and a.account_type = 'expense'
       and e.category is not null
     group by e.category
  ),
  merged as (
    select coalesce(b.category, a.category) as category,
           coalesce(b.planned, 0) as planned,
           coalesce(a.actual, 0) as actual,
           (b.category is not null) as in_budget,
           (a.category is not null) as actual_row_present
      from budget b
      full outer join actual a on a.category = b.category
  )
  select jsonb_build_object(
    'period_start', p_from,
    'period_end', coalesce(p_to, current_date),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', category,
        'planned', planned,
        'actual', actual,
        'variance', planned - actual,
        'over_budget', (planned > 0 and actual > planned),
        'unbudgeted', not in_budget,
        'actual_row_present', actual_row_present
      ) order by category)
      from merged), '[]'::jsonb),
    'planned_total', coalesce((select sum(planned) from merged), 0),
    'actual_total', coalesce((select sum(actual) from merged), 0),
    'variance_total', coalesce((select sum(planned) - sum(actual) from merged), 0)
  )
  into v_result;

  return v_result;
end;
$$;
revoke execute on function public.fn_budget_vs_actual(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.fn_budget_vs_actual(uuid, date, date)
  to authenticated;

insert into public.data_authority_status (org_id, domain, status, notes)
select '00000000-0000-0000-0000-000000000001', seed.domain, seed.status, seed.notes
from (values
  ('finance_ledger', 'partial', 'Loaded ledger is balanced; source reconciliation remains unresolved.'),
  ('palm_registry', 'unverified', 'Production registry is synthetic and source counts conflict.'),
  ('offshoots', 'blocked', 'No structured source ledger is available.'),
  ('budgets', 'blocked', 'No authoritative budget workbook is available.'),
  ('payroll', 'blocked', 'Security and wage-model gates remain open.'),
  ('inventory', 'partial', 'Structured movement evidence covers 2021 only.'),
  ('operations', 'partial', 'Structured plans and operations evidence is incomplete.')
) as seed(domain, status, notes)
where exists (
  select 1 from public.organization
  where id = '00000000-0000-0000-0000-000000000001'
)
on conflict (org_id, domain) do nothing;

commit;
