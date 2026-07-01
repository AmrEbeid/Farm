# STATUS — Farm OS single source of truth
*The ONLY doc that claims currency. Everything else (TRACKER, SESSION-BRIEF) is an append-only archive.*
*Updated: 2026-07-02 (from the 360° review, `REVIEW-360-2026-07-01.md`). Owner: Amr Ebeid.*

**Rule:** update this file whenever repo/prod state changes materially; keep it under ~100 lines. If this file and any other doc disagree, this file wins — then fix the other doc.

## Where we are (honest stage status)

| Stage | Status | Evidence / blocker |
|---|---|---|
| 0 Security remediation | ~50% | #362 open: legacy repo history, spreadsheet creds, leaked-password toggle, demo-cred plan. **Gates all real data.** |
| 1 SaaS foundation (RLS/RBAC/audit) | ✅ Done | 55/55 tables FORCE RLS; `authorize()` 18-perm union pinned by tests/97. |
| 2 Farm structure + registry | 85% code / **0% real data** | Real Nov-2025 registry (4,380/299/28) never imported (#239); prod palms are synthetic. Import path shipped (#561, SPEC-0020). |
| 3 Activity/event model | ✅ ~95% | Event spine + rollups + connected work graph (#582). |
| 4 Planning workspace | ✅ ~95% | Templates #552, relative scheduling #572, assignees, 16-arg multi RPC. |
| 5 Inventory + coverage engine | ✅ ~95% | Masked-shortage-free (independent review 2026-07-01). Open: #199/#526 reservation semantics (safe over-order direction). |
| 6 Budget + approvals | 70% | PR workflow live; **budget gate is display-only** (#157) — approval never reads budget_lines. |
| 7 Accounting | 50% | GL kernel + custody live (#568/#468); **chart of accounts = 0 rows**; no revenue/A-R, no close, no Excel dual-run. Slice plan: `ROADMAP-accounting-custody-2026-07-01.md`. |
| 8 People/payroll | 50% | Onboarding/attendance/labor live; payroll gated on wage model #388. |
| 9 Weather | 70% | Gates + thresholds live; forecast service NOT configured in prod. |
| 10 Care Academy | 20% | #366 draft; gated on agronomist + pesticide-registration sign-off (no agronomist engaged). |
| 11 AI عبدالجليل | 5% | Policy lib only. Correctly last. |
| M Real-data migration | **0% — THE PRIORITY** | Blocked by: Stage 0 (#362) → privacy review → chart-of-accounts seed → registry import → Excel reconciliation. |
| P Production deploy controls | ⚠️ Bypassed | Prod deploys continuously without Stage-P controls (no staging, no monitoring, no rollback drill) — see review R-items. |

## Top next actions (in order)

1. **Owner+accountant meeting**: ETA e-invoicing determination (obligation **plausible-not-proven** — the "EGP 250k threshold / deadline passed" claim is DISPUTED after cross-verification; see `MARKET-DELTA-2026-07-02.md` §1) + ratify chart of accounts (#577) + ETA memo (#578).
2. **Owner: close Stage 0** (#362) — one afternoon; unlocks the real-data path.
3. **Owner: 1-click** leaked-password Auth toggle (#229 iii).
4. **Owner decisions (cheap)**: wage model #388 · #157 budget-cap (4 one-line answers) · #199/#526 reservation semantics (one line).
5. **Build (after 2)**: real palm-registry import via SPEC-0020 path → then #157 real budget gate → then accounting Slice A.
6. **Money-integrity PRs** (from review): custody↔GL movement-type vocabulary + journal completeness; custody balance floor; `fn_reverse_journal_entry`; `audit_read` completeness pin (tests/97-style).
7. **Field-readiness PRs**: ExecuteForm offline outbox; OperationBuilder `Number('')→0` fix; 8 forms missing network catch; storekeeper `/m/receive`. Full list: `REVIEW-360-2026-07-01.md` §Frontend.

## Feature freeze

Until Stage M lands and the farm runs one real week on real data: **no new modules, no new plan-op columns/params, no new research-lane builds.** New ideas go to `PRODUCT-IDEAS-BACKLOG-2026-07.md`, not to code.

## Owner decision queue (ranked; hub = issue #505 + OWNER-DECISIONS.md)

| # | Decision | Gates | Cost to decide |
|---|---|---|---|
| 1 | ETA obligation (accountant) | Slice C / legal exposure | 1 meeting |
| 2 | Chart-of-accounts ratification (#577) | All real finance | same meeting |
| 3 | Stage-0 residuals (#362) | All real data | 1 afternoon |
| 4 | Wage model (#388) | Payroll + labor cost | 1 paragraph |
| 5 | Budget-cap policy (#157) | Real budget gate | 4 one-liners |
| 6 | Registry-import authorization | Stage 2 real data | 1 approval (post-#362) |
| 7 | Reservation semantics (#199/#526) | Engine cleanup (safe today) | 1 line |
| 8 | PR #580 / accounting Slice-A authorization | Next finance build lane | 1 review |
| 9 | Agronomist engagement (start the search) | Stage 10 + dose sign-offs | external lead time |

## Strategy anchors (post-research, 2026-07-02)

- **Wedge (restated):** coverage-vs-plan forecasting **+ budget-gated approvals + Egypt statutory depth**, Arabic-first at tree level. (Not "only Arabic tree registry" — Mazoon Soft exists; see MARKET-DELTA.)
- **Season 1 build theme (with real data):** the **season-cycle engine** (SPEC-0021) + **WhatsApp field layer** (SPEC-0022) + pollination module + per-tree economics.
- **Partner, don't build:** ETA submission (Daftra/Wafeq), carbon MRV (Zr3i data export), input financing (AgriCash/Mozare3).
- **Operations lane (2026-07-02 focused 360 — ops daily-use grade C−):** `OPS-PLAN-2026-07.md` — Lane 0 unblockers (hawsha scope picker, reschedule/cancel, duplicate-op, dedup fix, backdating, week grid, template CRUD+prod seed) can run in parallel with the Stage-M track; the per-palm task ledger + QR-badge crew model + auto spray records are the Season-1 leapfrog.

## Pointers

Plan/governance: `MASTER-PLAN.md` (historical §4 status superseded by the table above) · review: `REVIEW-360-2026-07-01.md` · ops: `OPS-PLAN-2026-07.md` + `OPS-360-REVIEW-2026-07-02.md` · strategy: `BOOM-PLAN-2026-07.md` · research delta: `MARKET-DELTA-2026-07-02.md` · ideas: `PRODUCT-IDEAS-BACKLOG-2026-07.md` · deploy state: `DEPLOY-STATUS.md` · archive log: `PROJECT-TRACKER.md` / `SESSION-BRIEF.md`.
