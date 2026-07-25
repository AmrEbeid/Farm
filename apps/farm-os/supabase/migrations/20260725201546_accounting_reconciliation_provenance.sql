-- Accounting reconciliation — slice 1A (schema: provenance and review only).
-- Source: "controlled accounting reconciliation design.md" §2.1-2.4, §9 item 1A, §10 row "1A", §13A.
--
-- SCOPE. Exactly three tables: reconciliation_batches, reconciliation_evidence_items,
-- reconciliation_batch_rows. RLS + FORCE RLS, fn_audit triggers, a freeze-immutability trigger, and
-- one additive authorize() permission (reconciliation.write, owner/accountant). No money-logic
-- dependency: zero writes to any existing table's DATA, and this migration performs no writes to
-- expenses/sales/journal_entries/journal_lines. NO RPC is added in this slice (staging/freeze/approve/
-- execution RPCs are explicitly deferred to later slices per §13A "Explicitly out of scope"), so there
-- is no client write path at all yet: every INSERT/UPDATE/DELETE grant is withheld from
-- authenticated/anon on all three tables — deny-by-default, matching "No direct client
-- insert/update/delete grants" in the task brief. Reads are gated by the PR #902 finance-read
-- organization-set helper (private.finance_read_org_ids(), 20260713152136_finance_read_org_set_rls.sql).
--
-- TENANT CONSISTENCY. reconciliation_batch_rows.batch_id / .evidence_item_id are enforced via
-- composite (id, org_id) foreign keys against the two new parent tables (a cross-org batch_id or
-- evidence_item_id is a foreign-key violation, not merely an assumption from two separate single-column
-- FKs). reconciliation_evidence_items.first_staged_batch_id is likewise a composite
-- (first_staged_batch_id, org_id) -> reconciliation_batches(id, org_id) FK, so an org-A evidence item
-- can never name an org-B batch as its first staging batch (nullable → MATCH SIMPLE skips the check when
-- unset). The remaining optional cross-table references on reconciliation_batch_rows
-- (expense_account_id, expense_cost_center_id, expense_supplier_id, sale_buyer_id, sale_cost_center_id,
-- sale_farm_id, sale_sector_id, sale_hawsha_id, corrects_expense_id, corrects_sale_id, reviewer_id)
-- point at pre-existing tables this migration does not alter, so a composite FK is not available;
-- fn_guard_reconciliation_batch_row_tenant() is an equivalent BEFORE INSERT/UPDATE guard that rejects
-- any populated reference whose own org_id does not match the batch row's org_id.
--
-- ROLLBACK RUNBOOK (exact, per §13A "Rollback DDL for slice 1A"):
--   begin;
--   drop trigger if exists guard_frozen_batch_row_immutable on public.reconciliation_batch_rows;
--   drop trigger if exists guard_reconciliation_batch_row_tenant on public.reconciliation_batch_rows;
--   drop trigger if exists audit_reconciliation_batch_row on public.reconciliation_batch_rows;
--   drop trigger if exists audit_reconciliation_evidence_item on public.reconciliation_evidence_items;
--   drop trigger if exists audit_reconciliation_batch on public.reconciliation_batches;
--   drop function if exists public.fn_guard_frozen_batch_row_immutable();
--   drop function if exists public.fn_guard_reconciliation_batch_row_tenant();
--   drop table if exists public.reconciliation_batch_rows;
--   drop table if exists public.reconciliation_evidence_items;
--   drop table if exists public.reconciliation_batches;
--   -- re-emit authorize() from the union in this migration with the reconciliation.write `or` clause
--   -- removed (verbatim 20260701420000 body restored — the prior full re-emit this migration itself
--   -- re-emits from).
--   -- re-emit audit_read on public.audit_log using the exact USING expression from
--   -- 20260713152136_finance_read_org_set_rls.sql (the prior full re-emit this migration re-emits
--   -- from), i.e. with reconciliation_batch/reconciliation_evidence_item/reconciliation_batch_row
--   -- removed from both the excluded list and the finance-gated list.
--   commit;
-- A fresh-DB replay after this rollback DDL is byte-identical to a fresh DB that never had this
-- migration applied. This migration is additive-only against pre-existing tables/rows (only new
-- tables, an additive authorize() `or` clause, and an additive audit_read entity-type union), so it is
-- not destructive against an existing database either.

