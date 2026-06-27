-- Farm OS — STRUCT-1: node media storage bucket + RLS. APPLY-LAYER, OWNER-GATED.
--
-- This is NOT a migration. The Docker-free pgTAP harness (test-shims/bootstrap.sql) stubs only the
-- `auth` schema, not `storage`, so a `storage.*` statement in migrations/ would break CI. Apply this
-- ONCE to the real Supabase project (via the SQL editor / MCP) as an Owner-gated apply — same posture
-- as a prod migration push. It provisions the private `farm-media` bucket and the storage.objects RLS
-- that scopes every object to the uploader's org.
--
-- Object path layout (set by the app): {org_id}/{entity_type}/{entity_id}/{uuid}.{ext}
--   → the first path segment is the org_id, which the policies below check against user_org_ids().
--
-- The `attachments` table (migration 0053) holds the metadata + storage_path; this secures the bytes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'farm-media', 'farm-media', false, 26214400,  -- 25 MB, matches fn_add_attachment's ceiling
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: an authenticated member may read objects whose first folder = one of their orgs.
drop policy if exists "farm_media_read_own_org" on storage.objects;
create policy "farm_media_read_own_org" on storage.objects for select to authenticated
  using (
    bucket_id = 'farm-media'
    and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())
  );

-- Insert: same org scoping on upload. (Update/Delete intentionally NOT granted to clients — removal
-- is the soft archive in `attachments`; a privileged purge job reclaims storage later.)
drop policy if exists "farm_media_insert_own_org" on storage.objects;
create policy "farm_media_insert_own_org" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'farm-media'
    and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())
  );
