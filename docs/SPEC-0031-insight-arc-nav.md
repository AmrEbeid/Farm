# SPEC-0031 — الرؤى: the insight arc + navigation cleanup

*Status: **BUILT** (feat/insights-hub-nav). Finishes the presentation layer that SPEC-0029 (insight engine)
and SPEC-0030 (navigation) designed, driven by the Owner's "EBD Farm Insights" reference PDFs. Principle
(carried from SPEC-0029): **port the calculation, never the constant** — every figure comes from the audited
GL / registry / offshoot ledger; forecasts are visibly labeled «تقديري», never presented as recorded fact.*

## 0. Thesis

Farm OS already had the **trust** (reconciled GL, balanced statements) and most of the **insight engine**
(`lib/pnl-insights.ts`: verdict, narrator, best-unit benchmark, concentration/cost theses — all tested). What
it lacked was the **arc**: the insight pages were buried mid-list inside the 20-item finance module, with no
single narrative destination. This spec adds «الرؤى» — an ordered story of 7 chapters, each answering one
question — and declutters finance, without rebuilding what already worked.

## 1. What shipped (7 slices, each one PR-commit, frontend-only except one dropped RPC)

1. **«الرؤى» hub + nav** — `/insights`: an ordered arc (نظرة عامة → أداء القطاعات → بنك الفسائل → بطاقة الأداء →
   المقارنة الداخلية → التقرير السنوي → النظرة المستقبلية); chapters not yet built render an honest «قريبًا»
   marker. New tasks-module «الرؤى»; the 5 insight pages moved OUT of finance (20→15). page-help added.
2. **بطاقة الأداء** — `/insights/scorecard`: year-vs-year, traffic-light verdicts + the deterministic Arabic
   narrator. Reuses `verdictForChange`/`narratePeriods` over `fn_pnl_timeseries`. Farm-level per-feddan
   deliberately omitted (overlapping enterprises share land → a farm-total denominator would fabricate a ratio).
3. **المقارنة الداخلية** — `/insights/benchmark`: "لو أدى كل فدان مثل الأفضل" — full-potential + per-sector
   gap/upside + status badges + concentration thesis. Uses `computeSectorPnl` (leaf-level, all years, complete;
   an earlier `fn_sector_pnl` attempt was dropped — sector_id tagging only covers 2023+, partial coverage).
4. **أداء القطاعات** — the existing `/finance/sector-scorecard` already delivered per-feddan + status vocab +
   benchmark; added the cross-link to المقارنة الداخلية. A 7-year per-sector conditional table was omitted:
   pre-2023 expenses aren't tagged to the current sector structure, so the matrix would mislead (#1).
5. **بنك الفسائل** — the existing `/farm/offshoots` had flow + expansion + valuation; added «معدل الاحتفاظ»
   (produced kept vs sold).
6. **التقرير السنوي** — `/insights/annual-report`: print-ready cover + revenue/profit journey chart + sector
   contribution + lifetime stats. All DB-derived (`fn_pnl_timeseries`, `computeSectorPnl`, «عام»-center area).
7. **النظرة المستقبلية** — `/insights/outlook`: three revenue scenarios from the historical CAGR, a prominent
   «أرقام تقديرية — ليست مسجّلة» banner, assumptions on-page, honest-null with no base. Maturity reframe labeled
   an agronomic template pending sign-off (#4).

## 2. Non-negotiables held

- **#1 honest-null / no fabrication** — every figure from the posted journal / registry; forecasts labeled;
  ambiguous denominators (farm-total per-feddan, pre-2023 sector matrix) omitted rather than faked.
- **#6 drawings ≠ opex** — inherited from `fn_pnl_timeseries` / `computeSectorPnl`.
- **#2 Arabic-RTL-first** — no EN/AR toggle (Owner: "no need for en/ar").
- **Recharts code-split** — annual-report added to the allowlist; guard green (16 routes).
- **Migration discipline** — no net schema change (the one exploratory RPC was dropped; prod clean).

## 3. Not done (deliberate)

EN/AR toggle (Owner dropped it); a 7-year per-sector conditional table + radar (data not sector-tagged pre-2023);
the "اسأل عمر" GL-grounded AI advisor (SPEC-0029 Phase 4 — gated by lethal-trifecta); land + standing-orchard
fair-value on the balance sheet (accountant/valuer, tracked in the finance reconciliation lane).
