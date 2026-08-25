-- Farm OS support-request attachment bucket + ticket-scoped storage RLS. OWNER-GATED APPLY LAYER.
-- This is separate from farm-media because support screenshots can contain sensitive operational
-- detail. Only the ticket submitter and an organization owner may read or add these objects.
-- Object path: {org_id}/{ticket_id}/{uuid}.{ext}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-attachments',
  'support-attachments',
  false,
  26214400,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "support_attachments_read_ticket" on storage.objects;
create policy "support_attachments_read_ticket"
on storage.objects for select to authenticated
using (
  bucket_id = 'support-attachments'
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif|pdf|doc|docx)$'
  and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())
  and exists (
    select 1
    from public.system_tickets ticket
    where ticket.org_id = (storage.foldername(name))[1]::uuid
      and ticket.id = (storage.foldername(name))[2]::uuid
      and (ticket.created_by = auth.uid() or public.authorize('site.write', ticket.org_id))
  )
  and exists (
    select 1
    from public.system_ticket_attachments attachment
    where attachment.org_id = (storage.foldername(name))[1]::uuid
      and attachment.ticket_id = (storage.foldername(name))[2]::uuid
      and attachment.storage_path = storage.objects.name
  )
);

drop policy if exists "support_attachments_insert_ticket" on storage.objects;
create policy "support_attachments_insert_ticket"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'support-attachments'
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif|pdf|doc|docx)$'
  and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())
  and exists (
    select 1
    from public.system_tickets ticket
    where ticket.org_id = (storage.foldername(name))[1]::uuid
      and ticket.id = (storage.foldername(name))[2]::uuid
      and (ticket.created_by = auth.uid() or public.authorize('site.write', ticket.org_id))
  )
);

-- Cleanup is limited to an uploaded object that has no registered metadata row. Registered
-- attachments remain immutable, while a failed metadata registration can remove its orphan.
drop policy if exists "support_attachments_delete_unregistered" on storage.objects;
create policy "support_attachments_delete_unregistered"
on storage.objects for delete to authenticated
using (
  bucket_id = 'support-attachments'
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif|pdf|doc|docx)$'
  and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())
  and exists (
    select 1
    from public.system_tickets ticket
    where ticket.org_id = (storage.foldername(name))[1]::uuid
      and ticket.id = (storage.foldername(name))[2]::uuid
      and (ticket.created_by = auth.uid() or public.authorize('site.write', ticket.org_id))
  )
  and not exists (
    select 1
    from public.system_ticket_attachments attachment
    where attachment.org_id = (storage.foldername(name))[1]::uuid
      and attachment.ticket_id = (storage.foldername(name))[2]::uuid
      and attachment.storage_path = storage.objects.name
  )
);
