-- SPEC-0032 full-source Marketing workspace.
-- Extends the live compact module without breaking the currently deployed RPC signatures.
-- The supplied HTML is parsed in the application without executing JavaScript; this migration
-- receives only the reviewed, bounded JSON source pack.

begin;

alter table public.marketing_contact
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.marketing_contact
  drop constraint if exists marketing_contact_metadata_object;
alter table public.marketing_contact
  add constraint marketing_contact_metadata_object check (
    jsonb_typeof(metadata) = 'object'
    and octet_length(metadata::text) <= 32768
  );

alter table public.marketing_record
  drop constraint if exists marketing_record_record_type_check;
alter table public.marketing_record
  add constraint marketing_record_record_type_check check (record_type in (
    'price_observation', 'exw_bid', 'quality_batch', 'weekly_availability', 'competitor',
    'lead_local', 'lead_offshoot', 'lead_social', 'lead_linkedin', 'hot_lead',
    'task', 'platform_state', 'broker_state', 'certificate', 'channel_target', 'message_template',
    'freight_reference', 'market_reference', 'daily_sales_report', 'repeat_customer'
  ));

create index if not exists marketing_contact_org_name_page_idx
  on public.marketing_contact (org_id, archived, lower(name), id);
create index if not exists marketing_record_org_status_idx
  on public.marketing_record (org_id, status) where not archived;
create index if not exists marketing_activity_org_recent_idx
  on public.marketing_contact_activity (org_id, occurred_at desc);

create table if not exists public.marketing_import_run (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  source_hash text not null,
  expected_contacts integer not null,
  imported_contacts integer not null,
  existing_contacts integer not null,
  expected_records integer not null,
  imported_records integer not null,
  existing_records integer not null,
  coverage jsonb not null,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketing_import_run_hash check (source_hash ~ '^[0-9a-f]{64}$'),
  constraint marketing_import_run_counts check (
    expected_contacts between 0 and 2000
    and expected_records between 0 and 250
    and imported_contacts >= 0 and existing_contacts >= 0
    and imported_records >= 0 and existing_records >= 0
    and imported_contacts + existing_contacts = expected_contacts
    and imported_records + existing_records = expected_records
  ),
  constraint marketing_import_run_coverage check (
    jsonb_typeof(coverage) = 'object'
    and octet_length(coverage::text) <= 131072
  ),
  unique (org_id, source_hash)
);

create index if not exists marketing_import_run_org_recent_idx
  on public.marketing_import_run (org_id, created_at desc);

alter table public.marketing_import_run enable row level security;
alter table public.marketing_import_run force row level security;

drop policy if exists tenant_role_read on public.marketing_import_run;
create policy tenant_role_read on public.marketing_import_run for select to authenticated
  using (
    org_id in (select public.user_org_ids())
    and exists (
      select 1
      from public.organization_member m
      where m.user_id = (select auth.uid())
        and m.org_id = marketing_import_run.org_id
        and m.role in ('owner', 'accountant', 'farm_manager')
    )
  );

grant select on public.marketing_import_run to authenticated;
revoke all on public.marketing_import_run from anon;
revoke insert, update, delete on public.marketing_import_run from authenticated;

drop trigger if exists audit_marketing_import_run on public.marketing_import_run;
create trigger audit_marketing_import_run
  after insert or update or delete on public.marketing_import_run
  for each row execute function public.fn_audit('marketing_import_run');

create or replace function public.fn_save_marketing_contact_v2(
  p_id uuid,
  p_org uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_org_name text,
  p_category text,
  p_source text,
  p_notes text,
  p_selected boolean default false,
  p_source_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) is distinct from 'object'
     or octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 32768 then
    raise exception 'contact metadata must be a bounded JSON object' using errcode = '22023';
  end if;

  v_row := public.fn_save_marketing_contact(
    p_id, p_org, p_name, p_phone, p_email, p_org_name, p_category,
    p_source, p_notes, p_selected, p_source_key
  );
  v_id := (v_row->>'id')::uuid;

  update public.marketing_contact
  set metadata = coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
  where id = v_id
  returning to_jsonb(marketing_contact.*) into v_row;

  return v_row;
