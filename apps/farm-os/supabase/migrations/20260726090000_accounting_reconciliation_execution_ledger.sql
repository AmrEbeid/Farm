-- Accounting reconciliation — slice 1B (schema: execution/rollback ledger, no execution RPC body).
-- Source: "controlled accounting reconciliation design.md" §2.5-2.8, §7 preflight, §8 rollback,
-- §9 item 1B, §10 row "1B", §13B.
--
-- SCOPE. Exactly five tables: reconciliation_execution_ledger, reconciliation_action_links,
-- reconciliation_baselines, reconciliation_baseline_journal_headers,
-- reconciliation_baseline_journal_lines. Plus four additive nullable columns:
-- expenses.corrects_expense_id, expenses.reversed_by_rollback_at, sales.corrects_sale_id,
-- sales.reversed_by_rollback_at. This migration is schema-only: no execution RPC
-- (fn_execute_reconciliation_batch, slice 4/5) and no rollback RPC (fn_rollback_reconciliation_batch,
-- slice 7) body is added here. No new authorize() permission is needed — these five tables carry
-- zero client INSERT/UPDATE/DELETE grants (same deny-by-default posture as slice 1A) and the four new
-- expenses/sales columns carry no grant either, so there is no new gated client action to permission.
-- No fn_audit trigger is added on the five new tables (design §9 item 1B / §13B: "execution-time-only,
-- audited implicitly via the batch's own audit trail").
--
-- TENANT CONSISTENCY. Applied per the exact rule slice 1A itself established: a composite (id, org_id)
-- foreign key where the referenced table already carries (or can safely be given, because this
-- migration alters it anyway) a supporting composite unique key; an equivalent BEFORE INSERT/UPDATE
-- guard trigger where the referenced table is pre-existing and not otherwise altered here.
--   - reconciliation_batches, reconciliation_evidence_items already carry `unique (id, org_id)` from
--     slice 1A — composite FKs against them are immediate.
--   - reconciliation_batch_rows (slice 1A) did NOT carry `unique (id, org_id)` (1A had no need to
--     reference it compositely). This migration adds that constraint once, so
--     reconciliation_execution_ledger.executed_by_batch_row_id and
--     reconciliation_action_links.batch_row_id can be true composite tenant FKs instead of a guard.
--   - expenses and sales are altered in this same migration anyway (the four additive columns), so
--     this migration also adds `unique (id, org_id)` to both, making
--     expenses.corrects_expense_id / sales.corrects_sale_id self-references true composite tenant FKs.
--   - journal_entries, journal_lines, expenses, and sales are the targets of reconciliation_action_links'
--     polymorphic/optional references (below) and are NOT altered by this migration for that specific
--     purpose (expenses/sales ARE altered for the additive columns, but a composite FK is unavailable for
--     a polymorphic column regardless — see POLYMORPHIC TARGET), so — exactly like slice 1A's treatment
--     of accounts/cost_centers/suppliers/buyers/farms/sectors/hawshat/expenses/sales — these references
--     (reconciliation_action_links.target_id/journal_entry_id/reinstates_journal_entry_id,
--     reconciliation_baseline_journal_headers.original_journal_entry_id/reversal_of,
--     reconciliation_baseline_journal_lines.original_journal_line_id/account_id/cost_center_id/
--     custody_account_id/custody_movement_id/expense_id/payment_request_id) keep a plain single-column
--     FK for existence (where the referenced table supports one), plus an equivalent guard trigger
--     asserting org_id equality where a plain FK cannot (target_id is polymorphic; and, for baseline
--     lines, that the referenced line actually belongs to the header's own snapshotted journal entry —
--     a check no FK can express).
--   - #229(b) invariant (tests/96_fk_covering_index_invariant_test.sql): every public FK, including every
--     plain single-column one introduced above, gets its own covering index whose leading columns equal
--     the FK's own columns — not only the composite tenant FKs.
--
-- POLYMORPHIC TARGET (reconciliation_action_links). Per the accepted design's exact §2.6/§13B contract,
-- `target_table` (`expenses` | `sales` | null) discriminates a single `target_id` column — the domain
-- row this action affected, or both null for a zero_value_noop that writes no domain row at all (§11
-- item 3). Postgres has no polymorphic/conditional foreign key, so `target_id` carries no FK; tenant
-- integrity is instead enforced by the same BEFORE INSERT/UPDATE guard trigger that already handles
-- journal_entry_id/reinstates_journal_entry_id
-- (fn_guard_reconciliation_action_link_tenant), extended to look up `expenses` or `sales` by
-- `target_id` — whichever `target_table` names — and reject a cross-org or nonexistent target
-- (errcode 23514). An index on `(target_table, target_id)` supports the future postflight/rollback joins
-- §7/§8 describe.
--
-- CANONICAL SERIALIZATION CONTRACT (reconciliation_baseline_journal_headers/_lines, §2.8). Slice 1B adds
-- no execution RPC, so no trigger computes `canonical_hash` here — a future preflight step (slice 4/5/7)
-- populates it. To keep that a well-defined, testable contract rather than an unstated "some hash, some
-- day", this migration pins the exact deterministic formula slice 4/5/7 must reproduce, over EVERY
-- replay-relevant typed column (never a subset — a subset cannot catch drift in an omitted column):
--   header: encode(digest(jsonb_build_object(
--     'original_journal_entry_id', original_journal_entry_id, 'entry_date', entry_date,
--     'source_type', source_type, 'source_id', source_id, 'source_sequence', source_sequence,
--     'description', description, 'status', status, 'posted_at', posted_at,
--     'posted_by', posted_by, 'reversal_of', reversal_of
--   )::text, 'sha256'), 'hex')
--   line: encode(digest(jsonb_build_object(
--     'original_journal_line_id', original_journal_line_id, 'line_ordinal', line_ordinal,
--     'account_id', account_id, 'debit', debit, 'credit', credit, 'description', description,
--     'cost_center_id', cost_center_id, 'custody_account_id', custody_account_id,
--     'custody_movement_id', custody_movement_id, 'expense_id', expense_id,
--     'payment_request_id', payment_request_id
--   )::text, 'sha256'), 'hex')
-- `jsonb_build_object` represents every key explicitly (a null field is `"key":null`, never silently
-- omitted the way `concat_ws` would), so two rows differing only in a null-vs-populated field can never
-- collide to the same hash. This slice's own pgTAP fixture exercises this exact formula end-to-end
-- (insert with the computed hash, then independently recompute from the stored row and assert equality)
-- across every one of the listed columns for both tables — proof the contract is reproducible, ahead of
-- slice 4/5/7 actually calling it from a real preflight capture.
--
-- BASELINE IMMUTABILITY THROUGH PRIVILEGED PATHS. reconciliation_baseline_journal_headers/_lines must
-- stay immutable even from a future SECURITY DEFINER RPC (slice 4/5/6/7's execution/rollback engine),
-- because a SECURITY DEFINER function runs as the function owner and is not stopped by a client-role
-- GRANT alone. This migration reuses the repository's own established pattern for exactly that
-- guarantee — the `before update or delete` trigger added for reconciliation_batch_rows'
-- frozen-row hardening (20260726083000_reconciliation_frozen_row_hardening.sql) — except these two
-- tables have no bookkeeping-column carve-out at all: every column is provenance, so the trigger
-- rejects every UPDATE and every DELETE unconditionally, from any role, including the table owner.
--
-- MONEY-INTEGRITY HARDENING (round 2, this same draft). Because a future execution/rollback RPC (slice
-- 4/5/6/7) will trust this schema as its money-integrity boundary — reading these rows to decide what to
-- post/reverse without re-deriving them from source — four gaps were closed before any such RPC is ever
-- written against it:
--   1. Baseline snapshot fidelity: the two immutability guard triggers below no longer only check that
--      the referenced original journal_entries/journal_lines row belongs to the same org — they fetch that
--      row and reject the insert unless EVERY copied typed column matches it verbatim, and independently
--      re-verify each of a line's optional dimension FKs (account_id, cost_center_id, custody_account_id,
--      custody_movement_id, expense_id, payment_request_id) against its own org_id — fail-closed even if
--      the source journal_lines row itself already carries a bad (e.g. legacy, cross-org) reference.
--   2. One typed snapshot per source: `unique (batch_id, original_journal_entry_id)` on
--      reconciliation_baseline_journal_headers, `unique (baseline_journal_header_id,
--      original_journal_line_id)` and `unique (baseline_journal_header_id, line_ordinal)` on
--      reconciliation_baseline_journal_lines.
--   3. Execution-ledger relational semantics: a guard trigger requires executed_by_batch_row_id, when
--      set, to name a batch row for the SAME evidence_item_id (not just the same org); a check constraint
--      ties status to its required metadata shape (unexecuted: none; executed: executed_by_batch_row_id +
--      executed_at, no reversed_at; reversed: all three).
--   4. Action-link relational semantics: a guard trigger requires batch_row_id to actually belong to
--      batch_id (the two composite FKs alone permit batch_id from one batch and batch_row_id from an
--      unrelated same-org batch), and requires a populated target_table to agree with the batch row's own
--      reviewed target_table (fail-closed otherwise). Check constraints require target_table/target_id/
--      journal_entry_id together for every action_kind except zero_value_noop (which requires
--      journal_entry_id null and the target pair either both null or both populated, per §6/§11 item 3's
--      open question over whether a zero-value row gets an operational domain record), and require
--      reinstates_journal_entry_id non-null for exactly the two reinstatement kinds, null otherwise.
--
-- ROLLBACK RUNBOOK (exact):
--   begin;
--   drop trigger if exists guard_reconciliation_execution_ledger_tenant on public.reconciliation_execution_ledger;
--   drop trigger if exists guard_baseline_journal_line_immutable on public.reconciliation_baseline_journal_lines;
--   drop trigger if exists guard_baseline_journal_header_immutable on public.reconciliation_baseline_journal_headers;
--   drop trigger if exists guard_reconciliation_action_link_tenant on public.reconciliation_action_links;
--   drop function if exists public.fn_guard_reconciliation_execution_ledger_tenant();
--   drop function if exists public.fn_guard_baseline_journal_line_immutable();
--   drop function if exists public.fn_guard_baseline_journal_header_immutable();
--   drop function if exists public.fn_guard_reconciliation_action_link_tenant();
--   drop table if exists public.reconciliation_baseline_journal_lines;
--   drop table if exists public.reconciliation_baseline_journal_headers;
--   drop table if exists public.reconciliation_execution_ledger;
--   drop table if exists public.reconciliation_action_links;
--   drop table if exists public.reconciliation_baselines;
--   alter table public.expenses drop constraint if exists expenses_corrects_expense_id_org_fk;
--   alter table public.expenses drop constraint if exists expenses_corrects_expense_id_not_self;
--   alter table public.expenses drop column if exists corrects_expense_id;
--   alter table public.expenses drop column if exists reversed_by_rollback_at;
--   alter table public.sales drop constraint if exists sales_corrects_sale_id_org_fk;
--   alter table public.sales drop constraint if exists sales_corrects_sale_id_not_self;
--   alter table public.sales drop column if exists corrects_sale_id;
--   alter table public.sales drop column if exists reversed_by_rollback_at;
--   alter table public.expenses drop constraint if exists expenses_id_org_id_uq;
--   alter table public.sales drop constraint if exists sales_id_org_id_uq;
--   alter table public.reconciliation_batch_rows drop constraint if exists reconciliation_batch_rows_id_org_id_uq;
--   commit;
-- A fresh-DB replay after this rollback DDL (with slice 1A still applied) is byte-identical to a fresh
-- DB with only slice 1A applied. This migration performs no writes to any existing table's DATA, only
-- additive DDL (new tables, new nullable columns, new supporting unique constraints on existing
-- tables), so it is not destructive against an existing database either.

begin;

-- ── 0) supporting composite-uniqueness anchors on tables this migration alters anyway (see the header
--    comment's TENANT CONSISTENCY note). Each is a no-op against existing data: `id` is already the
--    table's primary key (globally unique), so `unique (id, org_id)` can never fail to build.
--    drop-then-add for idempotent replay (matches the repo's established constraint-re-apply pattern,
--    e.g. `expenses_payment_status_check` in 20260629150000). ──────────────────────────────────────────
alter table public.reconciliation_batch_rows drop constraint if exists reconciliation_batch_rows_id_org_id_uq;
alter table public.reconciliation_batch_rows
  add constraint reconciliation_batch_rows_id_org_id_uq unique (id, org_id);
alter table public.expenses drop constraint if exists expenses_id_org_id_uq;
alter table public.expenses
  add constraint expenses_id_org_id_uq unique (id, org_id);
alter table public.sales drop constraint if exists sales_id_org_id_uq;
alter table public.sales
  add constraint sales_id_org_id_uq unique (id, org_id);

-- ── 1) reconciliation_execution_ledger — the single source of truth for "has this evidence item
--    already been executed" (§2.5). Global per evidence item, not per batch. ─────────────────────────
create table public.reconciliation_execution_ledger (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.organization(id) on delete cascade,
  evidence_item_id          uuid not null,
  status                    text not null default 'unexecuted'
    check (status in ('unexecuted','executed','reversed')),
  executed_by_batch_row_id  uuid,
  executed_at               timestamptz,
  reversed_at               timestamptz,
  constraint reconciliation_execution_ledger_evidence_tenant_fk
    foreign key (evidence_item_id, org_id) references public.reconciliation_evidence_items(id, org_id),
  constraint reconciliation_execution_ledger_batch_row_tenant_fk
    foreign key (executed_by_batch_row_id, org_id) references public.reconciliation_batch_rows(id, org_id),
  -- status/metadata shape (Codex review round 2, item 3): each status carries exactly its required
  -- execution/reversal bookkeeping, never more, never less.
  constraint reconciliation_execution_ledger_status_metadata check (
    (status = 'unexecuted' and executed_by_batch_row_id is null and executed_at is null and reversed_at is null)
    or (status = 'executed' and executed_by_batch_row_id is not null and executed_at is not null and reversed_at is null)
    or (status = 'reversed' and executed_by_batch_row_id is not null and executed_at is not null and reversed_at is not null)
  )
);
-- the actual double-execution guard (§2.5, §3.2): at most one ledger row may be `executed` for a given
-- evidence item at any time. This is what the "forced concurrent" acceptance test exercises directly.
create unique index reconciliation_execution_ledger_executed_uq
  on public.reconciliation_execution_ledger(evidence_item_id)
  where status = 'executed';
