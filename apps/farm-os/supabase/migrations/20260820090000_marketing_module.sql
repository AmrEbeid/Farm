-- Farm OS — Marketing module (SPEC-0032): a compact export-marketing workspace consolidating the
-- 25 legacy tracking areas (dashboard/prices/markets/CRM/campaigns/…) into one nav module with typed
-- editable records + a separate contact master, for owner/accountant/farm_manager only.
--
-- SECURITY MODEL (deliberate, reviewed; mirrors 20260701420000_site_content.sql's posture).
--  * NO authorize() re-emit. Per-task instruction: the module's three writer roles
--    (owner/accountant/farm_manager) are gated with an EXPLICIT inline role check against
--    organization_member (the fn_update_org_settings pattern, 20260622000086) — this sidesteps the
--    authorize()-re-emit footgun entirely (no risk of silently dropping an existing permission).
--  * READS are also role-scoped (not "any org member"): only the three module roles may SELECT, so a
--    supervisor/storekeeper/agri_engineer session gets zero rows here, not just a hidden write button.
--  * WRITES are RPC-ONLY. Direct client INSERT/UPDATE/DELETE is REVOKED on all three tables; a stray
--    PostgREST call cannot bypass the role gate. Hard DELETE stays revoked forever — archive is the
--    only removal path (soft delete, reversible, auditable).
--  * NO duplication of authoritative money. `marketing_record.amount` holds market intelligence only
--    (an observed price, a bid, a per-platform revenue target) — never a mirror of
--    sales/collections/harvest/scale/offshoot/accounting figures, which remain sourced from their own
--    authoritative tables. This module does not read or expose those tables' amounts.
--  * `marketing_contact` is a NEW master, deliberately separate from `buyers` (the accounting-linked
--    buyer/customer master) — no FK between them, so marketing prospecting can never taint accounting.
--  * REPLAY SAFE. Farm's hosted apply records an apply-time migration version, so a later canonical
--    repository replay can encounter these objects already present. Tables/indexes use IF NOT EXISTS;
--    policies/triggers are replaced deterministically; functions are CREATE OR REPLACE.
--
-- SCOPE. Two tables cover the 16 editable record types the task lists (price_observation, exw_bid,
-- quality_batch, weekly_availability, competitor, lead_local, lead_offshoot, lead_social,
-- lead_linkedin, hot_lead, task, platform_state, broker_state, certificate, channel_target,
-- message_template) via one polymorphic `marketing_record` (record_type + a validated-object jsonb
-- payload for type-specific fields) instead of 16 near-identical tables — the "compact" instruction
-- and the existing site_content precedent both favor this over per-type tables for a first release.
-- `marketing_contact_activity` is a third, APPEND-ONLY table for the call/follow-up history a contact
-- accumulates (no update/delete RPC at all — insert only, mirrors audit_log's immutability-by-omission,
-- AP-4).
--
-- ROLLBACK. drop trigger audit_marketing_record on marketing_record; drop trigger
-- audit_marketing_contact_activity on marketing_contact_activity; drop trigger audit_marketing_contact
-- on marketing_contact; drop function fn_archive_marketing_record, fn_save_marketing_record,
-- fn_log_marketing_contact_activity, fn_archive_marketing_contact, fn_save_marketing_contact;
-- drop table marketing_record, marketing_contact_activity, marketing_contact.

begin;

-- ── 1) marketing_contact — the marketing-only contact master (separate from accounting `buyers`) ──
create table if not exists public.marketing_contact (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  org_name text,
  category text not null check (category in ('exporter', 'buyer_lead', 'kuwait_distributor', 'platform', 'freight', 'other')),
  source text,
  source_key text,
  notes text,
  -- curated shortlist flag ("selected contacts" in the source-staging manifest), distinct from archived.
  selected boolean not null default false,
  archived boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_contact_name_not_blank check (btrim(name) <> ''),
  constraint marketing_contact_text_bounds check (
    length(name) <= 200
    and length(coalesce(phone, '')) <= 120
    and length(coalesce(email, '')) <= 320
    and length(coalesce(org_name, '')) <= 200
    and length(coalesce(source, '')) <= 500
    and length(coalesce(source_key, '')) <= 300
    and length(coalesce(notes, '')) <= 5000
  )
);