end;
$$;

revoke execute on function public.fn_save_marketing_contact_v2(
  uuid, uuid, text, text, text, text, text, text, text, boolean, text, jsonb
) from public, anon;
grant execute on function public.fn_save_marketing_contact_v2(
  uuid, uuid, text, text, text, text, text, text, text, boolean, text, jsonb
) to authenticated;

-- Keep the live signature and extend only the accepted type allowlist, so old and new app versions
-- can write safely during migrate-first deployment.
create or replace function public.fn_save_marketing_record(
  p_id uuid,
  p_org uuid,
  p_record_type text,
  p_title text,
  p_payload jsonb,
  p_contact_id uuid default null,
  p_amount numeric default null,
  p_status text default null,
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
    select 1
    from public.organization_member m
    where m.user_id = v_uid
      and m.org_id = v_org
      and m.role in ('owner', 'accountant', 'farm_manager')
  ) then
    raise exception 'not authorized to write marketing records' using errcode = '42501';
  end if;
  if p_record_type is null or p_record_type not in (
    'price_observation', 'exw_bid', 'quality_batch', 'weekly_availability', 'competitor',
    'lead_local', 'lead_offshoot', 'lead_social', 'lead_linkedin', 'hot_lead',
    'task', 'platform_state', 'broker_state', 'certificate', 'channel_target', 'message_template',
    'freight_reference', 'market_reference', 'daily_sales_report', 'repeat_customer'
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
  if p_contact_id is not null and not exists (
    select 1
    from public.marketing_contact c
    where c.id = p_contact_id and c.org_id = v_org
  ) then
    raise exception 'linked contact not found in this organization' using errcode = '23503';
  end if;

  if p_id is null and nullif(btrim(coalesce(p_source_key, '')), '') is not null then
    select id into p_id
    from public.marketing_record
    where org_id = v_org and source_key = btrim(p_source_key);
  end if;

  if p_id is null then
    insert into public.marketing_record (
      org_id, record_type, title, payload, contact_id, amount, status, source_key, created_by
    )
    values (
      v_org, p_record_type, btrim(p_title), coalesce(p_payload, '{}'::jsonb), p_contact_id,
      p_amount, nullif(btrim(coalesce(p_status, '')), ''),
      nullif(btrim(coalesce(p_source_key, '')), ''), v_uid
    )
    returning * into v_row;
  else
    update public.marketing_record
    set record_type = p_record_type,
        title = btrim(p_title),
        payload = coalesce(p_payload, '{}'::jsonb),
        contact_id = p_contact_id,
        amount = p_amount,
        status = nullif(btrim(coalesce(p_status, '')), ''),
        source_key = coalesce(nullif(btrim(coalesce(p_source_key, '')), ''), source_key),
        updated_at = now()
    where id = p_id
    returning * into v_row;
  end if;

  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.fn_save_marketing_record(
  uuid, uuid, text, text, jsonb, uuid, numeric, text, text
) from public, anon;
grant execute on function public.fn_save_marketing_record(
  uuid, uuid, text, text, jsonb, uuid, numeric, text, text
) to authenticated;

create or replace function public.fn_import_marketing_source(
  p_org uuid,
  p_source_hash text,
  p_contacts jsonb,
  p_records jsonb,
  p_expected_contacts integer,
  p_expected_records integer,
  p_coverage jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_prior public.marketing_import_run;
  v_run public.marketing_import_run;
  v_imported_contacts integer := 0;
  v_imported_records integer := 0;
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if p_org not in (select public.user_org_ids()) or not exists (
    select 1
    from public.organization_member m
    where m.user_id = v_uid
      and m.org_id = p_org
      and m.role = 'owner'
  ) then
    raise exception 'not authorized to import marketing source' using errcode = '42501';
  end if;

  if p_source_hash is null or p_source_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid source hash' using errcode = '22023';
  end if;
  if jsonb_typeof(p_contacts) is distinct from 'array'
     or jsonb_typeof(p_records) is distinct from 'array'
     or jsonb_typeof(p_coverage) is distinct from 'object' then
    raise exception 'source contacts, records, and coverage have invalid shapes' using errcode = '22023';
  end if;
  if p_expected_contacts is null or p_expected_contacts < 0 or p_expected_contacts > 2000
     or p_expected_records is null or p_expected_records < 0 or p_expected_records > 250
     or jsonb_array_length(p_contacts) <> p_expected_contacts
     or jsonb_array_length(p_records) <> p_expected_records then
    raise exception 'source counts do not match the reviewed payload' using errcode = '22023';
  end if;
  if octet_length(p_coverage::text) > 131072 then
    raise exception 'source coverage is too large' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org::text, 0)
  );
  select *
  into v_prior
  from public.marketing_import_run
  where org_id = p_org and source_hash = p_source_hash;
  if found then
    return jsonb_build_object(
      'idempotent', true,
      'run', to_jsonb(v_prior)
    );
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_contacts) c
    where jsonb_typeof(c) is distinct from 'object'
      or jsonb_typeof(c->'sourceKey') is distinct from 'string'
      or btrim(c->>'sourceKey') = ''
      or length(c->>'sourceKey') > 300
      or jsonb_typeof(c->'name') is distinct from 'string'
      or btrim(c->>'name') = ''
      or length(c->>'name') > 200
      or jsonb_typeof(c->'category') is distinct from 'string'
      or c->>'category' not in ('exporter', 'buyer_lead', 'kuwait_distributor', 'platform', 'freight', 'other')
      or (c ? 'phone' and jsonb_typeof(c->'phone') not in ('string', 'null'))
      or (c ? 'email' and jsonb_typeof(c->'email') not in ('string', 'null'))
      or (c ? 'orgName' and jsonb_typeof(c->'orgName') not in ('string', 'null'))
      or (c ? 'source' and jsonb_typeof(c->'source') not in ('string', 'null'))
      or (c ? 'notes' and jsonb_typeof(c->'notes') not in ('string', 'null'))
      or (c ? 'selected' and jsonb_typeof(c->'selected') <> 'boolean')
      or length(coalesce(c->>'phone', '')) > 120
      or length(coalesce(c->>'email', '')) > 320
      or length(coalesce(c->>'orgName', '')) > 200
      or length(coalesce(c->>'source', '')) > 500
      or length(coalesce(c->>'notes', '')) > 5000
      or (c ? 'metadata' and jsonb_typeof(c->'metadata') <> 'object')
      or octet_length(coalesce(c->'metadata', '{}'::jsonb)::text) > 32768
  ) then
    raise exception 'invalid marketing contact in source payload' using errcode = '22023';
  end if;
  if (
    select count(*) <> count(distinct btrim(c->>'sourceKey'))
    from jsonb_array_elements(p_contacts) c
  ) then
    raise exception 'duplicate contact source key' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) r
    where jsonb_typeof(r) is distinct from 'object'
      or jsonb_typeof(r->'sourceKey') is distinct from 'string'
      or btrim(r->>'sourceKey') = ''
      or length(r->>'sourceKey') > 300
      or jsonb_typeof(r->'recordType') is distinct from 'string'
      or r->>'recordType' not in (
        'price_observation', 'exw_bid', 'quality_batch', 'weekly_availability', 'competitor',
        'lead_local', 'lead_offshoot', 'lead_social', 'lead_linkedin', 'hot_lead',
        'task', 'platform_state', 'broker_state', 'certificate', 'channel_target', 'message_template',
        'freight_reference', 'market_reference', 'daily_sales_report', 'repeat_customer'
      )
      or jsonb_typeof(r->'title') is distinct from 'string'
      or btrim(r->>'title') = ''
      or length(r->>'title') > 200
      or jsonb_typeof(r->'payload') is distinct from 'object'
      or octet_length((r->'payload')::text) > 32768
      or (r ? 'amount' and jsonb_typeof(r->'amount') not in ('number', 'null'))
      or (jsonb_typeof(r->'amount') = 'number' and abs((r->>'amount')::numeric) > 1000000000000000)
      or (r ? 'status' and jsonb_typeof(r->'status') not in ('string', 'null'))
      or length(coalesce(r->>'status', '')) > 80
      or (r ? 'contactSourceKey' and jsonb_typeof(r->'contactSourceKey') not in ('string', 'null'))
      or length(coalesce(r->>'contactSourceKey', '')) > 300
  ) then
    raise exception 'invalid marketing record in source payload' using errcode = '22023';
  end if;
  if (
    select count(*) <> count(distinct btrim(r->>'sourceKey'))
    from jsonb_array_elements(p_records) r
  ) then
    raise exception 'duplicate record source key' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_records) r
    where nullif(btrim(coalesce(r->>'contactSourceKey', '')), '') is not null
      and not exists (
        select 1
        from jsonb_array_elements(p_contacts) c
        where btrim(c->>'sourceKey') = btrim(r->>'contactSourceKey')
      )
      and not exists (
        select 1
        from public.marketing_contact c
        where c.org_id = p_org and c.source_key = btrim(r->>'contactSourceKey')
      )
  ) then
    raise exception 'record references an unknown marketing contact source key' using errcode = '23503';
  end if;

  perform 1
  from public.marketing_contact existing
  join jsonb_array_elements(p_contacts) incoming
    on existing.org_id = p_org
   and existing.source_key = btrim(incoming->>'sourceKey')
  for update of existing;
  if exists (
    select 1
    from public.marketing_contact existing
    join jsonb_array_elements(p_contacts) incoming
      on existing.org_id = p_org
     and existing.source_key = btrim(incoming->>'sourceKey')
    where existing.name is distinct from btrim(incoming->>'name')
       or existing.phone is distinct from nullif(btrim(coalesce(incoming->>'phone', '')), '')
       or existing.email is distinct from nullif(btrim(coalesce(incoming->>'email', '')), '')
       or existing.org_name is distinct from nullif(btrim(coalesce(incoming->>'orgName', '')), '')
       or existing.category is distinct from incoming->>'category'
       or existing.source is distinct from nullif(btrim(coalesce(incoming->>'source', '')), '')
       or existing.notes is distinct from nullif(btrim(coalesce(incoming->>'notes', '')), '')
       or existing.selected is distinct from coalesce((incoming->>'selected')::boolean, false)
       or existing.metadata is distinct from coalesce(incoming->'metadata', '{}'::jsonb)
       or existing.archived
  ) then
    raise exception 'marketing source conflicts with an existing contact' using errcode = '23505';
  end if;

  perform 1
  from public.marketing_record existing
  join jsonb_array_elements(p_records) incoming
    on existing.org_id = p_org
   and existing.source_key = btrim(incoming->>'sourceKey')
  for update of existing;
  if exists (
    select 1
    from public.marketing_record existing
    left join public.marketing_contact linked
      on linked.id = existing.contact_id and linked.org_id = existing.org_id
    join jsonb_array_elements(p_records) incoming
      on existing.org_id = p_org
     and existing.source_key = btrim(incoming->>'sourceKey')
    where existing.record_type is distinct from incoming->>'recordType'
       or existing.title is distinct from btrim(incoming->>'title')
       or existing.payload is distinct from incoming->'payload'
       or existing.amount is distinct from case
            when jsonb_typeof(incoming->'amount') = 'number' then (incoming->>'amount')::numeric
            else null
          end
       or existing.status is distinct from nullif(btrim(coalesce(incoming->>'status', '')), '')
       or linked.source_key is distinct from nullif(btrim(coalesce(incoming->>'contactSourceKey', '')), '')
       or existing.archived
  ) then
    raise exception 'marketing source conflicts with an existing record' using errcode = '23505';
  end if;

  insert into public.marketing_contact (
    org_id, name, phone, email, org_name, category, source, source_key,
    notes, selected, metadata, created_by
  )
  select
    p_org,
    btrim(c->>'name'),
    nullif(btrim(coalesce(c->>'phone', '')), ''),
    nullif(btrim(coalesce(c->>'email', '')), ''),
    nullif(btrim(coalesce(c->>'orgName', '')), ''),
    c->>'category',
    nullif(btrim(coalesce(c->>'source', '')), ''),
    btrim(c->>'sourceKey'),
    nullif(btrim(coalesce(c->>'notes', '')), ''),
    coalesce((c->>'selected')::boolean, false),
    coalesce(c->'metadata', '{}'::jsonb),
    v_uid
  from jsonb_array_elements(p_contacts) c
  on conflict (org_id, source_key) where source_key is not null do nothing;
  get diagnostics v_imported_contacts = row_count;

  insert into public.marketing_record (
    org_id, record_type, title, payload, contact_id, amount, status, source_key, created_by
  )
  select
    p_org,
    r->>'recordType',
    btrim(r->>'title'),
    r->'payload',
    linked.id,
    case when jsonb_typeof(r->'amount') = 'number' then (r->>'amount')::numeric else null end,
    nullif(btrim(coalesce(r->>'status', '')), ''),
    btrim(r->>'sourceKey'),
    v_uid
  from jsonb_array_elements(p_records) r
  left join public.marketing_contact linked
    on linked.org_id = p_org
   and linked.source_key = nullif(btrim(coalesce(r->>'contactSourceKey', '')), '')
  on conflict (org_id, source_key) where source_key is not null do nothing;
  get diagnostics v_imported_records = row_count;

  insert into public.marketing_import_run (
    org_id, source_hash,
    expected_contacts, imported_contacts, existing_contacts,
    expected_records, imported_records, existing_records,
    coverage, created_by
  )
  values (
    p_org, p_source_hash,
    p_expected_contacts, v_imported_contacts, p_expected_contacts - v_imported_contacts,
    p_expected_records, v_imported_records, p_expected_records - v_imported_records,
    p_coverage, v_uid
  )
  returning * into v_run;

  return jsonb_build_object(
    'idempotent', false,
    'run', to_jsonb(v_run)
  );