create index reconciliation_execution_ledger_org_evidence_idx
  on public.reconciliation_execution_ledger(org_id, evidence_item_id);
-- covering index for the composite tenant FK, leading columns matching the FK's own column order
-- (the #229(b) invariant slice 1A's comments already document).
create index reconciliation_execution_ledger_evidence_tenant_idx
  on public.reconciliation_execution_ledger(evidence_item_id, org_id);
create index reconciliation_execution_ledger_batch_row_tenant_idx
  on public.reconciliation_execution_ledger(executed_by_batch_row_id, org_id);

-- relational guard (Codex review round 2, item 3): the composite FK above only proves
-- executed_by_batch_row_id names a batch row in the SAME ORG — it does not prove that batch row is
-- actually a review of THIS evidence item. A batch row reviewing a different evidence item must never be
-- recorded as having executed this one.
create or replace function public.fn_guard_reconciliation_execution_ledger_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.executed_by_batch_row_id is not null and not exists (
    select 1 from public.reconciliation_batch_rows br
    where br.id = new.executed_by_batch_row_id
      and br.org_id = new.org_id
      and br.evidence_item_id = new.evidence_item_id
  ) then
    raise exception
      'reconciliation_execution_ledger: executed_by_batch_row_id does not review this evidence_item_id in this organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_guard_reconciliation_execution_ledger_tenant() from public, anon, authenticated;
create trigger guard_reconciliation_execution_ledger_tenant
  before insert or update on public.reconciliation_execution_ledger
  for each row execute function public.fn_guard_reconciliation_execution_ledger_tenant();

-- ── 2) reconciliation_action_links — populated inside the (future) execution transaction, one row per
--    action actually taken (§2.6, §8). ──────────────────────────────────────────────────────────────────
create table public.reconciliation_action_links (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references public.organization(id) on delete cascade,
  batch_id                    uuid not null,
  batch_row_id                uuid not null,
  action_kind                 text not null check (action_kind in (
    'addition', 'correction_reversal', 'correction_replacement',
    'correction_reversal_reinstatement', 'orphan_reversal', 'orphan_reversal_reinstatement',
    'zero_value_noop'
  )),
  target_table                text check (target_table is null or target_table in ('expenses','sales')),
  target_id                    uuid,
  journal_entry_id             uuid references public.journal_entries(id),
  reinstates_journal_entry_id  uuid references public.journal_entries(id),
  constraint reconciliation_action_links_batch_tenant_fk
    foreign key (batch_id, org_id) references public.reconciliation_batches(id, org_id),
  constraint reconciliation_action_links_batch_row_tenant_fk
    foreign key (batch_row_id, org_id) references public.reconciliation_batch_rows(id, org_id),
  -- target_table and target_id are set together, or both null (e.g. a zero_value_noop that — per
  -- design §11 item 3 — writes no domain row at all). target_id has no FK (polymorphic: it names a row
  -- in whichever of expenses/sales target_table points at) — tenant/existence integrity is enforced by
  -- the guard trigger below instead (see the migration header's POLYMORPHIC TARGET note).
  constraint reconciliation_action_links_target_shape check (
    (target_table is null) = (target_id is null)
  ),
  -- Codex review round 2, item 4: every action_kind except zero_value_noop is a real posted/reversed
  -- action against a specific domain row, so it requires target_table+target_id AND journal_entry_id all
  -- populated together. zero_value_noop posts no journal (§6 "Zero-value rows") so journal_entry_id must
  -- be null; whether it also gets an operational domain row is an open Owner decision (§11 item 3), so
  -- its target pair may be either both null or both populated (the target_shape check above still applies
  -- either way).
  constraint reconciliation_action_links_target_journal_required check (
    (action_kind = 'zero_value_noop' and journal_entry_id is null)
    or (action_kind <> 'zero_value_noop'
        and target_table is not null and target_id is not null and journal_entry_id is not null)
  ),
  -- reinstatement linkage (§8): reinstates_journal_entry_id is REQUIRED for exactly the two reinstatement
  -- action kinds it exists to support, and forbidden for every other kind (Codex review round 2, item 4 —
  -- stricter than merely "optional for those two, forbidden elsewhere").
  constraint reconciliation_action_links_reinstatement_kind check (
    (action_kind in ('correction_reversal_reinstatement', 'orphan_reversal_reinstatement')
      and reinstates_journal_entry_id is not null)
    or (action_kind not in ('correction_reversal_reinstatement', 'orphan_reversal_reinstatement')
      and reinstates_journal_entry_id is null)
  )
);
create index reconciliation_action_links_org_idx on public.reconciliation_action_links(org_id);
create index reconciliation_action_links_batch_idx on public.reconciliation_action_links(batch_id);
-- design-required lookup index (§2.6, §13B): "index on (batch_id) and (target_table, target_id)".
create index reconciliation_action_links_target_idx
  on public.reconciliation_action_links(target_table, target_id);
-- covering indexes for the composite tenant FKs (leading columns match FK column order).
create index reconciliation_action_links_batch_tenant_idx
  on public.reconciliation_action_links(batch_id, org_id);
create index reconciliation_action_links_batch_row_tenant_idx
  on public.reconciliation_action_links(batch_row_id, org_id);
-- covering indexes for the remaining single-column FKs into the pre-existing, unaltered journal_entries
-- (#229(b) invariant — every FK, including a plain single-column one, needs its own covering index).
create index reconciliation_action_links_journal_entry_idx
  on public.reconciliation_action_links(journal_entry_id);
create index reconciliation_action_links_reinstates_journal_entry_idx
  on public.reconciliation_action_links(reinstates_journal_entry_id);

-- tenant guard for the polymorphic target_id (no FK is possible — see POLYMORPHIC TARGET above) and the
-- two optional references into journal_entries, which this migration does not alter (equivalent to
-- fn_guard_reconciliation_batch_row_tenant() in slice 1A).
create or replace function public.fn_guard_reconciliation_action_link_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_row_batch_id     uuid;
  v_batch_row_target_table text;
begin
  -- Codex review round 2, item 4: the two composite FKs alone allow batch_id from one batch and
  -- batch_row_id from an unrelated same-org batch — batch_row_id must actually belong to batch_id.
  select batch_id, target_table into v_batch_row_batch_id, v_batch_row_target_table
    from public.reconciliation_batch_rows
   where id = new.batch_row_id and org_id = new.org_id;

  if v_batch_row_batch_id is null or v_batch_row_batch_id is distinct from new.batch_id then
    raise exception 'reconciliation_action_links: batch_row_id does not belong to batch_id in this organization'
      using errcode = '23514';
  end if;

  -- a populated target_table must agree with the batch row's own reviewed target_table — fail closed
  -- (reject) rather than silently accept a target domain the reviewer never actually decided on.
  if new.target_table is not null
    and (v_batch_row_target_table is null or v_batch_row_target_table is distinct from new.target_table)
  then
    raise exception
      'reconciliation_action_links: target_table does not agree with the batch row''s reviewed target_table'
      using errcode = '23514';
  end if;

  if new.target_table = 'expenses' and not exists (
    select 1 from public.expenses e where e.id = new.target_id and e.org_id = new.org_id
  ) then
    raise exception 'reconciliation_action_links: target_id does not name an expenses row in this organization'
      using errcode = '23514';
  end if;
  if new.target_table = 'sales' and not exists (
    select 1 from public.sales s where s.id = new.target_id and s.org_id = new.org_id
  ) then
    raise exception 'reconciliation_action_links: target_id does not name a sales row in this organization'
      using errcode = '23514';
  end if;
  if new.journal_entry_id is not null and not exists (
    select 1 from public.journal_entries je where je.id = new.journal_entry_id and je.org_id = new.org_id
  ) then
    raise exception 'reconciliation_action_links: journal_entry_id belongs to another organization'
      using errcode = '23514';
  end if;
  if new.reinstates_journal_entry_id is not null and not exists (
    select 1 from public.journal_entries je where je.id = new.reinstates_journal_entry_id and je.org_id = new.org_id
  ) then
    raise exception 'reconciliation_action_links: reinstates_journal_entry_id belongs to another organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_guard_reconciliation_action_link_tenant() from public, anon, authenticated;
create trigger guard_reconciliation_action_link_tenant
  before insert or update on public.reconciliation_action_links
  for each row execute function public.fn_guard_reconciliation_action_link_tenant();

-- ── 3) reconciliation_baselines — preflight count/sum/hash-set summary, one row per execution attempt
--    (§7 preflight). ─────────────────────────────────────────────────────────────────────────────────
create table public.reconciliation_baselines (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organization(id) on delete cascade,
  batch_id                uuid not null,
  expenses_count          integer not null default 0 check (expenses_count >= 0),
  expenses_total          numeric not null default 0,
  sales_count             integer not null default 0 check (sales_count >= 0),
  sales_total             numeric not null default 0,
  journal_entries_count   integer not null default 0 check (journal_entries_count >= 0),
  row_hash_set            jsonb not null default '[]'::jsonb,
  journal_hash_set        jsonb not null default '[]'::jsonb,
  captured_at             timestamptz not null default now(),
  constraint reconciliation_baselines_batch_tenant_fk
    foreign key (batch_id, org_id) references public.reconciliation_batches(id, org_id)
);
create index reconciliation_baselines_org_idx on public.reconciliation_baselines(org_id);
create index reconciliation_baselines_batch_tenant_idx on public.reconciliation_baselines(batch_id, org_id);

-- ── 4) reconciliation_baseline_journal_headers — immutable typed snapshot of a target journal entry,
--    captured at preflight (§2.8, §7). ──────────────────────────────────────────────────────────────────
create table public.reconciliation_baseline_journal_headers (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references public.organization(id) on delete cascade,
  batch_id                    uuid not null,
  original_journal_entry_id   uuid not null references public.journal_entries(id),
  entry_date                  date not null,
  source_type                  text not null
    check (source_type in ('expense','sale')),
  source_id                    uuid not null,
  source_sequence               integer not null,
  description                   text,
  status                        text not null check (status in ('posted','reversed')),
  posted_at                     timestamptz not null,
  posted_by                     uuid,
  reversal_of                   uuid references public.journal_entries(id),
  canonical_hash                text not null check (canonical_hash ~ '^[0-9a-f]{64}$'),
  captured_at                   timestamptz not null default now(),
  constraint reconciliation_baseline_journal_headers_id_org_id_uq unique (id, org_id),
  constraint reconciliation_baseline_journal_headers_batch_tenant_fk
    foreign key (batch_id, org_id) references public.reconciliation_batches(id, org_id),
  -- one typed snapshot per source journal entry per batch (Codex review round 2, item 2).
  constraint reconciliation_baseline_journal_headers_batch_entry_uq
    unique (batch_id, original_journal_entry_id)
);
create index reconciliation_baseline_journal_headers_batch_idx
  on public.reconciliation_baseline_journal_headers(batch_id);
