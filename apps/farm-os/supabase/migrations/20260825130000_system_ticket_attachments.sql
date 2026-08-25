-- Private screenshots and documents attached to support/development requests.
-- Metadata follows the parent ticket's submitter-or-owner visibility. Binary objects live in the
-- private `support-attachments` bucket provisioned by support-attachments-storage-policies.sql.
-- ROLLBACK: drop table public.system_ticket_attachments;

create table public.system_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  ticket_id uuid not null references public.system_tickets(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  storage_path text not null unique check (
    char_length(storage_path) between 75 and 500
    and storage_path ~ (
      '^' || org_id::text || '/' || ticket_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' ||
      '\.(jpg|jpeg|png|webp|heic|heif|pdf|doc|docx)$'
    )
    and storage_path not like '%..%'
  ),
  file_name text not null check (
    char_length(btrim(file_name)) between 1 and 255
    and file_name !~ E'[\\\\/]'
  ),
  content_type text not null check (content_type in (
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  constraint system_ticket_attachment_type_extension_match check (
    (content_type = 'image/jpeg' and lower(split_part(storage_path, '.', -1)) in ('jpg', 'jpeg'))
    or (content_type = 'image/png' and lower(split_part(storage_path, '.', -1)) = 'png')
    or (content_type = 'image/webp' and lower(split_part(storage_path, '.', -1)) = 'webp')
    or (content_type = 'image/heic' and lower(split_part(storage_path, '.', -1)) = 'heic')
    or (content_type = 'image/heif' and lower(split_part(storage_path, '.', -1)) = 'heif')
    or (content_type = 'application/pdf' and lower(split_part(storage_path, '.', -1)) = 'pdf')
    or (content_type = 'application/msword' and lower(split_part(storage_path, '.', -1)) = 'doc')
    or (
      content_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      and lower(split_part(storage_path, '.', -1)) = 'docx'
    )
  ),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  created_at timestamptz not null default now()
);

create index system_ticket_attachments_ticket_created_idx
  on public.system_ticket_attachments(ticket_id, created_at desc);
create index system_ticket_attachments_org_created_idx
  on public.system_ticket_attachments(org_id, created_at desc);
create index system_ticket_attachments_creator_created_idx
  on public.system_ticket_attachments(created_by, created_at desc);

alter table public.system_ticket_attachments enable row level security;
alter table public.system_ticket_attachments force row level security;

create policy system_ticket_attachments_read
on public.system_ticket_attachments for select to authenticated
using (
  org_id in (select public.user_org_ids())
  and exists (
    select 1
    from public.system_tickets ticket
    where ticket.id = system_ticket_attachments.ticket_id
      and ticket.org_id = system_ticket_attachments.org_id
      and (ticket.created_by = auth.uid() or public.authorize('site.write', ticket.org_id))
  )
);

create policy system_ticket_attachments_create
on public.system_ticket_attachments for insert to authenticated
with check (
  org_id in (select public.user_org_ids())
  and created_by = auth.uid()
  and exists (
    select 1
    from public.system_tickets ticket
    where ticket.id = system_ticket_attachments.ticket_id
      and ticket.org_id = system_ticket_attachments.org_id
      and (ticket.created_by = auth.uid() or public.authorize('site.write', ticket.org_id))
  )
);

grant select, insert on public.system_ticket_attachments to authenticated;
revoke update, delete, truncate on public.system_ticket_attachments from authenticated, anon;
revoke all on public.system_ticket_attachments from anon;
