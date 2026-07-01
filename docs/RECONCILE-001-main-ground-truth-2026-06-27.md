# RECONCILE-001 — Main Ground-Truth Audit (canonical capability map) — 2026-06-27

> ⚠️ **Superseded for current status (2026-07-02):** this audit was pinned to `main` as of 2026-06-27
> (~89 migrations; prod at `0084`). Prod is now at 134 applied migrations after the 2026-07-01 deploy wave.
> It remains a valid historical capability map and rebuttal record; **for "what is live now," use
> [`STATUS.md`](STATUS.md)** and the reconciled catalogs (FEATURE-REGISTRY / RPC-CATALOG / DATA-DICTIONARY).

*The single source of truth for **what is actually implemented in `main`**. Created because an external
product assessment (2026-06-27) diagnosed the build as "drifted into ERP dashboards, core loop missing,
simple roles without org isolation, thin `payment_vouchers`, generic `farm_tasks`." **That diagnosis read
the GitHub product docs but evaluated a stale prototype schema — not `main`.** This audit pins every major
capability to its supporting migrations / RPCs / routes / libraries, with a status and confidence, so future
audits, AI reviews, and external assessments reconcile to verified code, not to legacy documents.*

**Audit type:** read-only. **Risk:** Low. **Nothing was changed.** Method: enumerated `supabase/migrations/`
(89 files, `0001`–`0089`), the `create table` / `create function` set, `app/(app)/` routes, `lib/`, components,
and the test corpus directly from the working tree.

---

## Ground truth (read-only checks, 2026-06-27)
- **Schema spine:** 37 tables, ~38 RPCs across migrations `0001`–`0089`. `organization` + `organization_member`
  exist (`0001`); **`org_id` is on every tenant table**; RLS is deny-by-default `to authenticated`, joined via
  the security-definer helper `public.user_org_ids()` (+ `user_member_org_ids`). Active-org narrowing is a
  membership-validated JWT claim (`0085`), org settings owner-gated (`0086`).
- **Event model:** append-only **partitioned `farm_event`** (`0004`) with `subtype`
  (irrigation\|fertilization\|spraying\|pollination\|…), `event_locations`, `quantities`, `event_status_history`,
  `event_followups`, `event_attachments`; written via `fn_record_event` / `fn_set_event_status` (`0083`).
  **There is no `farm_tasks` table.**
