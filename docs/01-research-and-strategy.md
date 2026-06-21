# 01 — Deep Research & Strategy

`[V]` = verified from a cited source · `[I]` = inferred/analyst judgment. Treat pricing as indicative — most ag SaaS hides real numbers behind quotes.

---

## 1. Market structure

The farm-software market splits into five bands, each leaving our target buyer underserved:

| Band | Examples | Why they miss the Egyptian date/fruit farm |
|---|---|---|
| **Enterprise agribusiness platforms** | AGRIVI, Cropin, SourceTrace | Quote-only, implementation-heavy, value-chain/traceability framing; AGRIVI's own #1 complaint is *"the financial module is not accounting"* `[V]`; no Arabic (AGRIVI) |
| **Row-crop FMS (North America/AU)** | Conservis, Granular/Traction, Agworld, Trimble, Climate FieldView | English-first, row-crop data model (fields/paddocks, not trees), no Arabic, hardware-tethered (Trimble/FieldView) |
| **SMB all-in-one** | Farmbrite, Tend, fieldmargin, Harvust | Cheap & friendly but shallow on budget/approvals/tree-level; no Arabic; "steep learning curve" and "graphs hard to read" are common complaints `[V]` |
| **Orchard/tree-native** | Croptracker, Phytech (sensors) | Closest on tree-level ops, but English-only, no budget-gating/approvals, Phytech is sensor-IoT not an OS |
| **Open-source / generic ERP** | farmOS, LiteFarm, Odoo/ERPNext Agriculture | Great data models to learn from; ERPs have accounting/approvals but "complex to set up," ag layer thin/semi-maintained |
| **MENA-native** | **Zr3i** (Egypt, Arabic, date-palm), Mozare3, Palmear, Aerobotics | Zr3i competes on a *different axis* (satellite + carbon MRV) with no planning/inventory/budget/accounting; Palmear/Aerobotics are RPW/imaging point-solutions, not an OS |

---

## 2. Competitor capability matrix (25+ products)

Columns: **PLAN** operation planning · **INV** inventory · **COV** stock-coverage-vs-plan (run-out forecasting) · **BUD** budget+variance · **APR** purchase-request approval · **MAP** field/block map · **TREE** tree/plant-level · **WX** weather · **AI** · **MOB** mobile · **OFF** offline · **AR** Arabic/RTL · **ACC** real accounting · **DIS** disease/agronomy. (Y / ~ partial / N; `[I]` where inferred.)