begin;

-- ── 1) reconciliation_batches — one row per review/execution attempt (§2.1) ───────────────────────────
create table public.reconciliation_batches (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organization(id) on delete cascade,
  source_workbook_sha256  text,
  source_label            text,
  status                  text not null default 'staged'
    check (status in ('staged','reviewed','approved','executing','executed','failed','rolled_back')),
  created_at              timestamptz not null default now(),
  created_by              uuid default auth.uid(),
  approved_by             uuid,
  approved_at             timestamptz,
  -- counts/totals only — never private row-level values (§2.7 redaction discipline).
  result_summary          jsonb,
  constraint reconciliation_batches_org_id_uq unique (id, org_id)
);
create index reconciliation_batches_org_idx on public.reconciliation_batches(org_id);
create index reconciliation_batches_org_status_idx on public.reconciliation_batches(org_id, status);

-- ── 2) reconciliation_evidence_items — immutable, insert-only, one row per evidence position (§2.2) ───
create table public.reconciliation_evidence_items (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references public.organization(id) on delete cascade,
  origin_kind                 text not null
    check (origin_kind in ('source_workbook_row','production_snapshot_row')),
  -- source-workbook locator (populated only when origin_kind = 'source_workbook_row')
  source_workbook_sha256      text,
  sheet_name                  text,
  row_locator                 text,
  -- production-snapshot locator (populated only when origin_kind = 'production_snapshot_row')
  production_snapshot_sha256  text,
  snapshot_target_table       text check (snapshot_target_table is null or snapshot_target_table in ('expenses','sales')),
  snapshot_target_id          uuid,
  source_identity_fingerprint text,
  source_amount                numeric check (source_amount is null or source_amount >= 0),
  source_date_text            text,
  source_date_parsed          date,
  classification               text not null
    check (classification in (
      'source_addition_candidate','amount_correction_candidate','production_orphan_candidate',
      'zero_value_source_placeholder','ambiguous_identity_group'
    )),
  invalid_calendar_quality_flag boolean not null default false,
  first_staged_batch_id        uuid,
  created_at                   timestamptz not null default now(),
  created_by                   uuid default auth.uid(),
  constraint reconciliation_evidence_items_org_id_uq unique (id, org_id),
  -- composite tenant FK (Codex finding 1): first_staged_batch_id must name a batch in the SAME org, so
  -- an org-A evidence item can never cite an org-B batch as its first staging batch. Nullable → default
  -- MATCH SIMPLE skips the check entirely when first_staged_batch_id is unset (informational-only link).
  constraint reconciliation_evidence_items_first_batch_tenant_fk
    foreign key (first_staged_batch_id, org_id) references public.reconciliation_batches(id, org_id),
  -- exactly one of the two locator shapes, never both, never neither (§2.2 mutual exclusivity).
  constraint reconciliation_evidence_items_locator_shape check (
    (origin_kind = 'source_workbook_row'
       and source_workbook_sha256 is not null and sheet_name is not null and row_locator is not null
       and production_snapshot_sha256 is null and snapshot_target_table is null and snapshot_target_id is null)
    or
    (origin_kind = 'production_snapshot_row'
       and production_snapshot_sha256 is not null and snapshot_target_table is not null and snapshot_target_id is not null
       and source_workbook_sha256 is null and sheet_name is null and row_locator is null
       -- Codex finding 2: a production-orphan snapshot has NO workbook cell, so it must carry no
       -- source-only value/date — otherwise it fabricates false source provenance for the orphan.
       and source_amount is null and source_date_text is null and source_date_parsed is null)
  )
);
create index reconciliation_evidence_items_org_idx on public.reconciliation_evidence_items(org_id);
create index reconciliation_evidence_items_workbook_idx
  on public.reconciliation_evidence_items(org_id, source_workbook_sha256);
create index reconciliation_evidence_items_snapshot_idx
  on public.reconciliation_evidence_items(org_id, production_snapshot_sha256);
create index reconciliation_evidence_items_fingerprint_idx
  on public.reconciliation_evidence_items(org_id, source_identity_fingerprint);
