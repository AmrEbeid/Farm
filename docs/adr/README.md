# Architecture Decision Records

Decisions behind the Farm OS application (`apps/farm-os`) and the monorepo as a whole.
Each record captures one decision already implemented in the code/migrations, grounded
in the actual source — cite the file when you read one.

ADRs for the `@amrebeid/ui` package live separately under `packages/ui/docs/adr/`.

## Format

Each ADR is a numbered file (`NNNN-short-slug.md`) using the standard template:

- **Title** — `NNNN — short statement of the decision`
- **Status** — Accepted / Superseded / Deprecated, with a date
- **Context** — the forces and the problem
- **Decision** — what we decided
- **Consequences** — the resulting trade-offs (positive and negative)

Records are append-only: to change a decision, add a new ADR that supersedes the old one
and flip the old one's Status to `Superseded by NNNN`.

## Index

- [0001 — AUTHZ-1 via an atomic `fn_execute_operation` RPC](0001-authz1-execute-operation-rpc.md) — server-side `op.execute` gate, atomicity, idempotency (SPEC-0002 Option A).
- [0002 — Append-only inventory ledger](0002-append-only-inventory-ledger.md) — revoke client UPDATE/DELETE; writes only via `fn_post_movement`.
- [0003 — SECURITY DEFINER grant lockdown on Supabase](0003-definer-grant-lockdown.md) — claw back the default anon/authenticated EXECUTE grant; pin with invariant oracles.
- [0004 — ENGINE-DC: scheduled receipts from open purchase requests](0004-scheduled-receipts-from-purchase-requests.md) — project open POs, not the movement ledger, to kill the receipt double-count.
- [0005 — Recharts tree-shaken via an `@amrebeid/ui/charts` subpath](0005-recharts-charts-subpath.md) — split entry so recharts loads only on chart routes.
- [0006 — SQL migration conventions (idempotency, SECURITY DEFINER hygiene, function lockdown)](0006-sql-migration-conventions.md) — guard object creation and lock down functions so every new migration is independently re-run-safe.
