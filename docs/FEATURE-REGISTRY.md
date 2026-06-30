# Feature Registry — Farm OS

*Tier 1 of the Product Knowledge System ([`SPEC-0015`](SPEC-0015-product-knowledge-system.md)). The traceability
spine: every feature has a stable `FEAT-NNN` id that business rules, pages, specs, and tests reference. **Reconciled
to `main` 2026-06-27.** Maturity: **L3** (human-written + verified against `main`). IDs are stable and append-only —
never renumber; mark deprecated instead.*

Status: ✅ Built (on `main`) · 🟡 Partial · 🧪 Draft PR (not on `main`) · ⬜ Planned.
Evidence keys: mig = `apps/farm-os/supabase/migrations/`; route = `apps/farm-os/app/(app)/`; lib/component =
`apps/farm-os/lib` · `/components`; test = `apps/farm-os/supabase/tests` (pgTAP) or Vitest `*.test.ts`.

| FEAT | Feature | Status | Routes | Key RPCs / migrations | Lib / components | Tests | Spec |
|---|---|---|---|---|---|---|---|
| **FEAT-001** | Multi-tenant foundation (org, membership, active-org, settings) | ✅ | `/settings` | `0001` org+member; `0085` active_org; `0086` settings; `user_org_ids`, `fn_set_active_org`, `fn_update_org_settings` | `lib/auth.ts`, `lib/org-actions.ts`, `OrgSwitcher.tsx`, `SettingsForm.tsx` | `01_rls_isolation`, `82_active_org` | SPEC-0012 |
| **FEAT-002** | RBAC & permissions | ✅ | (all) | `0035` `authorize`; role-gates `0042`–`0044`/`0049`/`0066`–`0069` | `lib/auth.ts` (Role, ROLE_LABEL_AR) | `22_security_invariants`, `26_operation_tables_authz` | SPEC-0002 (draft) |
| **FEAT-003** | Farm structure (sector/hawsha/line/palm) | ✅ | `/farm`, `/farm/sector/[id]`, `/farm/hawsha/[id]`, `/farm/line/[id]`, `/farm/croquis` | `0003`/`0080`/`0081`; `fn_save_sector/hawsha/line`, `fn_archive_structure` | `StructureForm.tsx`, `SectorFile.tsx`, `FarmCroquis.tsx`, `lib/croquis.ts` | `82_structure_crud` | SPEC-0003 |
| **FEAT-004** | Palm registry & status | ✅ (import = Stage M) | `/farm/palm/[id]` | `0039` `fn_update_palm_status`; `0073` history write-gate; `0089` archived-hawsha guard | `PalmStatusForm.tsx` | `73_palm_history_write_gate`, `89_palm_no_archived_hawsha` | SPEC-0003 |
| **FEAT-005** | Planning workspace | ✅ (templates ⬜) | `/plans`, `/plans/[planId]` | `0006`/`0084`; `fn_create_plan`, `fn_add_plan_operation`, `fn_add_plan_labor`, `fn_assign_plan_operation`, `fn_set_plan_status` | `PlanCreateForm.tsx`, `OperationBuilder.tsx`, `PlanChecksRunner.tsx` | `54_plan_op_nonneg`, `58_plan_op_status` | SPEC-0011 |
| **FEAT-006** | Inventory & append-only ledger | ✅ | `/inventory` | `0005`; `fn_post_movement` (`0011`/`0031`/`0033`); ledger locks `0016`/`0022`/`0030` | `lib/stock-calc.ts` | `07_post_movement`, `11_inventory_ledger_append_only`, `20_inventory_ledger_no_update` | SPEC-0001 |
| **FEAT-007** | Stock-coverage engine (the wedge) | ✅ | `/inventory/[itemId]/coverage` | `0009` `fn_stock_coverage`; `0018`/`0034`/`0047`/`0055` engine fixes | `lib/stock-calc.ts`, `charts.tsx` | `04_stock_coverage`, `34_engine_stale_po_guard` | SPEC-0001 |
| **FEAT-008** | Budget gate | ✅ | `/budget/[planId]/check`, `/budgets` | `0007`; `0043` budget role-gate | — | `43_budget_rolegate` | SPEC-0004 (draft) |
| **FEAT-009** | Purchase requests & approvals (SoD) | 🟡 (PO/quote/invoice ⬜) | `/purchase-requests`, `/purchase-requests/[prId]` | `0007`; `pr_guard_approval` `0017`/`0023`; `0032` line-freeze; `0052` revert SoD | `CreatePrButton.tsx`, `PrActions.tsx` | `12_pr_approval_sod_guard`, `52_pr_revert_sod_guard` | SPEC-0006 |
| **FEAT-010** | Goods receipt (partial) | ✅ | `/purchase-requests/[prId]` | `fn_post_receipt` `0024`/`0045`; `0050`/`0051` status | `ReceiveForm.tsx` | `15_receipt_idempotent_claim`, `23_post_receipt_atomic` | SPEC-0009 |
| **FEAT-011** | Farm events / operations ledger | ✅ | (via `RecordActivity`) | `0004` partitioned `farm_event`; `0083` `fn_record_event`, `fn_set_event_status`, `fn_add_event_followup`; `0025` op-table gate | `RecordActivity.tsx`, `lib/labels.ts` | `26_operation_tables_authz`, `83_record_event` | SPEC-0010 |
| **FEAT-012** | Operation execution (idempotent) | ✅ | `/m/execute/[opId]` | `0020`/`0057` `fn_execute_operation` | `ExecuteForm.tsx` | `13_execute_idempotent_claim`, `18_execute_operation_rpc` | SPEC-0010 |
| **FEAT-013** | Expenses & cost (opex vs drawings) | ✅ | `/expenses` | `0007`; `0044` expenses role-gate; `expenses.kind` | `AddExpense.tsx`, `lib/money.ts` | `44_expenses_rolegate` | SPEC-0004 (draft) |
| **FEAT-014** | Planned-vs-actual reporting | ✅ | `/reports/[planId]/pva` | (reads `plan_operations` + done `farm_event` actuals) | `charts.tsx` (`VarianceChart`) | — | SPEC-0004 (draft) |
| **FEAT-015** | Attachments & media | ✅ (OCR ⬜) | (via `MediaGallery`) | `0082` `fn_add_attachment`, `fn_archive_attachment`; `farm-media` bucket + `storage-policies.sql` | `MediaGallery.tsx` | (storage RLS) | SPEC-0009 |
| **FEAT-016** | Weather & advisory gates | ✅ (needs API key) | `/weather` | (server fetch) | `lib/weather.ts`, `lib/weather-server.ts`, `WeatherCard.tsx` | `weather.test.ts` | SPEC-0007 |
| **FEAT-017** | Mobile field mode | ✅ (true offline ⬜) | `/m`, `/m/execute/[opId]` | — | (uses FEAT-012) | — | SPEC-0012 (S1/S4) |
| **FEAT-018** | Reports & dashboards | ✅ (export 🟡) | `/dashboard`, `/dashboard/owner`, `/dashboard/manager` | (RLS reads) | `FilterableTable.tsx`, `lib/filter.ts`, `charts.tsx` | `filter.test.ts` | — |
| **FEAT-019** | People directory (PII-locked) | ✅ | `/people` | `0002` people; `0048` contact-PII lockdown; `0071`/`0074` org guards | — | `72_people_reports_to_same_org` | SPEC-0006 |
| **FEAT-020** | Audit logging (immutable) | ✅ | — | `0008` `fn_audit`; `0019` org-member; `0053` payroll gate; `0059`/`0060` coverage+redaction | — | `02_audit_immutable`, `25_audit_immutable_all_entities` | — |
| **FEAT-021** | AI assistant boundary (عبدالجليل) | 🟡 (AI itself ⬜, Stage 11) | — | — | `lib/assistant-policy.ts` | `assistant-policy.test.ts` | SPEC-0005 |
| **FEAT-022** | Payroll engine | 🟡 (runs/attendance ⬜) | — | `0046` people_compensation; `0053` payroll audit gate | `lib/payroll.ts` | `payroll.test.ts`, `53_audit_compensation_payroll_gate` | SPEC-0006 |
| **FEAT-023** | Accounting P&L + sales | 🧪 (draft PR #368, mig `0088` + `0097`) | (`/accounting` not on `main`) | `fn_save_sale`, `fn_set_expense_kind`, `fn_accounting_pnl_summary` (draft) | `lib/pnl.ts`, `AccountingView` (draft) | `88_accounting_pnl`, `lib/pnl.test.ts` (draft) | SPEC-0004 |
| **FEAT-024** | Care Academy content | 🧪 (draft PR #366, mig `0087`) | (`/academy` not on `main`) | (draft) | `lib/academy.ts` (draft) | (draft) | SPEC-0008 |
| **FEAT-025** | Member admin & invite | ⬜ | (`/members` planned) | mig `0090` planned | — | — | SPEC-0012 S2 |
| **FEAT-026** | Knowledge / help system | ⬜ | (in-app help planned) | — | `lib/nav.ts`, `lib/errors.ts` (substrate) | — | SPEC-0014 |
| **FEAT-027** | Commercial SaaS layer | ⬜ | (onboarding/admin planned) | — | — | — | SPEC-0013 |

**Maintenance:** when a feature ships, update its row + flip status; add the FEAT-id to the relevant
`BR-NNN` rows and `pageMeta`. New feature → next free `FEAT-NNN` (registry is append-only).