| Product | Region | Pricing | PLAN | INV | **COV** | BUD | APR | MAP | TREE | WX | AI | MOB | OFF | **AR** | ACC | DIS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGRIVI** | global | quote | Y | Y | ~ | ~ | N | Y | ~ | Y | Y | Y | ? | **N** | N | Y |
| **Cropin** | global | quote | Y | ~ | N | N | N | Y | ~ | Y | Y | Y | Y[I] | ~ | N | Y |
| **FarmERP** | India/MENA | ~$600/user/yr | Y | Y | ~ | Y | ~ | Y | ~ | Y | Y | Y | ? | **Y** | **Y** | Y |
| **AgriERP (Folio3)** | US/PK | custom | Y | Y | ~ | **Y** | **Y** | Y | ~ | ~ | ~ | Y | ? | ~ | **Y** | ~ |
| **Conservis** | US | $10k+/yr | **Y** | **Y** | **~ (flags shortages)** | **Y** | **Y** | Y | ~ | ~ | N | Y | Y | **N** | ~ | N |
| **Agworld** | AU/US | $1.5–4k/yr | Y | Y | ~ | ~ | N | Y | N | ~ | N | Y | Y | N | N | ~ |
| **Granular/Traction** | US | quote / — | Y/~ | Y | ~ | **Y** | ~ | Y | N | ~ | N | Y | ~ | N | **Y (Traction)** | N |
| **Trimble Ag** | global | $83–149/mo+ | Y | Y | ~ | ~ | N | Y | N | ~ | N | Y | Y | N | ~ | N |
| **Climate FieldView** | global | from $299/yr | ~ | N | N | N | N | Y | N | Y | ~ | Y | ~ | N | N | ~ |
| **Croptracker** | CA | modular | ~ | Y | ~ | ~ | N | Y | **Y (row-level)** | ~ | ~ | Y | Y | N | ~ | ~ |
| **Farmbrite** | US | $29–109/mo | Y | Y | N | ~ | N | Y | ~ | ~ | N | Y | ~ | N | ~ | N |
| **Tend** | US/CA | sub | Y | Y | N | ~ | N | Y | ~ | N | Y | Y | ? | N | Y | N |
| **fieldmargin** | UK | freemium | ~ | Y | N | N | N | Y | N | ~ | N | Y | **Y** | N | ~ | ~ |
| **Harvust** | US | usage | N | N | N | N | N | ~ | N | Y | N | Y | ~ | N(multiling.) | N | N |
| **Phytech** | IL | sub | N | N | N | N | N | Y | **Y (sensor)** | Y | Y | Y | — | ~ | N | ~ |
| **Farmonaut** | India | ~$2.69/acre/yr | ~ | ~ | N | N | N | Y | N | Y | ~ | Y | — | ~ | N | ~ |
| **Odoo Agriculture** | OSS | free/host | Y | Y | ~ | **Y** | **Y** | ~ | ~ | N | N | Y | ~ | **~ (some AR)** | **Y** | Y |
| **ERPNext Agriculture** | OSS | free/host | Y | Y | ~ | **Y** | **Y** | ~ | ~ | ~ | N | Y | ~ | **Y[I]** | **Y** | Y |
| **Zr3i (Digi Agri)** | **Egypt** | free + carbon | ~ | N | N | N | ~ | Y | N | Y | ~ | Y | ~ | **Y** | N | ~ |
| **SourceTrace** | global | custom | ~ | Y | N | N | N | Y | N | Y | ~ | Y | Y | ~ | ~ | ~ |
| **Mozare3** | Egypt | fintech margin | — | — | — | — | — | — | — | — | — | Y | — | **Y** | — | ~ |