create index reconciliation_baseline_journal_headers_batch_tenant_idx
  on public.reconciliation_baseline_journal_headers(batch_id, org_id);
-- covering indexes for every single-column FK on this table (#229(b) invariant), including org_id's own
-- FK to organization(id) and the plain journal_entries references this migration does not alter.
create index reconciliation_baseline_journal_headers_org_idx
  on public.reconciliation_baseline_journal_headers(org_id);
create index reconciliation_baseline_journal_headers_entry_idx
  on public.reconciliation_baseline_journal_headers(original_journal_entry_id);
create index reconciliation_baseline_journal_headers_reversal_of_idx
  on public.reconciliation_baseline_journal_headers(reversal_of);

-- ── 5) reconciliation_baseline_journal_lines — immutable typed snapshot of the header's lines (§2.8). ──
create table public.reconciliation_baseline_journal_lines (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references public.organization(id) on delete cascade,
  baseline_journal_header_id  uuid not null,
  original_journal_line_id    uuid not null references public.journal_lines(id),
  line_ordinal                 integer not null check (line_ordinal >= 1),
  account_id                   uuid not null references public.accounts(id),
  debit                         numeric not null default 0 check (debit >= 0),
  credit                        numeric not null default 0 check (credit >= 0),
  description                   text,
  cost_center_id                uuid references public.cost_centers(id),
  custody_account_id            uuid references public.custody_accounts(id),
  custody_movement_id           uuid references public.custody_movements(id),
  expense_id                    uuid references public.expenses(id),
  payment_request_id            uuid references public.payment_requests(id),
  canonical_hash                text not null check (canonical_hash ~ '^[0-9a-f]{64}$'),
  constraint reconciliation_baseline_journal_lines_one_side check ((debit > 0) <> (credit > 0)),
  constraint reconciliation_baseline_journal_lines_header_tenant_fk
    foreign key (baseline_journal_header_id, org_id)
    references public.reconciliation_baseline_journal_headers(id, org_id),
  -- one typed snapshot per source journal line per header, and one line per ordinal position per header
  -- (Codex review round 2, item 2).
  constraint reconciliation_baseline_journal_lines_header_line_uq
    unique (baseline_journal_header_id, original_journal_line_id),
  constraint reconciliation_baseline_journal_lines_header_ordinal_uq
    unique (baseline_journal_header_id, line_ordinal)
);
create index reconciliation_baseline_journal_lines_header_idx
  on public.reconciliation_baseline_journal_lines(baseline_journal_header_id);
