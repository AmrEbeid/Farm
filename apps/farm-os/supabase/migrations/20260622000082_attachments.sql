-- Farm OS — STRUCT-1: editable farm structure, part 3 — node media (photos & documents).
-- See docs/RESEARCH-farm-structure-crud-2026-06-26.md (D6).
--
-- A polymorphic attachments table so every structure node (farm/sector/hawsha/line/palm) can carry
-- photos + documents — mirrors the existing event_attachments precedent (0004). The binary lives in
-- Supabase Storage (private bucket `farm-media`, provisioned by supabase/storage-policies.sql — an
-- Owner-gated apply, NOT a migration, because the pgTAP harness has no `storage` schema); this table
-- holds the metadata + the storage_path. RLS org-scoped; the bucket's storage.objects RLS is the
-- second gate on the bytes themselves.
--
-- Writes go through the definer RPCs below (op.execute — field staff document trees; this is a field
-- action, not a structural one). DELETE is revoked → removal is soft (archived=true), same posture as
-- 0027. Audited via fn_audit (0008).

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  entity_type text not null check (entity_type in ('farm','sector','hawsha','line','palm')),
  entity_id uuid not null,
  storage_path text not null,
  kind text not null default 'photo' check (kind in ('photo','document')),
  caption text,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  archived boolean not null default false
);
create index attachments_org_idx on public.attachments(org_id);
create index attachments_entity_idx on public.attachments(entity_type, entity_id) where archived = false;

alter table public.attachments enable row level security;
alter table public.attachments force row level security;

-- Reads: any org member. Writes: op.execute (defense-in-depth; the app writes via the definer RPCs).
create policy tenant_all on public.attachments for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('op.execute', org_id)
  );

-- authenticated needs TABLE privileges for PostgREST (RLS only filters rows). A table created after the
-- 0009 blanket `grant ... on all tables` doesn't inherit it, so grant explicitly — the right pattern
-- (mirrors people_compensation 0046) and required for the audit-leak invariant (an audited table must be
-- fully readable by authenticated, else the audit mirror leaks it; attachments carries no PII so this is
-- safe). DELETE intentionally withheld — removal is the soft archive (0027 posture).
grant select, insert, update on public.attachments to authenticated;
revoke delete on public.attachments from authenticated, anon;

create trigger audit_attachment after insert or update or delete on public.attachments
  for each row execute function public.fn_audit('attachment');

-- ── resolve-the-entity helper, inlined per-RPC: a node's org, proving it exists in the caller's org ──

create or replace function public.fn_add_attachment(
  p_entity_type text,
  p_entity_id uuid,
  p_storage_path text,
  p_kind text default 'photo',
  p_caption text default null,
  p_content_type text default null,
  p_size_bytes bigint default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_id uuid;
begin
  if p_entity_type not in ('farm','sector','hawsha','line','palm') then
    raise exception 'invalid entity_type: %', p_entity_type using errcode = '22023'; end if;
  if coalesce(p_kind, '') not in ('photo','document') then
    raise exception 'invalid attachment kind: %', p_kind using errcode = '22023'; end if;
  if p_storage_path is null or btrim(p_storage_path) = '' then
    raise exception 'storage_path required' using errcode = '23502'; end if;
  -- 25 MB ceiling (a field photo/doc; larger is almost certainly a mistake or abuse).
  if p_size_bytes is not null and p_size_bytes > 26214400 then
    raise exception 'attachment too large (% bytes)', p_size_bytes using errcode = '22023'; end if;

  -- the referenced node must exist AND be in one of the caller's orgs (resolved, not trusted).
  if    p_entity_type = 'farm'   then select org_id into v_org from public.farms   where id = p_entity_id;
  elsif p_entity_type = 'sector' then select org_id into v_org from public.sectors where id = p_entity_id;
  elsif p_entity_type = 'hawsha' then select org_id into v_org from public.hawshat where id = p_entity_id;
  elsif p_entity_type = 'line'   then select org_id into v_org from public.lines   where id = p_entity_id;
  else                                select org_id into v_org from public.assets  where id = p_entity_id; end if;
  if v_org is null then raise exception '% % not found', p_entity_type, p_entity_id using errcode = 'P0002'; end if;

  if not public.authorize('op.execute', v_org) then
    raise exception 'forbidden: op.execute is required to attach media' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org attachment' using errcode = '42501'; end if;

  -- the storage_path's first folder must be the entity's OWN org (storage.objects RLS gates READS by
  -- foldername[1], but the metadata row must not be able to CLAIM another org's path).
  if split_part(btrim(p_storage_path), '/', 1) <> v_org::text then
    raise exception 'storage_path must be under the org folder %', v_org using errcode = '42501'; end if;

  insert into public.attachments(org_id, entity_type, entity_id, storage_path, kind, caption,
    content_type, size_bytes, uploaded_by)
  values (v_org, p_entity_type, p_entity_id, btrim(p_storage_path), p_kind,
    nullif(btrim(coalesce(p_caption, '')), ''), p_content_type, p_size_bytes, (select auth.uid()))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'storage_path', btrim(p_storage_path));
end $$;

create or replace function public.fn_archive_attachment(
  p_id uuid,
  p_archived boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.attachments where id = p_id;
  if v_org is null then raise exception 'attachment % not found', p_id using errcode = 'P0002'; end if;

  if not public.authorize('op.execute', v_org) then
    raise exception 'forbidden: op.execute is required' using errcode = '42501'; end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org attachment change' using errcode = '42501'; end if;

  update public.attachments set archived = p_archived where id = p_id;
  return jsonb_build_object('id', p_id, 'archived', p_archived);
end $$;

revoke all     on function public.fn_add_attachment(text, uuid, text, text, text, text, bigint) from public;
revoke execute on function public.fn_add_attachment(text, uuid, text, text, text, text, bigint) from anon;
grant  execute on function public.fn_add_attachment(text, uuid, text, text, text, text, bigint) to authenticated;
revoke all     on function public.fn_archive_attachment(uuid, boolean) from public;
revoke execute on function public.fn_archive_attachment(uuid, boolean) from anon;
grant  execute on function public.fn_archive_attachment(uuid, boolean) to authenticated;
