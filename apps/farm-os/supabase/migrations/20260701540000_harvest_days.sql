-- SPEC-0027 H-B — يوم قطف: the FIELD half of the harvest ledger. Supervisors count crates as they
-- leave the rows (a phone counter, offline-friendly); the scale (H-A) counts what reaches the truck.
-- The DELTA between the two is shrinkage made visible — the anti-leakage number no notebook ever showed.
-- Quantities only (no money). plan.write gate (owner/farm_manager — the same crew that runs الميدان);
-- NO authorize() change. SECURITY DEFINER + search_path='' + EXECUTE-locked; RLS + FORCE RLS + audit.
begin;

create table if not exists public.harvest_days (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  day date not null default current_date,
  cost_center_id uuid references public.cost_centers(id),
  crop text not null default 'برحي',
  crates_picked numeric not null check (crates_picked > 0),
  crew_count int check (crew_count is null or crew_count > 0),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists harvest_days_org_day_idx on public.harvest_days(org_id, day desc);
create index if not exists harvest_days_cc_idx on public.harvest_days(cost_center_id);
alter table public.harvest_days enable row level security;
alter table public.harvest_days force row level security;
drop policy if exists tenant_read on public.harvest_days;
create policy tenant_read on public.harvest_days for select to authenticated
  using (org_id in (select public.user_org_ids()));
grant select on public.harvest_days to authenticated;
revoke insert, update, delete on public.harvest_days from authenticated, anon;
drop trigger if exists audit_harvest_day on public.harvest_days;
create trigger audit_harvest_day after insert or update or delete on public.harvest_days
  for each row execute function public.fn_audit('harvest_day');

create or replace function public.fn_record_harvest_day(
  p_org uuid, p_crates numeric, p_cost_center_id uuid default null,
  p_crop text default 'برحي', p_day date default current_date,
  p_crew_count int default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_cc_org uuid;
begin
  if p_crates is null or p_crates <= 0 then raise exception 'crates must be positive' using errcode = '22023'; end if;
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org harvest day' using errcode = '42501'; end if;
  if not public.authorize('plan.write', p_org) then raise exception 'forbidden: plan.write is required' using errcode = '42501'; end if;
  if p_cost_center_id is not null then
    select org_id into v_cc_org from public.cost_centers where id = p_cost_center_id;
    if v_cc_org is distinct from p_org then raise exception 'forbidden: cross-org cost center' using errcode = '42501'; end if;
  end if;
  insert into public.harvest_days(org_id, day, cost_center_id, crop, crates_picked, crew_count, note)
  values (p_org, coalesce(p_day, current_date), p_cost_center_id, coalesce(nullif(trim(p_crop),''),'برحي'), p_crates, p_crew_count, p_note)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.fn_record_harvest_day(uuid, numeric, uuid, text, date, int, text) from public, anon, authenticated;
grant  execute on function public.fn_record_harvest_day(uuid, numeric, uuid, text, date, int, text) to authenticated;

commit;
