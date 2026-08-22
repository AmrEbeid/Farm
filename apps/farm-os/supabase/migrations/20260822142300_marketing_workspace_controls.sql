-- SPEC-0032: database-backed values for the exact owner-supplied source-layout controls.
-- These rows are form drafts only; operational contacts/records remain in their normalized tables.
-- Security: FORCE RLS, role-scoped reads, RPC-only writes, bounded scalar values, audited changes.

create table if not exists public.marketing_workspace_control (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id),
  area_id text not null check (area_id in (
    'dashboard','farm','offshoots','prices','markets','local','shipping','logisticsResearch','quality',
    'kuwait','china','crm','exw','competitors','linkedin','brokers','socialprices','exportletter','gmail',
    'campaign','platforms','materials','dailyreport','reports','contact'
  )),
  control_key text not null check (length(control_key) between 1 and 240),
  value jsonb not null check (
    jsonb_typeof(value) in ('string','number','boolean','null')
    and octet_length(value::text) <= 8192
  ),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, area_id, control_key)
);

alter table public.marketing_workspace_control enable row level security;
alter table public.marketing_workspace_control force row level security;

drop policy if exists tenant_role_read on public.marketing_workspace_control;
create policy tenant_role_read on public.marketing_workspace_control for select to authenticated
using (
  org_id in (select public.user_org_ids())
  and exists (
    select 1 from public.organization_member m
    where m.user_id = (select auth.uid())
      and m.org_id = marketing_workspace_control.org_id
      and m.role in ('owner','accountant','farm_manager')
  )
);

grant select on public.marketing_workspace_control to authenticated;
revoke all on public.marketing_workspace_control from anon;
revoke insert, update, delete on public.marketing_workspace_control from authenticated;

create index if not exists marketing_workspace_control_org_area_idx
  on public.marketing_workspace_control (org_id, area_id);
create index if not exists marketing_workspace_control_updated_by_idx
  on public.marketing_workspace_control (updated_by) where updated_by is not null;

drop trigger if exists audit_marketing_workspace_control on public.marketing_workspace_control;
create trigger audit_marketing_workspace_control
  after insert or update or delete on public.marketing_workspace_control
  for each row execute function public.fn_audit('marketing_workspace_control');

create or replace function public.fn_save_marketing_workspace_control(
  p_org uuid,
  p_area_id text,
  p_control_key text,
  p_value jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.marketing_workspace_control;
begin
  if p_org is null or p_org not in (select public.user_org_ids()) or not exists (
    select 1 from public.organization_member m
    where m.user_id = v_uid and m.org_id = p_org
      and m.role in ('owner','accountant','farm_manager')
  ) then
    raise exception 'not authorized to edit marketing workspace controls' using errcode = '42501';
  end if;
  if p_area_id is null or p_area_id not in (
    'dashboard','farm','offshoots','prices','markets','local','shipping','logisticsResearch','quality',
    'kuwait','china','crm','exw','competitors','linkedin','brokers','socialprices','exportletter','gmail',
    'campaign','platforms','materials','dailyreport','reports','contact'
  ) then
    raise exception 'invalid marketing workspace area' using errcode = '22023';
  end if;
  if p_control_key is null or length(p_control_key) not between 1 and 240 then
    raise exception 'invalid marketing workspace control key' using errcode = '22023';
  end if;
  if p_value is null or jsonb_typeof(p_value) not in ('string','number','boolean','null')
     or octet_length(p_value::text) > 8192 then
    raise exception 'invalid marketing workspace control value' using errcode = '22023';
  end if;

  insert into public.marketing_workspace_control (org_id, area_id, control_key, value, updated_by)
  values (p_org, p_area_id, p_control_key, p_value, v_uid)
  on conflict (org_id, area_id, control_key) do update
    set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.fn_save_marketing_workspace_control(uuid,text,text,jsonb) from public, anon;
grant execute on function public.fn_save_marketing_workspace_control(uuid,text,text,jsonb) to authenticated;