-- covering index for the composite first_staged_batch_id FK (Codex finding 1 + 0036/#229(b) convention:
-- the covering index's leading columns must match the FK's own column order, so (first_staged_batch_id,
-- org_id), not first_staged_batch_id alone).
create index reconciliation_evidence_items_first_batch_idx
  on public.reconciliation_evidence_items(first_staged_batch_id, org_id);
-- the exact workbook cell exists at most once per pinned workbook, globally, independent of any batch.
create unique index reconciliation_evidence_items_workbook_position_uq
  on public.reconciliation_evidence_items(org_id, source_workbook_sha256, sheet_name, row_locator)
  where origin_kind = 'source_workbook_row';
-- the exact protected-snapshot target exists at most once per pinned snapshot, globally.
create unique index reconciliation_evidence_items_snapshot_position_uq
  on public.reconciliation_evidence_items(org_id, production_snapshot_sha256, snapshot_target_table, snapshot_target_id)
  where origin_kind = 'production_snapshot_row';

-- ── 3) reconciliation_batch_rows — one row per source row reviewed inside a specific batch (§2.3) ─────
create table public.reconciliation_batch_rows (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organization(id) on delete cascade,
  batch_id            uuid not null,
  evidence_item_id    uuid not null,
  review_state        text not null default 'unreviewed'
    check (review_state in ('unreviewed','reviewed','frozen','executed','rejected')),
  reviewer_id         uuid,
  review_reason       text,
  reviewed_at         timestamptz,
  target_table        text check (target_table is null or target_table in ('expenses','sales')),
  disposition         text not null default 'hold' check (disposition in ('include','hold')),
  -- typed reviewed expense fields (mandatory only when target_table = 'expenses' and disposition = 'include')
  expense_category           text,
  expense_description        text,
  expense_kind                text check (expense_kind is null or expense_kind in ('operating','drawing','capex')),
  expense_account_id          uuid references public.accounts(id),
  expense_cost_center_id      uuid references public.cost_centers(id),
  expense_supplier_id         uuid references public.suppliers(id),
  expense_payment_decision    text check (expense_payment_decision is null or expense_payment_decision in ('unrouted','routed_now')),
  -- typed reviewed sale fields (mandatory only when target_table = 'sales' and disposition = 'include')
  sale_crop                   text,
  sale_quantity                numeric check (sale_quantity is null or sale_quantity >= 0),
  sale_unit                    text,
  sale_unit_price              numeric check (sale_unit_price is null or sale_unit_price >= 0),
  sale_recorded_total          numeric check (sale_recorded_total is null or sale_recorded_total >= 0),
  sale_buyer_id                uuid references public.buyers(id),
  sale_cost_center_id          uuid references public.cost_centers(id),
  sale_farm_id                 uuid references public.farms(id),
  sale_sector_id               uuid references public.sectors(id),
  sale_hawsha_id               uuid references public.hawshat(id),
  sale_season                  text,
  sale_delivery_date           date,
  sale_notes                   text,
  sale_historical_date_decision text
    check (sale_historical_date_decision is null
      or sale_historical_date_decision in ('use_source_text_date','use_matched_production_date','manual_override')),
  sale_effective_date          date,
  -- correction target ids on the batch row only, for this slice (§13A note).
  corrects_expense_id          uuid references public.expenses(id),
  corrects_sale_id             uuid references public.sales(id),
  -- freeze/execution bookkeeping (§2.4)
  payload_hash          text,
  frozen                 boolean not null default false,
  frozen_at              timestamptz,
  execution_result       text not null default 'pending'
    check (execution_result in ('pending','posted','reversed','skipped','failed')),
  execution_error         text,
  created_at              timestamptz not null default now(),
  created_by               uuid default auth.uid(),
  constraint reconciliation_batch_rows_batch_evidence_uq unique (batch_id, evidence_item_id),
  -- composite tenant FKs: a cross-org batch_id/evidence_item_id is a foreign-key violation, not an
  -- assumption from two separate single-column FKs.
  constraint reconciliation_batch_rows_batch_tenant_fk
    foreign key (batch_id, org_id) references public.reconciliation_batches(id, org_id) on delete cascade,
  constraint reconciliation_batch_rows_evidence_tenant_fk
    foreign key (evidence_item_id, org_id) references public.reconciliation_evidence_items(id, org_id),
  -- typed columns required when the row is actually included for a target domain (§2.3, §13A).
  constraint reconciliation_batch_rows_target_required check (
    disposition <> 'include'
    or (
      target_table = 'expenses'
        and expense_category is not null and expense_kind is not null and expense_account_id is not null
    )
    or (
      target_table = 'sales'
        and sale_crop is not null and sale_quantity is not null
        and sale_unit_price is not null and sale_recorded_total is not null
    )
  ),
  -- a correction target id may only be populated for its own matching target domain, and never both.
  -- Whether a correction id is allowed/required at all depends on the linked evidence item's
  -- classification (amount_correction_candidate), which lives on another table — a CHECK constraint
  -- cannot look that up, so it is enforced in fn_guard_reconciliation_batch_row_tenant() below
  -- (Codex finding 4).
  constraint reconciliation_batch_rows_correction_domain_match check (
    (corrects_expense_id is null or target_table = 'expenses')
    and (corrects_sale_id is null or target_table = 'sales')
    and not (corrects_expense_id is not null and corrects_sale_id is not null)
  )
);
create index reconciliation_batch_rows_org_idx on public.reconciliation_batch_rows(org_id);
create index reconciliation_batch_rows_batch_review_idx on public.reconciliation_batch_rows(batch_id, review_state);
-- covering indexes for the two composite tenant FKs (leading columns must match the FK's own column
-- order exactly, per the #229(b) invariant — a single-column index on the first column alone is not
-- a covering index for a two-column FK).
create index reconciliation_batch_rows_batch_tenant_idx on public.reconciliation_batch_rows(batch_id, org_id);
create index reconciliation_batch_rows_evidence_tenant_idx on public.reconciliation_batch_rows(evidence_item_id, org_id);
-- covering indexes for the remaining single-column FKs into pre-existing tables.
create index reconciliation_batch_rows_expense_account_idx on public.reconciliation_batch_rows(expense_account_id);
create index reconciliation_batch_rows_expense_cost_center_idx on public.reconciliation_batch_rows(expense_cost_center_id);
create index reconciliation_batch_rows_expense_supplier_idx on public.reconciliation_batch_rows(expense_supplier_id);
create index reconciliation_batch_rows_sale_buyer_idx on public.reconciliation_batch_rows(sale_buyer_id);
create index reconciliation_batch_rows_sale_cost_center_idx on public.reconciliation_batch_rows(sale_cost_center_id);
create index reconciliation_batch_rows_sale_farm_idx on public.reconciliation_batch_rows(sale_farm_id);
create index reconciliation_batch_rows_sale_sector_idx on public.reconciliation_batch_rows(sale_sector_id);
create index reconciliation_batch_rows_sale_hawsha_idx on public.reconciliation_batch_rows(sale_hawsha_id);
create index reconciliation_batch_rows_corrects_expense_idx on public.reconciliation_batch_rows(corrects_expense_id);
create index reconciliation_batch_rows_corrects_sale_idx on public.reconciliation_batch_rows(corrects_sale_id);

