-- Supabase shims for running the Farm OS migrations / seed / pgTAP tests against a
-- PLAIN local PostgreSQL — no Docker, no Supabase CLI. Reproduces ONLY what the schema
-- uses: the anon/authenticated/service_role roles, the auth schema + auth.users, and
-- auth.uid()/auth.role() reading request.jwt.claims (matching Supabase's definitions).
--
-- This harness is the authoritative AUTOMATED DB gate (CI runs it). With the local Docker
-- stack removed, full-stack checks (`supabase test db` exercising FORCE RLS / PostgREST /
-- GoTrue) run against the remote (or a Supabase branch) project via the Supabase MCP.
-- See README.md in this directory.

-- Supabase client roles. service_role bypasses RLS (matches Supabase). Idempotent:
-- roles are cluster-level and survive dropdb, so guard creation.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Minimal GoTrue-compatible auth.users (superset of the columns the seed/tests touch).
create table if not exists auth.users (
  id                          uuid primary key,
  instance_id                 uuid,
  aud                         varchar(255),
  role                        varchar(255),
  email                       varchar(255),
  phone                       text,
  encrypted_password          text,
  email_confirmed_at          timestamptz,
  phone_confirmed_at          timestamptz,
  created_at                  timestamptz,
  updated_at                  timestamptz,
  raw_app_meta_data           jsonb,
  raw_user_meta_data          jsonb,
  confirmation_token          text,
  recovery_token              text,
  email_change_token_new      text,
  email_change                text,
  email_change_token_current  text,
  phone_change                text,
  phone_change_token          text,
  reauthentication_token      text
);

-- Supabase's auth.uid()/auth.role(): read the request.jwt.claims GUC.
create or replace function auth.uid() returns uuid
  language sql stable
as $$ select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid $$;

create or replace function auth.role() returns text
  language sql stable
as $$ select current_setting('request.jwt.claims', true)::json ->> 'role' $$;

-- Minimal Supabase Storage surface for executable storage.objects policy tests. This intentionally
-- models only the bucket/object columns and foldername() helper used by Farm OS policies.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null unique
);

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

create or replace function storage.foldername(name text) returns text[]
  language sql immutable
as $$ select string_to_array(name, '/') $$;