end;
$$;

revoke execute on function public.fn_import_marketing_source(
  uuid, text, jsonb, jsonb, integer, integer, jsonb
) from public, anon;
grant execute on function public.fn_import_marketing_source(
  uuid, text, jsonb, jsonb, integer, integer, jsonb
) to authenticated;

create or replace function public.fn_marketing_contacts_page(
  p_org uuid,
  p_query text default null,
  p_category text default null,
  p_archived boolean default false,
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_total integer;
  v_rows jsonb;
begin
  if p_org is null or p_org not in (select public.user_org_ids()) or not exists (
    select 1
    from public.organization_member m
    where m.user_id = v_uid
      and m.org_id = p_org
      and m.role in ('owner', 'accountant', 'farm_manager')
  ) then
    raise exception 'not authorized to read marketing contacts' using errcode = '42501';
  end if;
  if p_page is null or p_page < 1 or p_page > 1000000
     or p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception 'invalid marketing contact page' using errcode = '22023';
  end if;
  if p_category is not null and p_category not in (
    'exporter', 'buyer_lead', 'kuwait_distributor', 'platform', 'freight', 'other'
  ) then
    raise exception 'invalid contact category' using errcode = '22023';
  end if;

  select count(*)::integer
  into v_total
  from public.marketing_contact c
  where c.org_id = p_org
    and (p_archived is null or c.archived = p_archived)
    and (p_category is null or c.category = p_category)
    and (
      v_query is null
      or c.name ilike '%' || v_query || '%'
      or coalesce(c.org_name, '') ilike '%' || v_query || '%'
      or coalesce(c.email, '') ilike '%' || v_query || '%'
      or coalesce(c.phone, '') ilike '%' || v_query || '%'
    );

  select coalesce(jsonb_agg(to_jsonb(page_row) order by page_row.selected desc, page_row.name, page_row.id), '[]'::jsonb)
  into v_rows
  from (
    select
      c.id, c.name, c.phone, c.email, c.org_name, c.category, c.source,
      c.notes, c.selected, c.archived, c.metadata
    from public.marketing_contact c
    where c.org_id = p_org
      and (p_archived is null or c.archived = p_archived)
      and (p_category is null or c.category = p_category)
      and (
        v_query is null
        or c.name ilike '%' || v_query || '%'
        or coalesce(c.org_name, '') ilike '%' || v_query || '%'
        or coalesce(c.email, '') ilike '%' || v_query || '%'
        or coalesce(c.phone, '') ilike '%' || v_query || '%'
      )
    order by c.selected desc, c.name, c.id
    limit p_page_size
    offset (p_page - 1) * p_page_size
  ) page_row;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', p_page,
    'pageSize', p_page_size,
    'pages', case when v_total = 0 then 0 else ceil(v_total::numeric / p_page_size)::integer end
  );
