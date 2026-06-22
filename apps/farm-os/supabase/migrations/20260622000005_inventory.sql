-- Farm OS MVP-0 — Phase B, migration 5
-- Inventory + supply: suppliers, inventory_items, inventory_bin (materialized snapshot),
-- inventory_movements. Build spec §4 (Inventory). RLS deny-by-default everywhere.

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  name text not null,
  phone text,
  terms text,
  lead_time_days int
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  name text not null,
  category text,
  unit text,
  pack_size numeric,
  min_stock numeric,
  max_stock numeric,
  safety_stock numeric,
  reorder_point numeric,
  reorder_qty numeric,
  lead_time_days int,
  preferred_supplier_id uuid references public.suppliers(id),
  criticality text,
  expiry_tracked boolean not null default false
);

-- ERPNext-style materialized snapshot per item x location, so reads never re-sum the ledger.
-- projected = on_hand - reserved + ordered (forward-looking available balance).
create table public.inventory_bin (
  org_id uuid not null references public.organization(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  location text not null default 'main',
  on_hand numeric not null default 0,
  reserved numeric not null default 0,
  ordered numeric not null default 0,
  projected numeric not null default 0,
  primary key (item_id, location)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  type text not null check (type in
    ('receipt','issue','return','adjustment','transfer','loss','expiry','reserve','release')),
  qty numeric not null,
  unit text,
  unit_cost numeric,
  location text not null default 'main',
  occurred_at timestamptz not null default now(),
  event_id uuid,
  plan_id uuid,
  supplier_id uuid references public.suppliers(id),
  expiry_date date,
  batch_no text
);
create index inventory_movements_item_idx on public.inventory_movements(org_id, item_id, occurred_at);

-- Now that inventory_items exists, wire the deferred FK from quantities.material_id (migration 4).
alter table public.quantities
  add constraint quantities_material_fk
  foreign key (material_id) references public.inventory_items(id);

create index suppliers_org_idx on public.suppliers(org_id);
create index inventory_items_org_idx on public.inventory_items(org_id);
create index inventory_bin_org_idx on public.inventory_bin(org_id);

do $$
declare t text;
begin
  foreach t in array array['suppliers','inventory_items','inventory_bin','inventory_movements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (org_id in (select public.user_org_ids()))$p$, t);
  end loop;
end $$;
