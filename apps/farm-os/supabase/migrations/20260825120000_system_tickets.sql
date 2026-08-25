-- Farm OS support and development request queue.
-- Every authenticated organization member can create and read their own tickets. The owner can
-- read and triage the whole organization queue. Ticket descriptions may contain operational or
-- personal detail, so this table is intentionally not copied into the org-wide audit_log.
-- ROLLBACK: drop table public.system_tickets;

create table public.system_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  category text not null check (category in ('bug', 'edit', 'development', 'idea')),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  description text not null check (char_length(btrim(description)) between 10 and 5000),
  page_path text check (page_path is null or char_length(page_path) <= 500),
  expected_result text check (expected_result is null or char_length(expected_result) <= 2000),
  evidence text check (evidence is null or char_length(evidence) <= 2000),
  urgency text not null default 'normal' check (urgency in ('low', 'normal', 'high', 'critical')),
  status text not null default 'new' check (status in ('new', 'triaged', 'in_progress', 'done', 'blocked', 'rejected')),
  resolution text check (resolution is null or char_length(resolution) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index system_tickets_org_status_created_idx
  on public.system_tickets(org_id, status, created_at desc);
create index system_tickets_creator_created_idx
  on public.system_tickets(created_by, created_at desc);

alter table public.system_tickets enable row level security;
alter table public.system_tickets force row level security;

create policy system_tickets_read on public.system_tickets for select to authenticated
  using (
    org_id in (select public.user_org_ids())
    and (created_by = auth.uid() or public.authorize('site.write', org_id))
  );

create policy system_tickets_create on public.system_tickets for insert to authenticated
  with check (
    org_id in (select public.user_org_ids())
    and created_by = auth.uid()
    and status = 'new'
    and resolution is null
  );

create policy system_tickets_owner_update on public.system_tickets for update to authenticated
  using (public.authorize('site.write', org_id))
  with check (public.authorize('site.write', org_id));

grant select, insert, update on public.system_tickets to authenticated;
revoke delete, truncate on public.system_tickets from authenticated, anon;
revoke all on public.system_tickets from anon;

create function public.fn_system_ticket_protect_submission()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.org_id is distinct from old.org_id
     or new.created_by is distinct from old.created_by
     or new.category is distinct from old.category
     or new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.page_path is distinct from old.page_path
     or new.expected_result is distinct from old.expected_result
     or new.evidence is distinct from old.evidence
     or new.urgency is distinct from old.urgency
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'ticket submission fields are immutable';
  end if;
  return new;
end;
$$;

create trigger system_ticket_protect_submission
before update on public.system_tickets
for each row execute function public.fn_system_ticket_protect_submission();