create index reconciliation_baseline_journal_lines_header_tenant_idx
  on public.reconciliation_baseline_journal_lines(baseline_journal_header_id, org_id);
-- covering indexes for every single-column FK on this table (#229(b) invariant): org_id's own FK to
-- organization(id), plus the plain journal_lines/accounts/cost_centers/custody_accounts/
-- custody_movements/expenses/payment_requests references this migration does not alter.
create index reconciliation_baseline_journal_lines_org_idx
  on public.reconciliation_baseline_journal_lines(org_id);
create index reconciliation_baseline_journal_lines_original_line_idx
  on public.reconciliation_baseline_journal_lines(original_journal_line_id);
create index reconciliation_baseline_journal_lines_account_idx
  on public.reconciliation_baseline_journal_lines(account_id);
create index reconciliation_baseline_journal_lines_cost_center_idx
  on public.reconciliation_baseline_journal_lines(cost_center_id);
create index reconciliation_baseline_journal_lines_custody_account_idx
  on public.reconciliation_baseline_journal_lines(custody_account_id);
create index reconciliation_baseline_journal_lines_custody_movement_idx
  on public.reconciliation_baseline_journal_lines(custody_movement_id);
create index reconciliation_baseline_journal_lines_expense_idx
  on public.reconciliation_baseline_journal_lines(expense_id);
create index reconciliation_baseline_journal_lines_payment_request_idx
  on public.reconciliation_baseline_journal_lines(payment_request_id);

-- ── 6) immutability, enforced through privileged application paths (not merely a withheld grant),
--    mirroring the frozen-row hardening trigger shape (20260726083000). Neither table has a
--    bookkeeping-column carve-out: every column is provenance, so ANY update or delete is rejected,
--    from any role including the table owner. The INSERT branch additionally carries the tenant guard
--    for the optional pre-existing, unaltered journal_entries/journal_lines references (equivalent to
--    fn_guard_reconciliation_batch_row_tenant() in slice 1A), plus — for lines only — the check no FK
--    can express: the referenced original journal line must actually belong to the same journal entry
--    the header claims to snapshot. ──────────────────────────────────────────────────────────────────────
create or replace function public.fn_guard_baseline_journal_header_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.journal_entries%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'reconciliation_baseline_journal_headers: rows are immutable and cannot be deleted'
      using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'reconciliation_baseline_journal_headers: rows are immutable and cannot be updated'
      using errcode = '22023';
  end if;

  select * into v_src from public.journal_entries je where je.id = new.original_journal_entry_id;

  if v_src.id is null or v_src.org_id is distinct from new.org_id then
    raise exception
      'reconciliation_baseline_journal_headers: original_journal_entry_id belongs to another organization'
      using errcode = '23514';
  end if;

  -- Codex review round 2, item 1: a snapshot row is only trustworthy for reinstatement (§8) if every
  -- copied typed column is a byte-exact copy of the real journal entry at capture time — never a
  -- best-effort or partially-stale mirror.
  if v_src.entry_date is distinct from new.entry_date
    or v_src.source_type is distinct from new.source_type
    or v_src.source_id is distinct from new.source_id
    or v_src.source_sequence is distinct from new.source_sequence
    or v_src.description is distinct from new.description
    or v_src.status is distinct from new.status
    or v_src.posted_at is distinct from new.posted_at
    or v_src.posted_by is distinct from new.posted_by
    or v_src.reversal_of is distinct from new.reversal_of
  then
    raise exception
      'reconciliation_baseline_journal_headers: snapshot columns are not a verbatim copy of the original journal entry'
      using errcode = '23514';
  end if;

  -- fail-closed even if the source journal_entries row's own reversal_of already points cross-org (a
  -- pre-existing data-quality bug must not be allowed to propagate into a new snapshot row).
  if new.reversal_of is not null and not exists (
    select 1 from public.journal_entries je where je.id = new.reversal_of and je.org_id = new.org_id
  ) then
    raise exception 'reconciliation_baseline_journal_headers: reversal_of belongs to another organization'
      using errcode = '23514';
  end if;
  if new.source_type = 'expense' and not exists (
    select 1 from public.expenses e where e.id = new.source_id and e.org_id = new.org_id
  ) then
    raise exception
      'reconciliation_baseline_journal_headers: source_id does not name an expense in this organization'
      using errcode = '23514';
  end if;
  if new.source_type = 'sale' and not exists (
    select 1 from public.sales s where s.id = new.source_id and s.org_id = new.org_id
  ) then
    raise exception
      'reconciliation_baseline_journal_headers: source_id does not name a sale in this organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_guard_baseline_journal_header_immutable() from public, anon, authenticated;