end;
$$;

revoke execute on function public.fn_marketing_contacts_page(
  uuid, text, text, boolean, integer, integer
) from public, anon;
grant execute on function public.fn_marketing_contacts_page(
  uuid, text, text, boolean, integer, integer
) to authenticated;

create or replace function public.fn_marketing_dashboard_snapshot(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if p_org is null or p_org not in (select public.user_org_ids()) or not exists (
    select 1
    from public.organization_member m
    where m.user_id = v_uid
      and m.org_id = p_org
      and m.role in ('owner', 'accountant', 'farm_manager')
  ) then
    raise exception 'not authorized to read marketing dashboard' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'activeContacts', (
      select count(*) from public.marketing_contact c where c.org_id = p_org and not c.archived
    ),
    'selectedContacts', (
      select count(*) from public.marketing_contact c where c.org_id = p_org and not c.archived and c.selected
    ),
    'activeRecords', (
      select count(*) from public.marketing_record r where r.org_id = p_org and not r.archived
    ),
    'overdueFollowUps', (
      select count(*) from public.marketing_contact_activity a
      where a.org_id = p_org and a.follow_up_at < now()
    ),
    'dueFollowUps7Days', (
      select count(*) from public.marketing_contact_activity a
      where a.org_id = p_org and a.follow_up_at >= now() and a.follow_up_at < now() + interval '7 days'
    ),
    'recordsByType', coalesce((
      select jsonb_object_agg(s.record_type, s.row_count)
      from (
        select r.record_type, count(*) row_count
        from public.marketing_record r
        where r.org_id = p_org and not r.archived
        group by r.record_type
      ) s
    ), '{}'::jsonb),
    'recordsByStatus', coalesce((
      select jsonb_object_agg(s.record_status, s.row_count)
      from (
        select coalesce(r.status, 'none') record_status, count(*) row_count
        from public.marketing_record r
        where r.org_id = p_org and not r.archived
        group by coalesce(r.status, 'none')
      ) s
    ), '{}'::jsonb),
    'recentActivity', coalesce((
      select jsonb_agg(to_jsonb(recent_row) order by recent_row.occurred_at desc)
      from (
        select a.id, a.contact_id, c.name contact_name, a.kind, a.notes, a.occurred_at, a.follow_up_at
        from public.marketing_contact_activity a
        join public.marketing_contact c on c.id = a.contact_id and c.org_id = a.org_id
        where a.org_id = p_org
        order by a.occurred_at desc
        limit 10
      ) recent_row
    ), '[]'::jsonb),
    'latestImport', (
      select to_jsonb(i)
      from public.marketing_import_run i
      where i.org_id = p_org
      order by i.created_at desc, i.id desc
      limit 1
    )
  );
end;
$$;

revoke execute on function public.fn_marketing_dashboard_snapshot(uuid) from public, anon;
grant execute on function public.fn_marketing_dashboard_snapshot(uuid) to authenticated;

commit;
