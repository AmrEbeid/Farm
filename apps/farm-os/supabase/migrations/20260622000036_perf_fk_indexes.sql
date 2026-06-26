-- Farm OS — perf: covering indexes for unindexed foreign keys (#229).
--
-- The prod Supabase performance advisor flagged 47 FK constraints with no covering
-- index (unindexed_foreign_keys lint 0001) — these slow joins/filters and make
-- ON DELETE cascades scan. This migration adds a btree index on every FK column.
-- Purely additive (CREATE INDEX IF NOT EXISTS) — no behavior change, idempotent,
-- safe to re-run. For the RANGE-partitioned `farm_event`, the index is created on
-- the PARENT (Postgres propagates it to every partition), so the per-partition
-- duplicates the linter listed are covered without separate statements.
--
-- (The advisor also lists 32 unused_index entries — intentionally NOT touched here:
-- on synthetic single-tenant seed data "unused" is expected, and several back
-- constraints / not-yet-live query paths. Dropping is a separate, reviewed decision.)

-- structure spine
create index if not exists assets_sector_id_idx        on public.assets(sector_id);
create index if not exists assets_hawsha_id_idx        on public.assets(hawsha_id);
create index if not exists assets_line_id_idx          on public.assets(line_id);
create index if not exists assets_parent_id_idx        on public.assets(parent_id);
create index if not exists hawshat_sector_id_idx       on public.hawshat(sector_id);
create index if not exists lines_hawsha_id_idx         on public.lines(hawsha_id);
create index if not exists sectors_farm_id_idx         on public.sectors(farm_id);
create index if not exists palm_status_history_asset_id_idx on public.palm_status_history(asset_id);

-- event spine (farm_event is partitioned → index the parent; propagates to partitions)
create index if not exists farm_event_performed_by_person_id_idx on public.farm_event(performed_by_person_id);
create index if not exists farm_event_assigned_to_person_id_idx  on public.farm_event(assigned_to_person_id);
create index if not exists event_locations_farm_id_idx   on public.event_locations(farm_id);
create index if not exists event_locations_sector_id_idx on public.event_locations(sector_id);
create index if not exists event_locations_hawsha_id_idx on public.event_locations(hawsha_id);
create index if not exists event_locations_line_id_idx   on public.event_locations(line_id);
create index if not exists event_assets_asset_id_idx     on public.event_assets(asset_id);
create index if not exists event_followups_assigned_to_person_id_idx on public.event_followups(assigned_to_person_id);
create index if not exists quantities_material_id_idx    on public.quantities(material_id);

-- people / responsibility
create index if not exists people_user_id_idx            on public.people(user_id);
create index if not exists people_reports_to_person_id_idx on public.people(reports_to_person_id);
create index if not exists farms_owner_person_id_idx     on public.farms(owner_person_id);
create index if not exists farms_manager_person_id_idx   on public.farms(manager_person_id);
create index if not exists responsibility_assignments_person_id_idx on public.responsibility_assignments(person_id);

-- inventory
create index if not exists inventory_items_preferred_supplier_id_idx on public.inventory_items(preferred_supplier_id);
create index if not exists inventory_movements_item_id_idx     on public.inventory_movements(item_id);
create index if not exists inventory_movements_supplier_id_idx on public.inventory_movements(supplier_id);

-- plans
create index if not exists plan_operations_plan_id_idx              on public.plan_operations(plan_id);
create index if not exists plan_operations_responsible_person_id_idx on public.plan_operations(responsible_person_id);
create index if not exists plan_material_requirements_plan_op_id_idx on public.plan_material_requirements(plan_op_id);
create index if not exists plan_material_requirements_item_id_idx    on public.plan_material_requirements(item_id);
create index if not exists plan_labor_requirements_plan_op_id_idx    on public.plan_labor_requirements(plan_op_id);
create index if not exists plan_checks_plan_id_idx                   on public.plan_checks(plan_id);

-- budget / purchase / expenses
create index if not exists budget_lines_budget_id_idx              on public.budget_lines(budget_id);
create index if not exists purchase_requests_plan_id_idx           on public.purchase_requests(plan_id);
create index if not exists purchase_request_items_pr_id_idx        on public.purchase_request_items(pr_id);
create index if not exists purchase_request_items_item_id_idx      on public.purchase_request_items(item_id);
create index if not exists purchase_request_items_supplier_id_idx  on public.purchase_request_items(supplier_id);
create index if not exists expenses_farm_id_idx     on public.expenses(farm_id);
create index if not exists expenses_sector_id_idx   on public.expenses(sector_id);
create index if not exists expenses_hawsha_id_idx   on public.expenses(hawsha_id);
create index if not exists expenses_plan_id_idx     on public.expenses(plan_id);
create index if not exists expenses_supplier_id_idx on public.expenses(supplier_id);