create index if not exists marketing_contact_org_idx on public.marketing_contact (org_id) where not archived;
create index if not exists marketing_contact_category_idx on public.marketing_contact (org_id, category);
create unique index if not exists marketing_contact_source_key_uidx
  on public.marketing_contact (org_id, source_key) where source_key is not null;

alter table public.marketing_contact enable row level security;
alter table public.marketing_contact force row level security;

-- reads: only the three module roles, ACTIVE org only (explicit role check, no authorize()
-- dependency, but still narrowed through user_org_ids() like every other tenant policy — a
-- consultant who is a member of two orgs must not see both orgs' marketing data at once just
-- because their role qualifies in each; the active_org_id JWT claim narrows this exactly as it
-- narrows every other tenant table, 20260622000085).
drop policy if exists tenant_role_read on public.marketing_contact;
create policy tenant_role_read on public.marketing_contact for select to authenticated
  using (
    org_id in (select public.user_org_ids())
    and exists (
      select 1 from public.organization_member m
      where m.user_id = (select auth.uid())
        and m.org_id = marketing_contact.org_id
        and m.role in ('owner', 'accountant', 'farm_manager')
    )
  );

grant select on public.marketing_contact to authenticated;
revoke insert, update, delete on public.marketing_contact from authenticated, anon;

drop trigger if exists audit_marketing_contact on public.marketing_contact;
create trigger audit_marketing_contact
  after insert or update or delete on public.marketing_contact
  for each row execute function public.fn_audit('marketing_contact');

-- ── 2) marketing_contact_activity — append-only call/follow-up history per contact ──
create table if not exists public.marketing_contact_activity (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  contact_id uuid not null references public.marketing_contact(id) on delete cascade,
  kind text not null check (kind in ('call', 'email', 'meeting', 'note', 'followup')),
  notes text,
  occurred_at timestamptz not null default now(),
  follow_up_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint marketing_contact_activity_notes_bound check (length(coalesce(notes, '')) <= 5000)
);

create index if not exists marketing_contact_activity_contact_idx on public.marketing_contact_activity (contact_id, occurred_at desc);
create index if not exists marketing_contact_activity_followup_idx on public.marketing_contact_activity (org_id, follow_up_at) where follow_up_at is not null;

alter table public.marketing_contact_activity enable row level security;
alter table public.marketing_contact_activity force row level security;

drop policy if exists tenant_role_read on public.marketing_contact_activity;
create policy tenant_role_read on public.marketing_contact_activity for select to authenticated
  using (
    org_id in (select public.user_org_ids())
    and exists (
      select 1 from public.organization_member m
      where m.user_id = (select auth.uid())
        and m.org_id = marketing_contact_activity.org_id
        and m.role in ('owner', 'accountant', 'farm_manager')
    )
  );

grant select on public.marketing_contact_activity to authenticated;
-- append-only by design: no update/delete RPC exists, and direct client writes are revoked too —
-- the ONLY writer is fn_log_marketing_contact_activity (SECURITY DEFINER, below).
revoke insert, update, delete on public.marketing_contact_activity from authenticated, anon;

drop trigger if exists audit_marketing_contact_activity on public.marketing_contact_activity;
create trigger audit_marketing_contact_activity
  after insert or update or delete on public.marketing_contact_activity
  for each row execute function public.fn_audit('marketing_contact_activity');

