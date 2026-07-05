# SPEC-0029 — Dashboards & Reports revamp: the insight layer on the audited GL

*Status: **DRAFT** — design. Learns from the "EBD Farm Insights" executive-storytelling prototype and
ports its **models, domain knowledge, thesis engine, and narrative craft** onto Farm OS's real,
audited double-entry GL + registry. Principle: **port the calculation, never the constant** — every
figure comes from the posted journal / registry / offshoot ledger, honest-null (#1), drawings out of
opex (#6), canonical registry (#5), the yield curve pending agronomist sign-off (#4), the AI read-only
& RLS-scoped (lethal-trifecta). Forecasts are always visibly labeled, never presented as recorded fact.*

## 0. Thesis

Farm OS has the **trust** (statement suite balances, drawings excluded, registry canonical, honest-null);
it lacks the **insight layer** (no trends/YoY, no benchmarks, one-sentence narrative, 3 chart types, zero
charts on the statement suite, owner value scattered across 6 overlapping pages). The prototype is the
inverse: a rich insight layer built entirely on **hardcoded, self-contradicting demo data** (its
`AnnualReport`, `Benchmark`, and AI prompt state *different* sector sales and palm totals). The revamp
combines the two: **the prototype's models, grounded in Farm OS's audited data.**

## 1. What we port (four layers — the pixels are the least of it)

### 1a. Domain-knowledge layer (encode ONCE as signed reference data)
- **Barhi yield-vs-age curve** — `1-2yr:0%, 3:5, 4:15, 5:30, 6:50, 7:70, 8:85, 9:92, 10:97, 11-12:100,
  13:98, 14:95, 15:92` (% of peak). Powers every forecast, maturity read, and the "immature ≠
  underperforming" reframe. A reference table joined to each block's planting year → "expected yield %
  today." **Pending a named agronomist + Egyptian pesticide-registration sign-off (#4)** — until then it
  is a template, never authoritative.
- **Fruiting timeline** (fruit yr 4-5, commercial 7-8, peak 10-15+) and **spacing/area math**
  (8×10m≈42 palms/fd, 9×9m≈48/fd, 1 feddan = 4,200 m² = 24 qirat = 1.038 acre) — the normalization
  primitives for every per-feddan/density metric.

### 1b. Analytical-model library (each = one portable calculation, real source noted)
| Model | Logic | Real source |
|---|---|---|
| Verdict engine | 🟢🟡🔴 per metric, **cost-inverted**; good `>+5%`, mixed `>-2%`, bad else; margin uses pp | any two period aggregates |
| Templated narrator | 3 branches (both-profit / turnaround / loss) → a paragraph citing growth, margin dir, best sector, discipline verdict | `fn_pnl_timeseries` |
| Per-feddan/palm toggle | divide every series by area/palm count | registry area + canonical palms (#5) |
| Best-unit benchmark + upside | `bench=max(profit/fd)`; `upside = (bench−actual)×area`; Σ = headline; potential = `Σarea×bench` | per-center profit/fd + area |
| Radar health profile | `revPerFd/200k`, `costControl=max(0,100−costGrowth×5)`, `margin/80`, `yoyGrowth/100`, `lowCost=max(0,100−costPerFd/600)` vs farm-avg | per-center P&L, 2yr |
| Crop ROI/margin | `margin=profit/rev`, `roi=profit/cost` (prototype: Beet 80%/396%, Corn 68%/216%, **Dates 20%/25%**) | rev & cost tagged to crop |
| Offshoot retention & valuation | `retention=1−sold/produced`; `value=remaining×[range]/unit`; `avg/palm=produced/mothers` | `offshoot_movements` + `offshoot_valuation` (exist) |
| Maturity positioning | `age=now−planted` → yield-curve stage (Establishment/Early/Rapid/Peak) | planting year + curve (1a, #4) |
| Scatter + break-even | X=cost/fd, Y=rev/fd, Z=area, 45° `y=x` line; above = profitable | per-center P&L + area |
| J-curve / cumulative P&L | running Σ profit; mark peak-loss, break-even year, current cum | `fn_pnl_timeseries` cumulative |
| Sign-aware stacked | `stackOffset="sign"` → losers below 0 (who drags total profit) | per-center signed profit |
| Fan-chart forecast + scenarios | actual + low/base/high bands + CAGR; `E`-year suffix | trend model **derived from GL**, labeled |
| Efficiency ratio + targets | cost/EGP-revenue line + break-even `y=1` + target `y=0.5` | `fn_pnl_timeseries` |
| Sparkline + status badge | mini line + threshold label (Crown Jewel/Recovering/Needs Attention/Watchlist) | per-center P&L history |
| Growth-loop flywheel | 7 nodes: mother palms→offshoots→plantings→palms→revenue→reinvest→land↻ | offshoot ledger + registry |
| Milestone timeline | palm-count & area growth by year | registry planting history |
| **The Punchline generator** | culminate each report in ONE **computed** thesis sentence ("if all sectors reached best-unit profit/fd → 2-3× current revenue; the farm is immature, not underperforming") | benchmark-model output |

### 1c. Strategic-thesis engine (the sleeper feature — an automated analyst, no LLM)
Automate the prototype's 5 hand-written "insight cards" as **deterministic detectors** over the GL +
registry + offshoot ledger; surface as an owner-facing "what the numbers are telling you" feed:
1. **Concentration / crown-jewel** — a unit ≫ median profit/fd → "X% of profit from Y% of land."
2. **Age-production wave** — a palm cohort crossing the yield-curve knee (yr 5-7) → "N palms entering
   production; expect a revenue wave in [year]."
3. **Crop-ROI imbalance** — identity crop ROI ≪ a rotation crop → "Dates are prestige at 25% ROI; beet is
   the profit engine at ~400% — consider fallow expansion."
4. **Offshoot bank** — inventory + production rate → compounding-asset value + future-palm count.
5. **Cost-discipline watch** — cost growth outpaces revenue growth → cost/revenue ratio trend +
   "investment or inefficiency?".

### 1d. Narrative-craft system
Verdict lights on every KPI → templated narrator paragraph → **the Punchline** (one computed thesis per
report). Plus Roman-numeral chapters, **theme-per-lens** (command-center / analyst-white / grower-green /
boardroom gold-serif / advisor-cream), the flywheel & J-curve reframes, "Crown Jewel" and "immature not
underperforming" framing, a **provenance footer** on every report ("Data as of … · all values EGP · 1
feddan ≈ 1.038 acres"), and the **bilingual RTL number-island** trick (`dir="ltr"` on every numeric node).

## 2. Foundation (Phase 0 — the hard prerequisite)
Nothing rich is safe until every figure comes from ONE place:
- **`fn_pnl_timeseries(p_org, p_grain 'month'|'year', p_from, p_to)`** — revenue/cost/profit/margin per
  period from the **posted** journal (reuse `fn_accounting_income_statement`'s posted-only, signed,
  drawings-excluded logic; period-lock aware). Kills the no-trend, no-YoY, and revenue-honesty gaps.
- **`fn_pnl_by_center_period(...)`** — per-center P&L over time on `v_cost_center_rollup`. The **real-data
  bottleneck**: sector P&L needs shared labor/water/fertilizer *tagged to a cost center*; where it isn't,
  surface an honest **unallocated bucket + allocation score** (`v_cost_center_reconciliation_flags`
  already exists) — never a fabricated split.
- Per-unit denominators from the registry (area, canonical palm count).
- A **signed `palm_yield_curve` reference table** (#4-gated).
- One typed app-side selectors module (avoid the prototype's "6 divergent files" anti-pattern).

## 3. Build sequence
- **Phase 0** — `fn_pnl_timeseries` + `fn_pnl_by_center_period` + `palm_yield_curve` (signed) + selectors.
- **Phase 1** — deterministic insight engine (verdict + narrator + Punchline + thesis detectors 1/3/5) as
  tested pure `lib/` functions; wire into the owner dashboard + income statement. **No LLM.**
- **Phase 2** — charts on the statement suite (trend/YoY/cumulative/J-curve/sign-stacked/heatmap/scatter)
  + consolidate the 6 overlapping owner pages into one narrated arc (theme-per-lens, chapters, footers).
- **Phase 3** — domain keystones: maturity positioning (signed curve), crop-ROI ranking (crop tagging),
  offshoot pipeline + valuation + flywheel (ledger exists), radar profiles, multi-mode farm map.
- **Phase 4** — GL-derived forecast (labeled) + the strategic-thesis feed + the **GL-grounded AI advisor**
  ("Ask Omar"): generate its context from live RPCs (or read-only RLS-scoped tools) instead of a static,
  drift-prone prompt. Gates: lethal-trifecta (read-only scoped RPCs, no raw tables, no service key, no mass
  outbound), finance.read scoping, #4 for any agronomy answer.

## 4. Non-negotiables (must hold throughout)
- **#1 honest-null / no fabricated figures** — the prototype's cardinal sin (hardcoded, divergent,
  "modeled" history shown as fact); the revamp inverts it — one GL source, honest-null, forecasts labeled.
- **#6 drawings ≠ opex** — every new P&L/cost view preserves the exclusion.
- **#5 canonical registry** (4,380 برحي / 299 ذكور / 28 حوش) for all per-palm denominators & the map.
- **#4 agronomist sign-off** for the yield curve, maturity reads, and any agronomic advice (template until).
- **Lethal-trifecta** — AI advisor gets read-only, RLS-scoped RPCs only.
- **Push aggregation into the DB** (`v_*`/`fn_*`), not client-side pagination (`finance/reports` today).

## 5. First cut (recommended)
`fn_pnl_timeseries` → verdict engine + templated narrator + **the Punchline generator** → thesis detectors
(concentration, crop-ROI, cost-watch) → per-feddan toggle + best-unit-benchmark → trend/YoY/cumulative
charts on the income statement + owner dashboard. Highest story-per-effort; every number comes straight
from the posted journal, honest by construction. The **strategic-thesis feed is the highest-leverage
piece** — deterministic, cheap, grounded — and turns the ledger into an analyst without an LLM.