create trigger guard_baseline_journal_header_immutable
  before insert or update or delete on public.reconciliation_baseline_journal_headers
  for each row execute function public.fn_guard_baseline_journal_header_immutable();

create or replace function public.fn_guard_baseline_journal_line_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_header_journal_entry_id  uuid;
  v_src                      public.journal_lines%rowtype;
  v_dim_org                  uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'reconciliation_baseline_journal_lines: rows are immutable and cannot be deleted'
      using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'reconciliation_baseline_journal_lines: rows are immutable and cannot be updated'
      using errcode = '22023';
  end if;

  select original_journal_entry_id into v_header_journal_entry_id
    from public.reconciliation_baseline_journal_headers
   where id = new.baseline_journal_header_id;

  select * into v_src from public.journal_lines jl where jl.id = new.original_journal_line_id;

  if v_src.id is null or v_src.org_id is distinct from new.org_id then
    raise exception 'reconciliation_baseline_journal_lines: original_journal_line_id belongs to another organization'
      using errcode = '23514';
  end if;
  if v_src.journal_entry_id is distinct from v_header_journal_entry_id then
    raise exception
      'reconciliation_baseline_journal_lines: original_journal_line_id does not belong to the header''s original_journal_entry_id'
      using errcode = '23514';
  end if;

  -- Codex review round 2, item 1: every copied typed column must be a byte-exact copy of the real
  -- journal line at capture time.
  if v_src.account_id is distinct from new.account_id
    or v_src.debit is distinct from new.debit
    or v_src.credit is distinct from new.credit
    or v_src.description is distinct from new.description
    or v_src.cost_center_id is distinct from new.cost_center_id
    or v_src.custody_account_id is distinct from new.custody_account_id
    or v_src.custody_movement_id is distinct from new.custody_movement_id
    or v_src.expense_id is distinct from new.expense_id
    or v_src.payment_request_id is distinct from new.payment_request_id
  then
    raise exception
      'reconciliation_baseline_journal_lines: snapshot columns are not a verbatim copy of the original journal line'
      using errcode = '23514';
  end if;

  -- fail-closed independently for each optional dimension, even if the source journal_lines row's own
  -- bytes are already bad (e.g. a legacy cross-org reference) — never trust the copy-source alone.
  if new.account_id is not null then
    select org_id into v_dim_org from public.accounts where id = new.account_id;
    if v_dim_org is distinct from new.org_id then
      raise exception 'reconciliation_baseline_journal_lines: account_id belongs to another organization'
        using errcode = '23514';
    end if;
  end if;
  if new.cost_center_id is not null then
    select org_id into v_dim_org from public.cost_centers where id = new.cost_center_id;
    if v_dim_org is distinct from new.org_id then
      raise exception 'reconciliation_baseline_journal_lines: cost_center_id belongs to another organization'
        using errcode = '23514';
    end if;
  end if;
  if new.custody_account_id is not null then
    select org_id into v_dim_org from public.custody_accounts where id = new.custody_account_id;
    if v_dim_org is distinct from new.org_id then
      raise exception 'reconciliation_baseline_journal_lines: custody_account_id belongs to another organization'
        using errcode = '23514';
    end if;
  end if;
  if new.custody_movement_id is not null then
    select org_id into v_dim_org from public.custody_movements where id = new.custody_movement_id;
    if v_dim_org is distinct from new.org_id then
      raise exception 'reconciliation_baseline_journal_lines: custody_movement_id belongs to another organization'
        using errcode = '23514';
    end if;
  end if;
  if new.expense_id is not null then
    select org_id into v_dim_org from public.expenses where id = new.expense_id;
    if v_dim_org is distinct from new.org_id then
      raise exception 'reconciliation_baseline_journal_lines: expense_id belongs to another organization'
        using errcode = '23514';
    end if;
  end if;
  if new.payment_request_id is not null then
    select org_id into v_dim_org from public.payment_requests where id = new.payment_request_id;
    if v_dim_org is distinct from new.org_id then
      raise exception 'reconciliation_baseline_journal_lines: payment_request_id belongs to another organization'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
