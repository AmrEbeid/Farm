# 0002 — Append-only inventory ledger

- **Status:** Accepted — 2026-06-22
- **Implementation:**
  - `apps/farm-os/supabase/migrations/20260622000015_inventory_write_rolegate.sql`
  - `apps/farm-os/supabase/migrations/20260622000016_inventory_ledger_append_only.sql`
  - `apps/farm-os/supabase/migrations/20260622000022_inventory_ledger_no_update.sql`
  - Primitive: `..._20260622000011_fn_post_movement.sql`

## Context

`inventory_movements` and `inventory_bin` started with an org-only `tenant_all` policy and
the blanket grants from migration 0009. That left three holes by which any authenticated
org member could forge or erase stock directly via `/rest/v1/...`, bypassing the app:

- **INSERT/UPDATE (B2):** the org-only policy let any member POST forged movements.
- **DELETE (B2 follow-up):** a `FOR ALL` policy governs DELETE by `USING` alone (no
  `WITH CHECK`), so the role gate never applied — a `supervisor` who lacks `inventory.write`
  was confirmed to delete an entire org's movements in one statement.
- **UPDATE (B2.1):** even after the DELETE revoke, UPDATE was still granted, so an
  `inventory.write` role could `UPDATE inventory_movements SET qty=…` and rewrite history.

All legitimate app stock writes already go through `fn_post_movement` — a `SECURITY DEFINER`
(`bypassrls`, owner `postgres`) primitive that appends to the ledger and recomputes
`on_hand` from the ledger via `fn_bin_rebuild`, so it is lost-update-safe and always
reconciled (migration 0011). The client never needs to mutate these tables in place;
corrections are compensating movements (new INSERTs).

## Decision

Make both stock tables append-only for every client role, layered:

- **0015** — replace `tenant_all` with a policy whose `WITH CHECK` requires
  `authorize('inventory.write')`, gating INSERT (reads stay open to the org via `USING`).
- **0016** — `REVOKE DELETE … FROM authenticated, anon` on both tables.
- **0022** — `REVOKE UPDATE … FROM authenticated, anon` on both tables.

Using `REVOKE` (not just policy tweaks) makes the deny robust: even a future permissive
policy cannot re-open DELETE/UPDATE because the privilege itself is gone. `service_role`
(e2e cleanup) and the table owner keep their grants.

## Consequences

- **Positive:** rows can be added by `inventory.write` roles but never mutated or removed by
  any client — the ledger is genuinely append-only, like `audit_log`. The SC-6 invariant
  (`on_hand = Σ(movements)`) the coverage engine trusts cannot be silently broken. Reads
  stay open to every role, so dashboards and the engine keep working. Pinned by pgTAP
  `tests/10`, `tests/11`, `tests/20`.
- **Negative / trade-offs:** any future legitimate need to edit a movement must be modeled
  as a compensating movement, not an in-place edit. Bulk corrections are heavier than a
  single UPDATE.
