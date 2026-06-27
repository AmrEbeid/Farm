# Documentation Health — baseline scorecard

*Operationalizes the **Documentation Health Score** added to the CLAUDE.md Definition of Done
([`SPEC-0014`](SPEC-0014-knowledge-living-documentation.md) A4). Audits each user-facing page against the DoD
checklist and assigns a maturity level (L0–L5, [`SPEC-0015`](SPEC-0015-product-knowledge-system.md) §3).
**This is the documentation baseline; the CI lint that enforces it is app/tooling work (not built here).**
Reconciled to `main` 2026-06-27. Maturity of this doc: L3.*

## DoD checklist (per user-facing page)
A user-facing page is "Done" with: ① page purpose · ② 5-question help block · ③ related pages · ④ permissions ·
⑤ business rules · ⑥ error/"Why?" explanations · ⑦ manual entry · ⑧ version/changelog. **Blocking for user-facing
pages; advisory for internal/admin/infra.**

Legend: ✅ present · ◐ partial · ✗ missing. Sources: ② [PAGE-HELP](PAGE-HELP.md) · ④ [PERMISSIONS-MATRIX](PERMISSIONS-MATRIX.md)
· ⑤ [BUSINESS-RULES-CATALOG](BUSINESS-RULES-CATALOG.md) · ⑥ [WHY-CATALOG](WHY-CATALOG.md) · ⑦ `docs/user-manual/`.

## Page scorecard
| Page | ① purpose | ② help | ③ related | ④ perms | ⑤ rules | ⑥ why | ⑦ manual | ⑧ changelog | Maturity |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| `/farm` (+ sector/hawsha/line/palm) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ✗ | **L3** |
| `/farm/croquis` | ✅ | ✅ | ✅ | ✅ | ◐ | ✗ | ✗ | ✗ | L2 |
| `/plans` (+ detail) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ | **L3** |
| `/inventory` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ | **L3** |
| `/inventory/[itemId]/coverage` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ | **L3** |
| `/purchase-requests` (+ detail) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ | **L3** |
| `/budget/[planId]/check` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ | **L3** |
| `/budgets` | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ | ✗ | L2 |
| `/suppliers` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ✗ | **L3** |
| `/expenses` | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ | ✗ | L2 |
| `/m` (+ execute) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ | **L3** |
| `/reports/[planId]/pva` | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ | ✗ | L2 |
| `/dashboard` (owner/manager) | ✅ | ✅ | ✅ | ✅ | ◐ | ✗ | ◐ | ✗ | L2 |
| `/people` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ | ✗ | L2 |
| `/weather` | ✅ | ✅ | ✅ | ✅ | ◐ | ✗ | ✗ | ✗ | L2 |
| `/profile` | ✅ | ✅ | ✅ | ✅ | ✗ | ✗ | ✗ | ✗ | L2 |
| `/settings` | ✅ | ✅ | ✅ | ✅ | ◐ | ✗ | ◐ | ✗ | L2 |

## Summary
- **Coverage:** ①–④ are ✅ across all user-facing pages (purpose/help/related/permissions complete via the Tier-1 +
  Phase-2 catalogs + PAGE-HELP). ⑤ business rules ✅ for the core operating-loop pages; ⑥ "Why?" ✅ where the page
  has mapped error codes.
- **Systemic gaps (every page):** ⑧ **per-page changelog/version is ✗ everywhere** — there is no release-notes
  system yet (Phase 3, consumer-gated). ⑦ **manual** coverage is partial — `docs/user-manual/` has 6 pages
  covering the core loop, not all 26 routes.
- **Maturity:** core operating-loop pages reach **L3** (human-written + verified vs `main`). The ceiling without
  app work is L3 — **L4 (CI-validated) and L5 (generated) require the lint/build tooling**, which is app/tooling
  work (not built here).

## Recommended next steps (each is a future task, not done here)
1. **Wire the CI lint** (SPEC-0014 A4) to enforce this scorecard → unlocks L4. *(app/tooling — Owner-gated.)*
2. **Extend `docs/user-manual/`** to the pages marked ◐/✗ in ⑦.
3. **Release-notes system** (Phase 3) to close ⑧ — gated on a release process.
4. **Wire `pageMeta` + Help drawer + WhyButton** from PAGE-HELP / WHY-CATALOG content. *(app code — Owner-gated.)*

Maintenance: re-score when a page or its catalogs change; this scorecard is the input the CI Health Score lint
will later automate.