revoke execute on function public.fn_guard_baseline_journal_line_immutable() from public, anon, authenticated;
create trigger guard_baseline_journal_line_immutable
  before insert or update or delete on public.reconciliation_baseline_journal_lines
  for each row execute function public.fn_guard_baseline_journal_line_immutable();

-- ── 7) RLS + FORCE RLS on all five tables (§9 item 1B, §13B). Reads gated on the same PR #902
--    finance-read organization-set helper slice 1A used. No client insert/update/delete grant on any
--    of the five tables — deny-by-default; no execution/rollback RPC exists yet in this slice. ─────────
alter table public.reconciliation_execution_ledger enable row level security;
alter table public.reconciliation_execution_ledger force row level security;
create policy tenant_read on public.reconciliation_execution_ledger for select to authenticated
  using (org_id in (select private.finance_read_org_ids()));
grant select on public.reconciliation_execution_ledger to authenticated;

alter table public.reconciliation_action_links enable row level security;
alter table public.reconciliation_action_links force row level security;
create policy tenant_read on public.reconciliation_action_links for select to authenticated
  using (org_id in (select private.finance_read_org_ids()));
grant select on public.reconciliation_action_links to authenticated;

alter table public.reconciliation_baselines enable row level security;
alter table public.reconciliation_baselines force row level security;
create policy tenant_read on public.reconciliation_baselines for select to authenticated
  using (org_id in (select private.finance_read_org_ids()));