**Sources:** [AGRIVI](https://www.agrivi.com/products/) · [Cropin](https://www.cropin.com/) · [FarmERP MENA](https://www.farmerp.com/why-farmerp-is-the-perfect-farm-management-tool-for-enterprises-in-mena) · [AgriERP](https://agtech.folio3.com/erp-for-agriculture/) · [Conservis (G2)](https://www.g2.com/products/conservis/reviews) · [Agworld](https://www.softwareadvice.com/farm-management/agworld-profile/) · [Traction](https://www.capterra.com/p/218915/Traction/) · [Trimble](https://ww2.agriculture.trimble.com/software/software-comparison-chart/) · [Climate FieldView](https://www.capterra.com/p/178933/Climate-FieldView/) · [Croptracker](https://www.croptracker.com/product/orchard-management-software.html) · [Farmbrite (Capterra)](https://www.capterra.com/p/136765/Farmbrite/) · [Tend](https://www.tend.com/) · [fieldmargin](https://www.fieldmargin.com/) · [Harvust](https://www.harvust.com) · [Phytech](https://www.phytech.com/) · [Farmonaut](https://farmonaut.com/) · [ERPNext Agriculture](https://github.com/frappe/agriculture) · [Zr3i](https://www.zr3i.com/) · [Mozare3](https://mozare3.net/en/).

---

## 3. Capability scarcity — how common is each capability?

| Tier | Capabilities | Implication |
|---|---|---|
| **Near-universal** | mapping, weather, mobile, inventory, planning | table stakes — must have, won't differentiate |
| **Common-ish** | disease/agronomy knowledge, accounting (ERP-class only) | parity expected at Pro tier |
| **Rising but shallow** | AI assistant (AGRIVI, Cropin, Tend, Phytech), budget+variance (Conservis, Traction, ERP-class), offline (fieldmargin, Cropin) | differentiate on *depth + Arabic* |
| **Rare** | tree/plant-level records (Croptracker, Phytech), purchase-approval workflow (ERP-class + Conservis POs) | real edge |
| **Almost nobody** | **stock-coverage-vs-plan run-out forecasting** (only Conservis "flags shortages," reactively) · **Arabic/RTL** (only FarmERP, Zr3i, some Odoo/ERPNext) | **the wedge** |

---

## 4. The white-space / wedge (confirmed)

Plot the field on two axes:

- **Axis A — Arabic + date-palm + crop intelligence:** owned by **Zr3i** (+ Farmonaut satellite behind it), but they are *remote-sensing / carbon* plays with **no planning, no inventory, no budget, no approvals, no accounting**.
- **Axis B — Planning + budget + inventory + approvals + accounting:** owned by **Conservis / AgriERP / FarmERP / ERPNext**, but **English-first (or generic-ERP Arabic), row-crop/generic, not tree-native, and weak on forward stock-coverage intelligence**.

**Nobody sits in the intersection.** That intersection is the product:

> **A forward operations plan (weekly/monthly/seasonal, palm/tree-level) → a live stock-coverage forecast (run-out date vs supplier lead time) → a budget-gated purchase request → an Arabic-native, mobile, offline-tolerant approval workflow → people/responsibility + accounting underneath.**

The **single highest-value, lowest-competition feature is stock-coverage-vs-plan intelligence**. Arabic + tree-level + approvals are the moat.

**Secondary defensible layers:** (a) palm/tree-level mapping + activity files (only Croptracker/Phytech approach it, neither in Arabic); (b) an Arabic, palm-specific **disease "Academy"** tied to the plan and to RPW follow-up; (c) **budget-gated approvals** as a first-class workflow rather than a buried ERP feature.

---

## 5. Customer voice & pain ranking

> **Caveat `[V]`:** published farm-software review corpora are thin and English/NA-skewed (AGRIVI ~12 reviews, FarmERP ~1, Farmbrite ~62), and there is **essentially zero published Arabic-language review voice** — itself a market signal. Persona-level Arabic specifics are `[I]` pending your own primary interviews.

**Verified recurring complaints** (reviews + aggregators): steep learning curve / clunky onboarding → abandonment `[V]`; "workflows that feel more like data entry than farm management" `[V]`; weak/rigid/non-exportable reporting `[V]`; "pricing doesn't scale down" / per-user models punish teams `[V]`; poor mobile/field usability `[V]`; rigidity / poor fit to farm type (can't model zones/multiple varieties per field) `[V]`; glitches / "I'd prefer installed software" `[V]`.

**Prioritized pain list (frequency × severity):**

1. **Onboarding/learning curve too steep → abandonment** `[V]` — the #1 churn cause industry-wide.
2. **No Arabic / no RTL field experience** `[I, high]` — disqualifies incumbents for this buyer entirely.
3. **Tedious data entry; weak mobile / not field-real** `[V]`.
4. **Weak, rigid, non-exportable reporting; no cost-per-block** `[V]`.
5. **Price doesn't scale; opaque/per-user models** `[V]`.
6. **No tree/block-level records for perennials** `[I, high]` — structural gap.
7. **Lost pest/disease (RPW) follow-up lifecycle** `[I, high]` — validated by Palmear's existence.
8. **Missed expenses / stock leakage / unclear responsibility / no budget control** `[I, med-high]`.
9. **Offline/connectivity fragility** `[V context → requirement]`.

**Persona → top-3 pains:**

| Persona | Top pains |
|---|---|
| **Owner** | no profit/cost visibility per block · weak budget control & suspected leakage · no remote oversight |
| **Farm manager** | operation/task planning gaps · tedious capture + bad mobile · tree/block records & pest follow-up |
| **Agri-engineer** | lost disease/pest treatment history · no tree-level agronomy log · planning windows (irrigation/pollination/harvest) |
| **Accountant** | missed/late expense capture at source · rigid non-exportable reports · no link field-activity↔books |
| **Supervisor** | labor/attendance tracking · unclear task assignment · fast Arabic mobile capture |
| **Storekeeper** | stock shortages/leakage · issue/receive tracking · low-friction logging |

**Sources:** [McKinsey — farmer adoption dilemma](https://www.mckinsey.com/industries/agriculture/our-insights/agtech-breaking-down-the-farmer-adoption-dilemma) · Capterra (Farmbrite, FarmERP) · FarmKeep/Felt aggregators · CIO/BusinessChief (Palmear).

---

## 6. MENA / Egypt context (the wedge market)

- **Egypt is the #1 global date producer:** ~1.8–1.87M tonnes/yr, ~19–20% of world output; ~16M+ palms; national project to add 2.5M export-cultivar palms `[V]`.
- **Export paradox:** Egypt exports only ~3% of world date exports / ~15% of its own production — most consumed domestically `[V]`. The commercial hook: export-grade traceability, quality, and yield economics.
- **Government tailwind:** FAO + Ministry of Agriculture building an ICT extension model with **Date Palm + Citrus** as pilot themes `[V]`; UNDP Digital Agribusiness Map + SAIL project; Hayah Karima rural backdrop `[V]`.
- **Existing date-palm tech:** Palmear (acoustic RPW detection), Aerobotics (date-palm monitoring, Jan 2024) — point solutions, **not** an OS `[V]`. No Arabic-first farm-OS incumbent.
- **Gulf:** Pure Harvest (most-funded MENA agritech ~$387M), PIF $150M agritech allocation, Saudi MEWA digital push, FarmERP–Seiyaj partnership `[V]` — budget + policy tailwind, but dominated by controlled-environment/point solutions.
- **Connectivity reality:** Egypt 82.7% internet penetration, ~98% LTE coverage `[V]`, **but urban 84% vs rural 63% — a 21-pt gap (~24.5M offline rural)** `[V]`. → **engineer for intermittent connectivity (offline-first sync)** and low-literacy/voice-friendly capture.

**Sources:** FAO e-Agriculture & Date Palm value-chain (TCP/EGY/3603); EgyptToday/Tridge; UNDP Digital Agribusiness Map Egypt; [DataReportal Digital 2026 Egypt](https://datareportal.com/reports/digital-2026-egypt).

---

## 7. Pricing landscape

| Tier | Benchmarks `[V]` |
|---|---|
| **SMB self-serve** | Farmbrite $29–109/mo; Climate FieldView from $299/yr; Trimble Farmer Fit $83/mo, Pro $149/mo; free trials 7–14d standard |
| **Mid-market grower** | Agworld ~$1,495 / $2,495 / $3,995/yr; FarmERP ~$600/user/yr |
| **Enterprise / ERP** | AGRIVI, Cropin, AgriERP, Conservis ($10k+/yr), SourceTrace (~mid-five-figures/yr) — quote-only, almost always with a setup/implementation fee |
| **Per-area** | Farmonaut ~$2.69/acre/yr (floor); Granular $3–6/acre; general rule ~$8–15/acre/yr `[I]` |
| **Setup/implementation norm** | healthy benchmark ≤ ~15% of year-one ACV; typical hands-on implementation 40–60 hrs `[V]` |
| **MENA-specific published farm-SaaS pricing** | **none found** `[V — absence]` → set your own anchor |

**Adoption economics `[V, McKinsey]`:** 50% of farmers globally unwilling to pay anything for agtech; top barriers high cost (52%), unclear ROI (40%), setup complexity (EU 32%); minimum expected ROI ~3:1; adoption rises with size (large 81%, medium 76%, small 36%) — reinforces targeting **medium/large** farms.

**Implication:** price **per-farm (+ per-area above a threshold), in EGP, not per-seat**; offer a free/low entry tier (Zr3i gives 10 feddan free); productize a paid onboarding capped at ~15% of year-one value.

---

## 8. Open-source teardown (what to copy)

| System | Stack / license | The ONE idea to copy |
|---|---|---|
| **farmOS** | PHP/Drupal, Postgres/MySQL; GPL-2 | **Asset + Log + Quantity triad** — thin assets, append-only event logs hold all history, quantities hang off logs; a single `pending/done` log status unifies *plan* and *actual* `[V]` |
| **LiteFarm** | Node/TS + Knex + Postgres + React; GPL-3 | **Typed task supertable + per-type detail tables**, `management_plan` linking crop→location→tasks, **first-class typed finance** (expense/revenue) `[V]` |
| **ERPNext** | Python/Frappe; GPL-3 | **Item + Stock Ledger Entry + Bin** (on-hand / reserved / ordered / projected per item-warehouse) — directly relevant to the stock-coverage engine `[I]` |
| **Odoo** | Python; LGPL/AGPL | **stock.quant** (immutable on-hand snapshot per product×location×lot) + **stock.move** chained reservations `[I]` |
| **Tania** | Go/Vue; Apache-2 (near-dormant) | simple Area+Reservoir+CropBatch lifecycle staging — good smallholder UX, weak multi-tenant `[V]` |
| **OpenAgri/AgStack "Pancake"** | microservices; OSS (launched Dec 2025) | semantic/interop layer — design the event schema to be exportable to it `[V]` |

**Decision: BUILD custom on Next.js + Supabase, reimplementing farmOS's asset/log/quantity *concepts* + LiteFarm's typed-finance + ERPNext's Bin-style stock snapshots.** Don't fork a runtime (farmOS=Drupal wrong stack; LiteFarm GPL-3 limits commercial closing). Full architecture in [03](03-architecture-and-data-model.md).

---

## 9. Lessons to copy & anti-patterns to avoid

**Top 10 lessons to copy `[V/I]`:**
1. Tie **cost-per-unit and margin to the plan** (Conservis/Trimble/Agworld) — growers buy profit-per-block, not task lists.
2. **Modular "pay for what you use"** (Croptracker/AGRIVI) — start with mapping+activities, grow into budget/approvals/accounting.
3. **Real inventory with auto-withdrawals + re-entry/PHI alerts** (Croptracker) — the foundation of the stock-coverage engine.
4. **Grower + advisor/agronomist seats** (Agworld) — sell agronomists as a channel that pulls farms onto the platform.
5. **Offline-first field capture** (fieldmargin/Cropin) — headline, not footnote, for rural Egypt.
6. **Compliance/traceability reports out of the box** (Croptracker 80+ GAP reports) — export date farms need GlobalGAP.
7. **Translated, multi-channel worker comms** (Harvust: WhatsApp, audio translation) — fits low-literacy/mixed-language labor.
8. **AI as advisor grounded in your own structured data** (Phytech/AGRIVI) — not a generic chatbot.
9. **Accounting growers actually keep books in** (Traction/FarmERP) — don't ship a "financial module that isn't accounting."
10. **Free/low entry tier to grab land** (Zr3i 10-feddan free).

**Top 5 anti-patterns to avoid `[V]`:**
1. A "financial module" that isn't real accounting (AGRIVI's #1 complaint — users keep a parallel system).
2. Inflexible reporting + rigid field model (Agworld: can't do zones/multiple varieties per field) — palm farms need per-row/per-tree heterogeneity from day one.
3. Enterprise-only, implementation-heavy onboarding (Cropin/AgriERP gate out medium farms).
4. Hardware lock-in / device-tethered data (Trimble/FieldView) — stay sensor-agnostic, integrate (Phytech) instead.
5. Generic ERP UX bolted onto agriculture (Odoo/ERPNext/Dynamics) — an Arabic-first, palm-native, opinionated UX is the wedge against exactly these.

---

## 10. Threat watch-list (ranked)

1. **FarmERP** — only incumbent with Arabic + accounting + ERP breadth + active MENA/date-palm marketing. *Beat on UX, tree-level depth, and stock-coverage intelligence.*
2. **Zr3i** — owns Arabic + date-palm brand in Egypt, but on the carbon/satellite axis; could expand into ops. *Partner-or-compete.*
3. **Conservis** — proves the plan+budget+inventory+approvals model and that growers pay; your blueprint minus Arabic/tree/AI.
4. **AgriERP / Odoo / ERPNext** — the "good-enough ERP" floor price-sensitive buyers default to.

---

## 11. Gaps to close with primary research (next step)
- Real **Arabic customer voice** — interview the 6 personas directly (no public corpus exists `[V]`).
- **Egypt-specific willingness-to-pay in EGP** and willingness to pay setup fees (no MENA farm-SaaS price points published `[V]`).
- Whether any incumbent does **true forward run-out forecasting** (verify with live demos before locking strategy).
- Local-agronomist sign-off on the Academy's numeric NPK/irrigation/labor templates and **currently-registered Egyptian pesticides**.
