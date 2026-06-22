-- Farm OS MVP-0 — Phase B, migration 4
-- The event spine: farm_event PARTITIONED BY RANGE (occurred_at), monthly partitions
-- for the seed window, BRIN on occurred_at + composite (org_id, occurred_at) per PF-3.
-- Plus event children: event_assets, event_locations, quantities, event_status_history,
-- event_followups, event_attachments. Build spec §4 (Events).
--
-- Deviation note: architecture 03 lists `geom geometry` on farm_event/assets (PostGIS).
-- PostGIS is not required for MVP-0 (build spec §4/§11) and is not enabled locally, so
-- the geometry columns are omitted here. Spatial columns can be added later under PostGIS.

create table public.farm_event (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  type text not null,        -- operation|issue|inspection|note|material_movement|...
  subtype text,              -- irrigation|fertilization|spraying|pollination|...
  status text not null default 'planned'
    check (status in ('planned','reserved','ready','blocked','in_progress','done','abandoned','skipped')),
  occurred_at timestamptz not null,
  planned_at timestamptz,
  season_id uuid,
  enterprise_id uuid,
  performed_by_person_id uuid references public.people(id),
  assigned_to_person_id uuid references public.people(id),
  created_by uuid,
  plan_id uuid,
  notes text,
  data jsonb not null default '{}'::jsonb,
  primary key (id, occurred_at)
) partition by range (occurred_at);

-- Monthly partitions for the pilot window (seed plan is period 2025-07).
create table public.farm_event_2025_07 partition of public.farm_event
  for values from ('2025-07-01') to ('2025-08-01');
create table public.farm_event_2025_08 partition of public.farm_event
  for values from ('2025-08-01') to ('2025-09-01');
-- Catch-all default so inserts outside the seed window never error.
create table public.farm_event_default partition of public.farm_event default;

-- PF-3 indexes: BRIN on the partition key (tiny, append-only time-correlated) +
-- composite btree for tenant-scoped time-range queries.
create index farm_event_brin on public.farm_event using brin (occurred_at) with (pages_per_range = 32);
create index farm_event_org_time on public.farm_event (org_id, occurred_at);

create table public.event_assets (
  event_id uuid not null,
  asset_id uuid not null references public.assets(id) on delete cascade,
  org_id uuid not null references public.organization(id) on delete cascade,
  primary key (event_id, asset_id)
);

create table public.event_locations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  org_id uuid not null references public.organization(id) on delete cascade,
  farm_id uuid references public.farms(id),
  sector_id uuid references public.sectors(id),
  hawsha_id uuid references public.hawshat(id),
  line_id uuid references public.lines(id)
);

create table public.quantities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  event_id uuid not null,
  measure text,                       -- count|weight|volume|area|currency|...
  value_num numeric,
  value_den numeric default 1,
  unit_term_id uuid,
  label text,
  material_id uuid,                   -- FK to inventory_items added in migration 5 (table created there)
  inventory_adjustment numeric default 0    -- negative = consumption
);

create table public.event_status_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  event_id uuid not null,
  status text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create table public.event_followups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  event_id uuid not null,
  due_at timestamptz,
  assigned_to_person_id uuid references public.people(id),
  status text,
  note text
);

create table public.event_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  event_id uuid not null,
  storage_path text,
  kind text,
  checksum text
);

create index event_assets_org_idx on public.event_assets(org_id);
create index event_locations_org_idx on public.event_locations(org_id);
create index quantities_org_idx on public.quantities(org_id);
create index quantities_event_idx on public.quantities(event_id);
create index event_status_history_org_idx on public.event_status_history(org_id);
create index event_followups_org_idx on public.event_followups(org_id);
create index event_attachments_org_idx on public.event_attachments(org_id);

-- Defense-in-depth: a partition child queried DIRECTLY does not inherit the parent's
-- RLS policy, and its own relrowsecurity is off by default -> a tenant could read other
-- orgs' rows by selecting from farm_event_2025_07 directly. So enable RLS + the tenant
-- policy on every partition child as well as the parent.
do $$
declare t text;
begin
  foreach t in array array['farm_event','farm_event_2025_07','farm_event_2025_08','farm_event_default',
                           'event_assets','event_locations','quantities',
                           'event_status_history','event_followups','event_attachments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (org_id in (select public.user_org_ids()))$p$, t);
  end loop;
end $$;