grant select on public.reconciliation_baselines to authenticated;

alter table public.reconciliation_baseline_journal_headers enable row level security;
alter table public.reconciliation_baseline_journal_headers force row level security;
create policy tenant_read on public.reconciliation_baseline_journal_headers for select to authenticated
  using (org_id in (select private.finance_read_org_ids()));
grant select on public.reconciliation_baseline_journal_headers to authenticated;

alter table public.reconciliation_baseline_journal_lines enable row level security;
alter table public.reconciliation_baseline_journal_lines force row level security;
create policy tenant_read on public.reconciliation_baseline_journal_lines for select to authenticated
  using (org_id in (select private.finance_read_org_ids()));
grant select on public.reconciliation_baseline_journal_lines to authenticated;

-- ── 8) additive expenses/sales columns (§6, §8). No grant is added on either table beyond its existing
--    RPC-only write path: `authenticated`'s column-level expenses grant (20260629150000) is an explicit
--    column list that does not name these new columns, and `sales` already carries a blanket
--    `revoke insert, update, delete ... from authenticated, anon` (20260701500000) with all writes going
--    through fn_save_sale/fn_finalize_sale_price/fn_record_sale_collection. Both new columns are
--    therefore writable only by a future SECURITY DEFINER RPC (slice 4/5/7), never by direct client DML.
alter table public.expenses add column if not exists corrects_expense_id uuid;
alter table public.expenses drop constraint if exists expenses_corrects_expense_id_not_self;
alter table public.expenses add constraint expenses_corrects_expense_id_not_self
  check (corrects_expense_id is null or corrects_expense_id <> id);