-- ── 3) marketing_record — polymorphic typed record covering the 16 editable record types ──
create table if not exists public.marketing_record (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  record_type text not null check (record_type in (
    'price_observation', 'exw_bid', 'quality_batch', 'weekly_availability', 'competitor',
    'lead_local', 'lead_offshoot', 'lead_social', 'lead_linkedin', 'hot_lead',
    'task', 'platform_state', 'broker_state', 'certificate', 'channel_target', 'message_template'
  )),
  title text not null,
  -- type-specific fields live here; validated as a JSON object only (schema-per-type is app-layer,
  -- same posture as site_content.content and academy_content's advisory fields).
  payload jsonb not null default '{}'::jsonb,
  contact_id uuid references public.marketing_contact(id) on delete set null,
  -- market intelligence only (observed price / bid / target) — never authoritative accounting money.
  amount numeric,
  status text,
  source_key text,
  archived boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_record_title_not_blank check (btrim(title) <> ''),
  constraint marketing_record_payload_is_object check (jsonb_typeof(payload) = 'object'),
  constraint marketing_record_bounds check (
    length(title) <= 200
    and length(coalesce(status, '')) <= 80
    and length(coalesce(source_key, '')) <= 300
    and octet_length(payload::text) <= 32768
    and (amount is null or abs(amount) <= 1000000000000000)
  )
);

create index if not exists marketing_record_org_type_idx on public.marketing_record (org_id, record_type) where not archived;
create index if not exists marketing_record_contact_idx on public.marketing_record (contact_id);
create unique index if not exists marketing_record_source_key_uidx
  on public.marketing_record (org_id, source_key) where source_key is not null;

alter table public.marketing_record enable row level security;
alter table public.marketing_record force row level security;

drop policy if exists tenant_role_read on public.marketing_record;
create policy tenant_role_read on public.marketing_record for select to authenticated
  using (
    org_id in (select public.user_org_ids())
    and exists (
      select 1 from public.organization_member m
      where m.user_id = (select auth.uid())
        and m.org_id = marketing_record.org_id
        and m.role in ('owner', 'accountant', 'farm_manager')
    )
  );

grant select on public.marketing_record to authenticated;
revoke insert, update, delete on public.marketing_record from authenticated, anon;

drop trigger if exists audit_marketing_record on public.marketing_record;
create trigger audit_marketing_record
  after insert or update or delete on public.marketing_record
  for each row execute function public.fn_audit('marketing_record');

-- ── 4) fn_save_marketing_contact — create/update (owner/accountant/farm_manager only) ──
create or replace function public.fn_save_marketing_contact(
  p_id       uuid,
  p_org      uuid,
  p_name     text,
  p_phone    text,
  p_email    text,
  p_org_name text,
  p_category text,
  p_source   text,
  p_notes    text,
  p_selected boolean default false,
  p_source_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_row public.marketing_contact;
begin
  -- edit-in-place authorizes against the ROW'S OWN org, not the caller-supplied p_org (mirrors
  -- fn_save_academy_content's "authz-by-row-org" invariant, 20260701400000).
  if p_id is not null then
    select org_id into v_org from public.marketing_contact where id = p_id;
    if v_org is null then
      raise exception 'contact not found' using errcode = 'P0002';
    end if;
  else
    v_org := p_org;
  end if;

  if v_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if v_org not in (select public.user_org_ids()) or not exists (
    select 1 from public.organization_member m
    where m.user_id = v_uid and m.org_id = v_org and m.role in ('owner', 'accountant', 'farm_manager')
  ) then
    raise exception 'not authorized to write marketing contacts' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'contact name is required' using errcode = '23502';
  end if;
  if p_category is null or p_category not in ('exporter', 'buyer_lead', 'kuwait_distributor', 'platform', 'freight', 'other') then
    raise exception 'invalid contact category' using errcode = '22023';
  end if;
  if length(coalesce(p_source_key, '')) > 300 then
    raise exception 'source key is too long' using errcode = '22023';
  end if;

  if p_id is null and nullif(btrim(coalesce(p_source_key, '')), '') is not null then
    select id into p_id
    from public.marketing_contact
    where org_id = v_org and source_key = btrim(p_source_key);
  end if;

  if p_id is null then
    insert into public.marketing_contact (org_id, name, phone, email, org_name, category, source, source_key, notes, selected, created_by)
    values (v_org, btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_email, '')), ''),
            nullif(btrim(coalesce(p_org_name, '')), ''), p_category, nullif(btrim(coalesce(p_source, '')), ''),
            nullif(btrim(coalesce(p_source_key, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
            coalesce(p_selected, false), v_uid)
    returning * into v_row;
  else
    update public.marketing_contact set
      name       = btrim(p_name),
      phone      = nullif(btrim(coalesce(p_phone, '')), ''),
      email      = nullif(btrim(coalesce(p_email, '')), ''),
      org_name   = nullif(btrim(coalesce(p_org_name, '')), ''),
      category   = p_category,
      source     = nullif(btrim(coalesce(p_source, '')), ''),
      source_key = coalesce(nullif(btrim(coalesce(p_source_key, '')), ''), source_key),
      notes      = nullif(btrim(coalesce(p_notes, '')), ''),
      selected   = coalesce(p_selected, selected),
      updated_at = now()
    where id = p_id
    returning * into v_row;
  end if;

  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.fn_save_marketing_contact(uuid, uuid, text, text, text, text, text, text, text, boolean, text) from public, anon;
grant  execute on function public.fn_save_marketing_contact(uuid, uuid, text, text, text, text, text, text, text, boolean, text) to authenticated;

-- ── 5) fn_archive_marketing_contact — soft-delete / restore ──
create or replace function public.fn_archive_marketing_contact(p_id uuid, p_archived boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  select org_id into v_org from public.marketing_contact where id = p_id;
  if v_org is null then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;
  if v_org not in (select public.user_org_ids()) or not exists (
    select 1 from public.organization_member m
    where m.user_id = v_uid and m.org_id = v_org and m.role in ('owner', 'accountant', 'farm_manager')
  ) then
    raise exception 'not authorized to archive marketing contacts' using errcode = '42501';
  end if;

  update public.marketing_contact set archived = coalesce(p_archived, true), updated_at = now() where id = p_id;
end;
$$;

revoke execute on function public.fn_archive_marketing_contact(uuid, boolean) from public, anon;
grant  execute on function public.fn_archive_marketing_contact(uuid, boolean) to authenticated;

-- ── 6) fn_log_marketing_contact_activity — append-only insert (the only writer of that table) ──
create or replace function public.fn_log_marketing_contact_activity(
  p_contact_id  uuid,
  p_kind        text,
  p_notes       text,
  p_occurred_at timestamptz default now(),
  p_follow_up_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_row public.marketing_contact_activity;
begin
  select org_id into v_org from public.marketing_contact where id = p_contact_id;
  if v_org is null then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;
  if v_org not in (select public.user_org_ids()) or not exists (
    select 1 from public.organization_member m
    where m.user_id = v_uid and m.org_id = v_org and m.role in ('owner', 'accountant', 'farm_manager')
  ) then
    raise exception 'not authorized to log marketing contact activity' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('call', 'email', 'meeting', 'note', 'followup') then
    raise exception 'invalid activity kind' using errcode = '22023';
  end if;

  insert into public.marketing_contact_activity (org_id, contact_id, kind, notes, occurred_at, follow_up_at, created_by)
  values (v_org, p_contact_id, p_kind, nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_occurred_at, now()), p_follow_up_at, v_uid)
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.fn_log_marketing_contact_activity(uuid, text, text, timestamptz, timestamptz) from public, anon;
grant  execute on function public.fn_log_marketing_contact_activity(uuid, text, text, timestamptz, timestamptz) to authenticated;

-- ── 7) fn_save_marketing_record — create/update a typed record (owner/accountant/farm_manager only) ──
create or replace function public.fn_save_marketing_record(
  p_id          uuid,
  p_org         uuid,
  p_record_type text,
  p_title       text,
  p_payload     jsonb,
  p_contact_id  uuid default null,
  p_amount      numeric default null,
  p_status      text default null,
  p_source_key  text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_row public.marketing_record;
begin
  if p_id is not null then
    select org_id into v_org from public.marketing_record where id = p_id;
    if v_org is null then
      raise exception 'record not found' using errcode = 'P0002';
    end if;
  else
    v_org := p_org;
  end if;

  if v_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if v_org not in (select public.user_org_ids()) or not exists (
    select 1 from public.organization_member m
    where m.user_id = v_uid and m.org_id = v_org and m.role in ('owner', 'accountant', 'farm_manager')
  ) then
    raise exception 'not authorized to write marketing records' using errcode = '42501';
  end if;
  if p_record_type is null or p_record_type not in (
    'price_observation', 'exw_bid', 'quality_batch', 'weekly_availability', 'competitor',
    'lead_local', 'lead_offshoot', 'lead_social', 'lead_linkedin', 'hot_lead',
    'task', 'platform_state', 'broker_state', 'certificate', 'channel_target', 'message_template'
  ) then
    raise exception 'invalid marketing record type' using errcode = '22023';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'record title is required' using errcode = '23502';
  end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'record payload must be a JSON object' using errcode = '22023';
  end if;
  if octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 32768 then
    raise exception 'record payload is too large' using errcode = '22023';
  end if;
  if length(coalesce(p_source_key, '')) > 300 then
    raise exception 'source key is too long' using errcode = '22023';
  end if;
  -- a linked contact must belong to the SAME org (no cross-org contact linkage).
  if p_contact_id is not null and not exists (
    select 1 from public.marketing_contact c where c.id = p_contact_id and c.org_id = v_org
  ) then
    raise exception 'linked contact not found in this organization' using errcode = '23503';
  end if;

  if p_id is null and nullif(btrim(coalesce(p_source_key, '')), '') is not null then
    select id into p_id
    from public.marketing_record
    where org_id = v_org and source_key = btrim(p_source_key);
  end if;

  if p_id is null then
    insert into public.marketing_record (org_id, record_type, title, payload, contact_id, amount, status, source_key, created_by)
    values (v_org, p_record_type, btrim(p_title), coalesce(p_payload, '{}'::jsonb), p_contact_id, p_amount,
            nullif(btrim(coalesce(p_status, '')), ''), nullif(btrim(coalesce(p_source_key, '')), ''), v_uid)
    returning * into v_row;
  else
    update public.marketing_record set
      record_type = p_record_type,
      title       = btrim(p_title),
      payload     = coalesce(p_payload, '{}'::jsonb),
      contact_id  = p_contact_id,
      amount      = p_amount,
      status      = nullif(btrim(coalesce(p_status, '')), ''),
      source_key  = coalesce(nullif(btrim(coalesce(p_source_key, '')), ''), source_key),
      updated_at  = now()
    where id = p_id
    returning * into v_row;
  end if;

  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.fn_save_marketing_record(uuid, uuid, text, text, jsonb, uuid, numeric, text, text) from public, anon;
grant  execute on function public.fn_save_marketing_record(uuid, uuid, text, text, jsonb, uuid, numeric, text, text) to authenticated;

-- ── 8) fn_archive_marketing_record — soft-delete / restore ──
create or replace function public.fn_archive_marketing_record(p_id uuid, p_archived boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  select org_id into v_org from public.marketing_record where id = p_id;
  if v_org is null then
    raise exception 'record not found' using errcode = 'P0002';
  end if;
  if v_org not in (select public.user_org_ids()) or not exists (
    select 1 from public.organization_member m
    where m.user_id = v_uid and m.org_id = v_org and m.role in ('owner', 'accountant', 'farm_manager')
  ) then
    raise exception 'not authorized to archive marketing records' using errcode = '42501';
  end if;

  update public.marketing_record set archived = coalesce(p_archived, true), updated_at = now() where id = p_id;
end;
$$;

revoke execute on function public.fn_archive_marketing_record(uuid, boolean) from public, anon;
grant  execute on function public.fn_archive_marketing_record(uuid, boolean) to authenticated;

commit;