-- ── 4) tenant-consistency guard for the remaining optional cross-table references (equivalent guard,
--    since the referenced tables are pre-existing and not altered here to carry a composite unique key),
--    PLUS the correction-target/classification consistency guard (Codex finding 4): a CHECK constraint
--    cannot look up another table's column, so this trigger — which already does same-org lookups for
--    every other optional reference — is extended to read the same-org evidence item's classification
--    (selected via evidence_item_id) and enforce it against corrects_expense_id/corrects_sale_id.
create or replace function public.fn_guard_reconciliation_batch_row_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evidence_classification text;
begin
  if new.expense_account_id is not null and not exists (
    select 1 from public.accounts a where a.id = new.expense_account_id and a.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: expense_account_id belongs to another organization' using errcode = '23514';
  end if;
  if new.expense_cost_center_id is not null and not exists (
    select 1 from public.cost_centers c where c.id = new.expense_cost_center_id and c.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: expense_cost_center_id belongs to another organization' using errcode = '23514';
  end if;
  if new.expense_supplier_id is not null and not exists (
    select 1 from public.suppliers s where s.id = new.expense_supplier_id and s.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: expense_supplier_id belongs to another organization' using errcode = '23514';
  end if;
  if new.sale_buyer_id is not null and not exists (
    select 1 from public.buyers b where b.id = new.sale_buyer_id and b.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: sale_buyer_id belongs to another organization' using errcode = '23514';
  end if;
  if new.sale_cost_center_id is not null and not exists (
    select 1 from public.cost_centers c where c.id = new.sale_cost_center_id and c.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: sale_cost_center_id belongs to another organization' using errcode = '23514';
  end if;
  if new.sale_farm_id is not null and not exists (
    select 1 from public.farms f where f.id = new.sale_farm_id and f.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: sale_farm_id belongs to another organization' using errcode = '23514';
  end if;
  if new.sale_sector_id is not null and not exists (
    select 1 from public.sectors s where s.id = new.sale_sector_id and s.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: sale_sector_id belongs to another organization' using errcode = '23514';
  end if;
  if new.sale_hawsha_id is not null and not exists (
    select 1 from public.hawshat h where h.id = new.sale_hawsha_id and h.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: sale_hawsha_id belongs to another organization' using errcode = '23514';
  end if;
  if new.corrects_expense_id is not null and not exists (
    select 1 from public.expenses e where e.id = new.corrects_expense_id and e.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: corrects_expense_id belongs to another organization' using errcode = '23514';
  end if;
  if new.corrects_sale_id is not null and not exists (
    select 1 from public.sales sl where sl.id = new.corrects_sale_id and sl.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: corrects_sale_id belongs to another organization' using errcode = '23514';
  end if;
  if new.reviewer_id is not null and not exists (
    select 1 from public.organization_member m where m.user_id = new.reviewer_id and m.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: reviewer_id is not a member of this organization' using errcode = '23514';
  end if;

  -- Codex finding 4: read the same-org evidence item's classification (a cross-org evidence_item_id
  -- yields no row here and is treated the same as unclassified — the composite tenant FK above is the
  -- authoritative rejection for that case).
  select ei.classification into v_evidence_classification
  from public.reconciliation_evidence_items ei
  where ei.id = new.evidence_item_id and ei.org_id = new.org_id;

  if (new.corrects_expense_id is not null or new.corrects_sale_id is not null)
    and v_evidence_classification is distinct from 'amount_correction_candidate'
  then
    raise exception
      'reconciliation_batch_rows: a correction target id requires amount_correction_candidate evidence classification'
      using errcode = '23514';
  end if;

  if new.disposition = 'include' and v_evidence_classification = 'amount_correction_candidate' then
    if new.target_table = 'expenses' and new.corrects_expense_id is null then
      raise exception
        'reconciliation_batch_rows: an included amount_correction_candidate expenses row requires corrects_expense_id'
        using errcode = '23514';
    end if;
    if new.target_table = 'sales' and new.corrects_sale_id is null then
      raise exception
        'reconciliation_batch_rows: an included amount_correction_candidate sales row requires corrects_sale_id'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
revoke execute on function public.fn_guard_reconciliation_batch_row_tenant() from public, anon, authenticated;
create trigger guard_reconciliation_batch_row_tenant
  before insert or update on public.reconciliation_batch_rows
  for each row execute function public.fn_guard_reconciliation_batch_row_tenant();

-- ── 5) freeze-immutability guard (§2.4). Once frozen = true, blocks any change to row identity/creation
--    provenance (id, created_at, created_by — Codex finding 3), provenance links, review decisions, and
--    the typed payload; permits ONLY the enumerated execution-bookkeeping columns (execution_result,
--    execution_error); blocks unfreezing. Enforced as a row-level trigger that inspects OLD/NEW directly
--    — it does not rely on the client role alone.
create or replace function public.fn_guard_frozen_batch_row_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.frozen = true then
    if new.frozen = false then
      raise exception 'reconciliation_batch_rows: cannot unfreeze a frozen row' using errcode = '22023';
    end if;
    if new.id is distinct from old.id
      or new.created_at is distinct from old.created_at
      or new.created_by is distinct from old.created_by
      or new.org_id is distinct from old.org_id
      or new.batch_id is distinct from old.batch_id
      or new.evidence_item_id is distinct from old.evidence_item_id
      or new.review_state is distinct from old.review_state
      or new.reviewer_id is distinct from old.reviewer_id
      or new.review_reason is distinct from old.review_reason
      or new.reviewed_at is distinct from old.reviewed_at
      or new.target_table is distinct from old.target_table
      or new.disposition is distinct from old.disposition
      or new.expense_category is distinct from old.expense_category
      or new.expense_description is distinct from old.expense_description
      or new.expense_kind is distinct from old.expense_kind
      or new.expense_account_id is distinct from old.expense_account_id
      or new.expense_cost_center_id is distinct from old.expense_cost_center_id
      or new.expense_supplier_id is distinct from old.expense_supplier_id
      or new.expense_payment_decision is distinct from old.expense_payment_decision
      or new.sale_crop is distinct from old.sale_crop
      or new.sale_quantity is distinct from old.sale_quantity
      or new.sale_unit is distinct from old.sale_unit
      or new.sale_unit_price is distinct from old.sale_unit_price
      or new.sale_recorded_total is distinct from old.sale_recorded_total
      or new.sale_buyer_id is distinct from old.sale_buyer_id
      or new.sale_cost_center_id is distinct from old.sale_cost_center_id
      or new.sale_farm_id is distinct from old.sale_farm_id
      or new.sale_sector_id is distinct from old.sale_sector_id
      or new.sale_hawsha_id is distinct from old.sale_hawsha_id
      or new.sale_season is distinct from old.sale_season
      or new.sale_delivery_date is distinct from old.sale_delivery_date
      or new.sale_notes is distinct from old.sale_notes
      or new.sale_historical_date_decision is distinct from old.sale_historical_date_decision
      or new.sale_effective_date is distinct from old.sale_effective_date
      or new.corrects_expense_id is distinct from old.corrects_expense_id
      or new.corrects_sale_id is distinct from old.corrects_sale_id
      or new.payload_hash is distinct from old.payload_hash
      or new.frozen_at is distinct from old.frozen_at
    then
      raise exception
        'reconciliation_batch_rows: frozen row — only execution_result/execution_error may change'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_guard_frozen_batch_row_immutable() from public, anon, authenticated;
create trigger guard_frozen_batch_row_immutable
  before update on public.reconciliation_batch_rows
  for each row execute function public.fn_guard_frozen_batch_row_immutable();

-- ── 6) RLS + FORCE RLS on all three tables. Reads gated on the PR #902 finance-read organization-set
--    helper (private.finance_read_org_ids()). No RPC exists in this slice, so NO client
--    insert/update/delete grant is issued on any of the three tables — deny-by-default via FORCE RLS
--    plus withheld grants. reconciliation_evidence_items additionally has no update/delete route at
--    all, matching its immutable/insert-only design (§2.2) — no such grant is ever issued to any role.
alter table public.reconciliation_batches enable row level security;
alter table public.reconciliation_batches force row level security;
create policy tenant_read on public.reconciliation_batches for select to authenticated
  using (org_id in (select private.finance_read_org_ids()));
grant select on public.reconciliation_batches to authenticated;

alter table public.reconciliation_evidence_items enable row level security;
alter table public.reconciliation_evidence_items force row level security;
create policy tenant_read on public.reconciliation_evidence_items for select to authenticated
  using (org_id in (select private.finance_read_org_ids()));
grant select on public.reconciliation_evidence_items to authenticated;

alter table public.reconciliation_batch_rows enable row level security;
alter table public.reconciliation_batch_rows force row level security;
create policy tenant_read on public.reconciliation_batch_rows for select to authenticated
  using (org_id in (select private.finance_read_org_ids()));
grant select on public.reconciliation_batch_rows to authenticated;

-- ── 7) audit — fn_audit triggers on all three tables (append-only audit_log, same convention as every
--    other financial table). ──────────────────────────────────────────────────────────────────────────
create trigger audit_reconciliation_batch
  after insert or update or delete on public.reconciliation_batches
  for each row execute function public.fn_audit('reconciliation_batch');
create trigger audit_reconciliation_evidence_item
  after insert or update or delete on public.reconciliation_evidence_items
  for each row execute function public.fn_audit('reconciliation_evidence_item');
create trigger audit_reconciliation_batch_row
  after insert or update or delete on public.reconciliation_batch_rows
  for each row execute function public.fn_audit('reconciliation_batch_row');

-- ── 8) authorize() re-emit: current union (20260701420000, 19 perms) + reconciliation.write
--    (owner/accountant only). Additive only — every existing permission line is preserved verbatim. ──
create or replace function public.authorize(perm text, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_member m
    where m.user_id = (select auth.uid())
      and m.org_id = p_org
      and ( (perm = 'pr.approve'             and m.role = 'owner')
         or (perm = 'plan.write'             and m.role in ('owner','farm_manager'))
         or (perm = 'op.execute'             and m.role in ('owner','farm_manager','agri_engineer','supervisor'))
         or (perm = 'inventory.write'        and m.role in ('owner','farm_manager','storekeeper'))
         or (perm = 'budget.write'           and m.role in ('owner','accountant'))
         or (perm = 'payroll.read'           and m.role in ('owner','accountant'))
         or (perm = 'structure.write'        and m.role in ('owner','farm_manager'))
         or (perm = 'academy.write'          and m.role in ('owner','agri_engineer'))   -- in-flight #366 (forward-compat)
         or (perm = 'export.write'           and m.role in ('owner','farm_manager'))     -- in-flight #400 (forward-compat)
         or (perm = 'responsibility.write'   and m.role in ('owner','farm_manager'))     -- in-flight #444 (forward-compat)
         or (perm = 'finance.read'           and m.role in ('owner','accountant'))        -- SPEC-0018 confidential finance reads
         or (perm = 'custody.write'          and m.role in ('owner','accountant'))        -- SPEC-0018 finance-only custody writes
         or (perm = 'request.prepare'        and m.role in ('owner','accountant'))        -- SPEC-0018 finance-only payment prep
         or (perm = 'request.approve.op'     and m.role in ('owner','accountant'))        -- SPEC-0018 finance approval
         or (perm = 'request.approve.final'  and m.role = 'owner')                       -- SPEC-0018 owner final approval
         or (perm = 'agronomy.signoff'       and m.role in ('owner','agri_engineer'))    -- PR #557: non-negotiable #4 sign-off gate (REASONABLE DEFAULT, not Owner's final word)
         or (perm = 'people.write'           and m.role in ('owner','farm_manager'))                 -- SPEC-0006: onboarding
         or (perm = 'labor.write'            and m.role in ('owner','farm_manager','supervisor'))    -- SPEC-0006: attendance
         or (perm = 'site.write'             and m.role = 'owner')                        -- public marketing site content (owner-only)
         or (perm = 'reconciliation.write'   and m.role in ('owner','accountant')) )      -- accounting reconciliation slice 1A review/staging writes
  )
$$;

-- ── 9) audit_read re-emit: extend the current full body (20260713152136_finance_read_org_set_rls.sql)
--    with the three new entity types, gated behind finance.read exactly like buyer/sale_collection/
--    accounting_period were. Every existing branch is preserved unchanged. ─────────────────────────────
alter policy audit_read on public.audit_log
  using (
    org_id in (select public.user_org_ids())
    and (
      (
        entity_type is distinct from 'people_compensation'
        and entity_type not in (
          'sale','expense','custody_account','custody_movement','payment_request','payment_request_line',
          'account','journal_entry','journal_line','payment_request_funding','cost_center','offshoot_valuation',
          'buyer','sale_collection','accounting_period',
          'reconciliation_batch','reconciliation_evidence_item','reconciliation_batch_row'
        )
      )
      or (entity_type = 'people_compensation' and public.authorize('payroll.read', org_id))
      or (entity_type in ('sale','expense') and public.authorize('budget.write', org_id))
      or (
        entity_type in (
          'custody_account','custody_movement','payment_request','payment_request_line',
          'account','journal_entry','journal_line','payment_request_funding','cost_center','offshoot_valuation',
          'buyer','sale_collection','accounting_period',
          'reconciliation_batch','reconciliation_evidence_item','reconciliation_batch_row'
        )
        and org_id in (select private.finance_read_org_ids())
      )
    )
  );

commit;