alter table public.expenses drop constraint if exists expenses_corrects_expense_id_org_fk;
alter table public.expenses add constraint expenses_corrects_expense_id_org_fk
  foreign key (corrects_expense_id, org_id) references public.expenses(id, org_id);
alter table public.expenses add column if not exists reversed_by_rollback_at timestamptz;
create index if not exists expenses_corrects_expense_tenant_idx on public.expenses(corrects_expense_id, org_id);

alter table public.sales add column if not exists corrects_sale_id uuid;
alter table public.sales drop constraint if exists sales_corrects_sale_id_not_self;
alter table public.sales add constraint sales_corrects_sale_id_not_self
  check (corrects_sale_id is null or corrects_sale_id <> id);
alter table public.sales drop constraint if exists sales_corrects_sale_id_org_fk;
alter table public.sales add constraint sales_corrects_sale_id_org_fk
  foreign key (corrects_sale_id, org_id) references public.sales(id, org_id);
alter table public.sales add column if not exists reversed_by_rollback_at timestamptz;
create index if not exists sales_corrects_sale_tenant_idx on public.sales(corrects_sale_id, org_id);

-- ── 9) comments (required by the design's documentation discipline, §2.5-2.8). ──────────────────────
comment on table public.reconciliation_execution_ledger is
  'Slice 1B (§2.5): global, per-evidence-item execution state. A partial unique index guarantees at '
  'most one executed row per evidence_item_id at any time, independent of how many batches re-review '
  'the same evidence item across separate attempts.';
comment on table public.reconciliation_action_links is
  'Slice 1B (§2.6, §8): one row per action actually taken inside an execution/rollback transaction. '
  'Postflight and rollback join exclusively through this table, never through created_at/audit-'
  'timestamp windows.';
comment on table public.reconciliation_baselines is
  'Slice 1B (§7 preflight): one row per execution attempt — the count/sum/hash-set baseline snapshot '
  'used to detect any drift between preflight and postflight.';
comment on table public.reconciliation_baseline_journal_headers is
  'Slice 1B (§2.8): immutable typed snapshot of a target journal entry, captured before execution. '
  'Reinstatement (§8) reads these rows directly to reproduce a reversed entry''s exact posting; a '
  'sha256 digest alone cannot be reversed back into postable data.';
comment on table public.reconciliation_baseline_journal_lines is
  'Slice 1B (§2.8): immutable typed snapshot of a baseline journal header''s lines, one row per '
  'original journal line, captured before execution.';
comment on column public.reconciliation_execution_ledger.status is
  'unexecuted | executed | reversed. At most one executed row may exist per evidence_item_id '
  '(partial unique index reconciliation_execution_ledger_executed_uq).';
comment on column public.reconciliation_action_links.action_kind is
  'addition | correction_reversal | correction_replacement | correction_reversal_reinstatement | '
  'orphan_reversal | orphan_reversal_reinstatement | zero_value_noop (§6, §8).';
comment on column public.reconciliation_action_links.reinstates_journal_entry_id is
  'Only populated for the two reinstatement action kinds (§8); points back at the now-reversed entry '
  'this new posting reinstates.';
comment on column public.expenses.corrects_expense_id is
  'Slice 1B (§6): additive, nullable. Set on the NEW replacement expense row created for an '
  'amount_correction_candidate; the original row is never edited.';
comment on column public.expenses.reversed_by_rollback_at is
  'Slice 1B (§8): additive, nullable. Set by a future fn_rollback_reconciliation_batch when this row''s '
  'journal is reversed as part of a reconciliation batch rollback.';
comment on column public.sales.corrects_sale_id is
  'Slice 1B (§6): additive, nullable. Set on the NEW replacement sale row created for an '
  'amount_correction_candidate; the original row is never edited.';
comment on column public.sales.reversed_by_rollback_at is
  'Slice 1B (§8): additive, nullable. Set by a future fn_rollback_reconciliation_batch when this row''s '
  'journal is reversed as part of a reconciliation batch rollback.';

commit;