- **Inventory + coverage:** `suppliers`, `inventory_items` (`expiry_tracked`, `unit_cost` `0041`),
  `inventory_bin` (materialized snapshot), `inventory_movements` (`receipt`/`issue`/`return`/`adjustment`/
  `transfer`/`loss`/`expiry`/**`reserve`/`release`**); `fn_stock_coverage` (`0009`, the wedge engine),
  `fn_post_movement` (`0011`, ledger primitive), `fn_reserve_stock`, `fn_post_receipt`. **There is no
  `seedling_inventory` table.**
- **Purchase + approval:** `purchase_requests` + `purchase_request_items` (multi-line) with an explicit
  (non-`FOR ALL`) policy set so the **SoD approval guard** holds (`0017`/`0023`); line-freeze + version bump
  (`0032`); partial receipts (`0045`/`0050`). **There is no `payment_vouchers` table in `main`** (it appears
  only in `docs/03` — see §Doc hygiene).
- **The deployed loop** Plan → Coverage → Budget gate → Approval → Execute → Actual cost → Report is **built and
  live** on prod (`fn_stock_coverage` → `budget_rolegate` `0043` + PR SoD → `fn_execute_operation` `0020` →
  `expenses` → planned-vs-actual at `reports/[planId]/pva`). pgTAP 89 test files; prod DB at `0084`/`0089` (per
  tracker). *(Correction 2026-06-27: the P&L engine `lib/pnl.ts` + `/accounting` are NOT on `main` — draft PR
  #368; the loop's "Report" step on `main` is `/reports/[planId]/pva`. See PRODUCT-MASTER-FILE.md.)*

---

## Capability map (canonical)

Legend: ✅ Built · 🟡 Partial · ⬜ Planned · 🗂 Legacy prototype (migrate-from) · ⚠️ Deprecated/dropped

| Capability | Status | Evidence (migration / route / RPC / lib) | Conf. |
|---|---|---|---|
| Multi-tenant org isolation | ✅ | `0001` org + org_member; `org_id` all tables; `user_org_ids()`; RLS deny-by-default | High |
| Active-org / multi-org-per-user | ✅ | `0085` active_org JWT claim; `OrgSwitcher.tsx`; `fn_set_active_org` | High |
| RBAC (5 roles + accountant) | ✅ | `authorize()` `0035`; `requireRole`; role-gates `0042`–`0044`/`0049`/`0066`–`0069` | High |
| Org settings (owner-gated) | ✅ | `0086`; `fn_update_org_settings`; `/settings` | High |
| Member / role admin **UI** | 🟡 | RLS+roles exist; **no `/members` route or invite** — SPEC-0012 S2 (`0090` pending) | High |
| Audit log (immutable) | ✅ | `audit_log`; `fn_audit*`; `0019` org-member audit; `0059`/`0060` coverage+redaction | High |
| Farm structure (sector/hawsha/line/palm) | ✅ | `0003` assets; `0080`/`0081` soft-delete + write RPCs; `/farm`; `StructureForm.tsx` | High |
| Per-node 360 + palm status history | ✅ | `palm_status_history`; `fn_update_palm_status` `0039`; `/farm/palm/[id]`; `SectorFile.tsx` | High |
| Croquis / farm map | 🟡 | `lib/croquis.ts`; `FarmCroquis.tsx` (PR #364) — no GIS coords/zones/heatmaps | High |
| Event ledger (ops as events) | ✅ | `0004` partitioned `farm_event`; `0083` `fn_record_event`; `RecordActivity.tsx` | High |
| Inventory items + movements + bin | ✅ | `0005`; `inventory_movements` (reserve/release); `inventory_bin` | High |
| **Stock-coverage engine (the wedge)** | ✅ | `0009` `fn_stock_coverage`; `0047` null-date guard; `0055` sizing; `lib/stock-calc.ts`; `/inventory/[itemId]/coverage` | High |
| Reservations | ✅ | `fn_reserve_stock` `0037`; ledger-backed `reserved` (`inventory_bin`) | High |
| Planning workspace | ✅ | `0006` plans; `0084` plan_builder; `fn_create_plan`/`fn_add_plan_operation`; `/plans` | High |
| Plan checks (coverage/budget pre-exec) | ✅ | `plan_checks`; `PlanChecksRunner.tsx`; `lib/stock-calc` | High |
| Budget + budget lines | ✅ | `0007`; `budget_rolegate` `0043`; `/budget` + `/budgets` | High |
| Purchase request workflow | 🟡 | `0007` PR + items; SoD `0017`/`0023`; partial receipts `0045` — **no multi-level approval / PO / quote-compare / invoice-match** | High |
| Goods receipt (partial) | ✅ | `0045`/`0050`/`0051`; `fn_post_receipt`; `ReceiveForm.tsx` | High |
| Operation execution (idempotent) | ✅ | `0020` `fn_execute_operation`; `/m/execute/[opId]`; `ExecuteForm.tsx` | High |
| Accounting / expenses (on `main`) | ✅ | `expenses` `0007` + `expenses.kind` + `/expenses` + role-gate `0044` | High |
| Accounting P&L + sales (`lib/pnl.ts`, `/accounting`) | 🧪 | **NOT on `main`** — draft PR #368 (mig `0088`), synthetic — gated on 7-yr Excel recon + privacy + indep. review *(corrected 2026-06-27: was cited as if present)* | High |
| Planned-vs-actual variance | ✅ | **built** — `reports/[planId]/pva` (`VarianceChart`, planned qty/cost vs done-event actuals) *(corrected 2026-06-27: was wrongly "not built")* | High |
| People / labor / payroll | 🟡 | `people` + `people_compensation` `0046`; PII lockdown `0048`; `lib/payroll.ts` (engine) — **no `labor_logs`/attendance/payroll-run build** | High |
| Weather + advisory gates | 🟡 | `lib/weather.ts`/`weather-server.ts`; `WeatherCard.tsx`; `/weather` (PR #350) — **needs `WEATHER_API_KEY`** | High |
| Care Academy content + sign-off gate | 🟡 | `lib/academy.ts`; `/academy` editor (PR #366, synthetic) — **gated on agronomist + pesticide-registration sign-off** | Med |
| AI assistant عبدالجليل | 🟡 | `lib/assistant-policy.ts` (capability boundary, PR #356) — **chat route/model/ingest NOT built**; review-gated per slice | Med |
| Attachments / photos / docs | ✅ | `0082` attachments + `farm-media` bucket + storage RLS; `event_attachments`; `MediaGallery.tsx` | High |
| OCR on receipts | ⬜ | not built (noted "later" by all parties) | High |
| Mobile field view `/m` | ✅ | `/m`; offline-**tolerant** | High |
| True offline (SW/PWA/queue) | ⬜ | no service worker / manifest / next-pwa — SPEC-0012 S4 | High |
| Reports / dashboard | ✅ | `/dashboard`, `/reports`; `charts.tsx`; `FilterableTable.tsx` | High |
| Profile page | ✅ | `/profile` read-only (PR #376) | High |
| Theme (dark) | ⬜ | dark tokens exist, unwired (`ThemeProvider` pinned light) — SPEC-0012 S5 | High |
| **Commercial SaaS layer** (billing/tiers/limits/signup/onboarding/import wizard/admin console/trials/flags) | ⬜ | **none in schema or app** — `grep` found no `subscription`/`billing`/`plan_tier`/`stripe` — **SPEC-0013** | High |

---

## Stale-schema correction (where the external assessment went wrong)
- `payment_vouchers`, `farm_tasks`, `seedling_inventory` exist **only in `docs/03-architecture-and-data-model.md`**
  — zero hits in any migration or app file. Even there, `payment_vouchers` is specced as a *full* org-scoped
  workflow (`status: draft|submitted|approved|rejected|paid`, `requested_by`, `approved_by`, `pr_id`), not the
  thin "employee/amount/paid" table described.
- **No `lovable` reference exists anywhere in the repo.** The critiqued "Lovable prompt with hardcoded
  constants / `useState`-only / no external DB" is not in `main`.
- "Simple roles `owner`/`accountant`/`manager`/`worker` without org isolation" is **false for `main`** —
  org isolation is enforced in Postgres RLS (`0001`), and the ratified role set is
  `owner` / `farm_manager` / `supervisor` / `storekeeper` / `agri_engineer` (+ `accountant`).

**Conclusion:** the product-vision and market-positioning parts of the assessment are sound and useful; the
implementation/architecture critique is factually wrong against `main`. The core operating loop is built, live,
and security-reviewed. The genuine forward work is the **Commercial SaaS layer** (→ SPEC-0013), plus depth
features (PO/quote/invoice-match, planned-vs-actual, payroll-run build, true offline, the AI build).

## Doc hygiene (recommended, Owner-gated — NOT done here)
- Add a one-line banner to the **legacy/migrate-from** sections of `docs/03-architecture-and-data-model.md`
  (anything naming `payment_vouchers` / prototype enums) marking them "historical / pre-`main` data model — see
  RECONCILE-001 for the live schema," so future reviewers don't mistake them for the production architecture.

## Open questions (for the Owner)
- WhatsApp/SMS approval recurs in external assessments, but SMS/Twilio was **dropped from MVP-0** (auth =
  email/password). Is WhatsApp owner-approval a wanted feature? (It is a Hard Stop — external send + trifecta.)
- Per-farm (EGP) pricing is a CLAUDE.md non-negotiable; any "tenant limits" must not reintroduce per-seat.

## Confirmation
**Nothing was changed in this audit.** Read-only enumeration of the working tree only; no files written to the
app/schema, no migrations, no prod access.
