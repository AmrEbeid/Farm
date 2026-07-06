# STATUS — Farm OS single source of truth
*The ONLY doc that claims currency. Everything else (TRACKER, SESSION-BRIEF) is an append-only archive.*
*Updated: 2026-07-06 (custody report print/PDF polish live). Owner: Amr Ebeid.*

**Rule:** update this file whenever repo/prod state changes materially; keep it under ~100 lines. If this file and any other doc disagree, this file wins — then fix the other doc.

## Where we are (honest stage status)

| Stage | Status | Evidence / blocker |
|---|---|---|
| 0 Security remediation | ~50% | #362 open: legacy repo history, spreadsheet creds, leaked-password toggle, demo-cred plan. **Gates all real data.** |
| 1 SaaS foundation (RLS/RBAC/audit) | ✅ Done | 58/58 tenant tables FORCE RLS; `authorize()` **19-perm** union pinned by tests/97 (added `site.write` 2026-07-03; S-10 reused existing `budget.write`). |
| 2 Farm structure + registry | 88% code / **0% real data** | Real Nov-2025 registry (4,380/299/28) never imported (#239); prod palms are synthetic. Import path shipped (#561, SPEC-0020). Sector/hawsha/line/palm 360 pages now show linked plans/tasks with operation targets and assignees (#673). |
| 3 Activity/event model | ✅ ~95% | Event spine + rollups + connected work graph (#582). |
| 4 Planning workspace | ✅ ~97% | Templates #552, relative scheduling #572, assignees, 16-arg multi RPC, assigned-work dashboard queue + linked 360 plan/task views (#673), and DB/RPC positive plan-requirement backstop live (#848 / prod `20260706180856`). |
| 5 Inventory + coverage engine | ✅ ~95% | Masked-shortage-free (independent review 2026-07-01). Open: #199/#526 reservation semantics (safe over-order direction). |
| 6 Budget + approvals | 70% | PR workflow live; **budget gate is display-only** (#157) — approval never reads budget_lines. |
| 7 Accounting | 96% | GL kernel + custody/payment requests live (#568/#468); custody transfer/reports, revenue/A-R backend/reports, COA, cost centers, owner insights, offshoot valuation, close/period lock, trusted balance sheet, trusted income statement, budget-vs-actual, report catalog, payment-request proof packet, custody report print/PDF polish, and print/CSV coverage are live through #852; finance dashboard separates accountant custody/payment-request due work (#673). Missing: server PDF/signed statement package, Excel dual-run, and historical import/reconciliation after Stage-M. |
| 8 People/payroll | 50% | Onboarding/attendance/labor live; payroll gated on wage model #388. |
| 9 Weather | 70% | Gates + thresholds live; forecast service NOT configured in prod. |
| 10 Care Academy | 20% | #366 draft; gated on agronomist + pesticide-registration sign-off (no agronomist engaged). |
| 11 AI عبدالجليل | 5% | Policy lib only. Correctly last. |
| M Real-data migration | **0% — THE PRIORITY** | Blocked by: Stage 0 (#362) → privacy review → COA owner sign-off/refinement → registry import → Excel reconciliation. |
| P Production deploy controls | ⚠️ Bypassed | Prod deploys continuously without Stage-P controls (no staging, no monitoring, no rollback drill) — see review R-items. |
| W Public website (`/`) | ✅ **COMPLETE + LIVE** | ebeidfarm.business — bilingual AR/EN export site: hero, KPIs, blocks, **real** GlobalGAP/GACC/QCAP/CAPQ proofs, specs, contact, **editable photo gallery** (in-OS upload → `site-media` bucket), **buyer enquiry form → OS** (`/enquiries`, owner-only), logo/favicon/PWA icons, SEO/OG/JSON-LD/sitemap. All content editable in-OS at **`/website`** (`site.write`=owner). Migrations `20260701420000` (content) + `20260701430000` (enquiries) applied. **Buyer enquiry inbox** with owner read/archive management (`fn_set_enquiry_status`, migration `20260701450000`). Unit-tested + security-reviewed. PRs #636/#638–#642/#637/#645/#647/#650/#653/#656/#664. Follow-up: real farm photos. |
| UX Design system (`@amrebeid/ui`) | ✅ **REVAMPED + speed pass LIVE** | Stitch-directed token refresh of the whole OS — softer radii + refined layered shadows + cleaner surface (#665), primary-button depth + modern soft focus ring (#666), table zebra striping (#668), KPI bigger value + delta pill chips (#669). Owner dashboard redesign (#679), app-shell lazy-load speed pass (#681: authenticated layout chunk ~59 KB → ~14 KB), and inventory row coverage bar (#682) are live. Token-purity-clean; propagates to every screen via the two-tier tokens. |

## Top next actions (in order)

1. **Owner+accountant meeting**: ETA e-invoicing determination (obligation **plausible-not-proven** — the "EGP 250k threshold / deadline passed" claim is DISPUTED after cross-verification; see `MARKET-DELTA-2026-07-02.md` §1) + review/refine live COA, cost centers, reports, owner insights, offshoot valuation, accountant dashboard/custody signals, custody transfer, custody reports, revenue/A-R backend, and revenue/A-R reports (#654/#661/#659/#667/#670/#663/#672/#673/#674/#675/#676/#677) + ETA memo (#578).
2. **Owner: close Stage 0** (#362) — one afternoon; unlocks the real-data path.
3. **Owner: 1-click** leaked-password Auth toggle (#229 iii).
4. **Owner decisions (cheap)**: wage model #388 · #157 budget-cap (4 one-line answers) · #199/#526 reservation semantics (one line).
5. **Build now:** server PDF/signed statement package polish and the remaining real-data runway. Close/period lock, trusted balance sheet, trusted P&L, budget-vs-actual, custody/revenue reports, custody report print/PDF polish, payment-request proof packet, and report output coverage are live; **after 2:** real palm-registry import via SPEC-0020 path → #157 real budget gate → historical import/reconciliation.
6. **Money-integrity PRs** (from review): custody↔GL movement-type vocabulary + journal completeness; general custody cash-out balance floor beyond transfers; `fn_reverse_journal_entry`; `audit_read` completeness pin (tests/97-style).
7. **Page-speed follow-up if still slow:** consolidate owner/dashboard multi-query loaders into read RPCs, keep heavy search/help/chart tools async, and add route-specific skeletons for the slowest finance/farm pages after live timing feedback.
8. **Field-readiness follow-ups**: field/DevTools smoke-test the shipped ExecuteForm offline outbox (#625), add PWA brand icons when the real logo asset exists, choose the signed-URL-safe image path for MediaGallery, and batch the deferred DS rebuild. Already shipped: OperationBuilder fabricated-zero fix (#607), DB/RPC positive plan-requirement backstop (repo `20260706175357`, prod `20260706180856`), shared retry/finally submit handling across the 8 forms (#608), bounded `/m` feed (#610), storekeeper `/m/receive` (#614), field-level errors (#613/#627), and decimal mobile keyboards (#611). Full list: `REVIEW-360-2026-07-01.md` §Frontend.

## Feature freeze

Until Stage M lands and the farm runs one real week on real data: **no new modules, no new plan-op columns/params, no new research-lane builds.** New ideas go to `PRODUCT-IDEAS-BACKLOG-2026-07.md`, not to code.

*Exception (2026-07-03, Owner-directed):* the **public marketing website + its OS-editable content model** shipped — it's the front door / brand surface for buyers, not a farm-data module (no plan-op/registry/finance surface). Deliberate, logged, not scope creep.

## Owner decision queue (ranked; hub = issue #505 + OWNER-DECISIONS.md)

| # | Decision | Gates | Cost to decide |
|---|---|---|---|
| 1 | ETA obligation (accountant) | Slice C / legal exposure | 1 meeting |
| 2 | Live chart-of-accounts refinement/sign-off (#654/#661) | All real finance | same meeting |
| 3 | Stage-0 residuals (#362) | All real data | 1 afternoon |
| 4 | Wage model (#388) | Payroll + labor cost | 1 paragraph |
| 5 | Budget-cap policy (#157) | Real budget gate | 4 one-liners |
| 6 | Registry-import authorization | Stage 2 real data | 1 approval (post-#362) |
| 7 | Reservation semantics (#199/#526) | Engine cleanup (safe today) | 1 line |
| 8 | Finance statement/proof package review | Server PDF/signed statement package and accountant proof workflow | 1 review |
| 9 | Agronomist engagement (start the search) | Stage 10 + dose sign-offs | external lead time |

## Strategy anchors (post-research, 2026-07-02)

- **Wedge (restated):** coverage-vs-plan forecasting **+ budget-gated approvals + Egypt statutory depth**, Arabic-first at tree level. (Not "only Arabic tree registry" — Mazoon Soft exists; see MARKET-DELTA.)
- **Season 1 build theme (with real data):** the **season-cycle engine** (SPEC-0021) + **WhatsApp field layer** (SPEC-0022) + pollination module + per-tree economics.
- **Partner, don't build:** ETA submission (Daftra/Wafeq), carbon MRV (Zr3i data export), input financing (AgriCash/Mozare3).
- **Operations lane (2026-07-02 focused 360 — ops daily-use grade C−):** `OPS-PLAN-2026-07.md` — Lane 0 unblockers (hawsha scope picker, reschedule/cancel, duplicate-op, dedup fix, backdating, week grid, template CRUD+prod seed) can run in parallel with the Stage-M track; the per-palm task ledger + QR-badge crew model + auto spray records are the Season-1 leapfrog. First console shipped: `/purchase-requests` open-orders view with the engine-mirrored stale-PO badge (#594).
- **Store/finance lanes (2026-07-02 wave-3):** `SPEC-0023-stock-take-jard.md` (the anti-leakage keystone — buildable now) + `INVENTORY-360-2026-07-02.md` (storekeeper D+/buyer C−/owner D) + `FINANCE-ACCOUNTANT-360-2026-07-02.md` (workday improving — account-classified requests, cost centers, custody transfer/reporting, revenue/A-R reports, close/period lock, trusted statements, budget-vs-actual, payment-request proof packet, custody report print/PDF polish, and owner insight output coverage are live; remaining finance lane = server PDF/signed statement package, Excel dual-run, and historical reconciliation).
- **Wrapper (2026-07-02):** hardening runbook (`RUNBOOK-ops-hardening-2026-07.md` — restore drill BEFORE Stage-M) · onboarding playbook (`ONBOARDING-PLAYBOOK-farm2-2026-07.md`) · support/billing (`SUPPORT-AND-BILLING-MODEL-2026-07.md`) · usability kit (`USABILITY-WATCH-KIT-2026-07.md` — run before Lane 1) · naming (`BRAND-NAMING-2026-07.md` — غلة/Ghalla recommended, TM search first) · **legal (`LEGAL-WRAPPER-2026-07.md` — 🔴 PDPL grace ends ~1 Nov 2026; lawyer review + do-now list)**.
- **Intercropping (Owner fact, #595):** different seasonal crops (incl. بنجر) between palms in some hawshat — `hawsha_crops` (with season dimension) rides the Stage-M import; shared costs shown as «مشترك» until D2; beet harvest vs pollination labor contention noted for SPEC-0021.

## Pointers

Plan/governance: `MASTER-PLAN.md` (historical §4 status superseded by the table above) · review: `REVIEW-360-2026-07-01.md` · ops: `OPS-PLAN-2026-07.md` + `OPS-360-REVIEW-2026-07-02.md` · store: `SPEC-0023-stock-take-jard.md` + `INVENTORY-360-2026-07-02.md` · finance: `FINANCE-ACCOUNTANT-360-2026-07-02.md` · strategy: `BOOM-PLAN-2026-07.md` · research delta: `MARKET-DELTA-2026-07-02.md` · ideas: `PRODUCT-IDEAS-BACKLOG-2026-07.md` · wrapper: `RUNBOOK-ops-hardening-2026-07.md` / `ONBOARDING-PLAYBOOK-farm2-2026-07.md` / `SUPPORT-AND-BILLING-MODEL-2026-07.md` / `USABILITY-WATCH-KIT-2026-07.md` / `BRAND-NAMING-2026-07.md` / `LEGAL-WRAPPER-2026-07.md` · deploy state: `DEPLOY-STATUS.md` · archive log: `PROJECT-TRACKER.md` / `SESSION-BRIEF.md`.
