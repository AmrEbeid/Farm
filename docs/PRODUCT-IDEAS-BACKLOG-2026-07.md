# PRODUCT-IDEAS-BACKLOG — the "what would make it better" list (2026-07)

*Every idea that survives triage goes here — NOT into code (feature freeze until Stage M, see STATUS.md). Each entry: what, why, when it earns a build. Sources: 360° review, market delta, Owner ideation. Ranked within tiers. When one is picked: research → decision → spec → task (MASTER-PLAN §8.8 market-led control).*

## Tier 1 — Season-1 themes (build WITH real data, on the real farm calendar)

| # | Idea | Why | Gate |
|---|---|---|---|
| 1 | **Season-cycle engine** — the phenological calendar drives proposed plans + forward coverage | Turns records into "next best action"; the category-defining spine | SPEC-0021 (drafted) |
| 2 | **Pollination module** — spathe-split windows (12–36h), multi-pass records, pollen from the 299 ذكور as a stock item | Highest-labor, most time-critical op; nobody productizes it; pollen is literally a coverage problem | SPEC-0021 MVP slice |
| 3 | **WhatsApp field layer** — task digests out; "تم"+photo in | Adoption weapon; meets Egyptian field reality | SPEC-0022 (drafted); security review |
| 4 | **Bunch-management ledger → manual yield forecast** — bunches/palm after خف, bagging, tie-down; forecast = Σ(bunches × cultivar avg weight) | Yield forecasting wedge with zero AI; feeds harvest labor + revenue projection | Real registry first |
| 5 | **Harvest-stage tracking (كمري/خلال/رطب/تمر) per palm/line + harvest passes** | Barhi sells at خلال — stage-tagged passes drive price realization + piece-rate payroll | harvest_stage exists; needs pass UX |
| 6 | **Per-tree economics** — cost + yield rolled to palm/hawsha → "worst-ROI palms" report | The registry moat monetized; falls out of accounting kernel + events once real data lands | Stage M + Slice A |
| 7 | **Offshoot (فسائل) module** — mother-palm → separation → nursery → sale, tied to revenue | Major secondary revenue for exactly this farm profile; no competitor has it | Slice A revenue path |

## Tier 2 — cheap extensions of live modules (slot into Season 1 when adjacent work happens)

| # | Idea | Why |
|---|---|---|
| 8 | **Water-m³ per irrigation op + per-feddan report** | Egypt water policy + KSA ترشيد alignment; one column + one report |
| 9 | **SusaHamra-shaped RPW export** (trap ID, location, captures, inspection) | Future-proofs likely reporting mandates; GTM with extension services |
| 10 | **GlobalGAP evidence-pack report** | Converts existing records into an export-certification pitch |
| 11 | **Alert center / notification rules** (org-configurable: shortage, overdue ops, PR waiting, frost) — in-app now, WhatsApp later via SPEC-0022 | The engine already computes the signals; today they're only visible on dashboards |
| 12 | **Sale-price benchmark field** on sales (vs. market price manually entered) | Answers "did we sell well" without auction-feed fantasy |
| 13 | **Equipment & pump maintenance log** (assets exist) — service dates, fuel, breakdowns | Farms run on pumps/tractors; downtime = missed irrigation windows |
| 14 | **Cash-flow forward view** — custody balance + payment-request queue + payroll projection + seasonal purchase plan | The finance kernel's forward-looking twin; owner's #1 daily question |
| 15 | **Cold-store/crate tracking at harvest** (lot → hawsha traceability) | Extends inventory to outbound; pairs with GlobalGAP traceability |

## Tier 3 — scale features (when farm #2 signs)

| # | Idea | Why |
|---|---|---|
| 16 | **Config-as-data control panel** (#215): custom fields, org vocabularies, role-matrix editing (review-gated), season dates | "A product," not "Ebeid Farm's app" |
| 17 | **Self-serve onboarding wizard**: structure → registry import (SPEC-0020 path) → roles → first plan | White-glove GTM must not scale linearly with Owner time |
| 18 | **Cross-farm anonymized benchmarking** (cost/feddan, yield/palm by cultivar) | Network-effect moat; needs ≥5 tenants |
| 19 | **KSA compliance pack** (subsidy-ready records, ترشيد water evidence, Saudi Date Mark quality records) | The 1k+ palm commercial white space; time to 2027 Year of the Date Palm |
| 20 | **English secondary locale** (owner/investor-facing reports only; field stays Arabic-first) | GCC investors/partners; cheap once labels are centralized |
| 21 | **Zr3i carbon-MRV export partnership** (read-only registry/practices export) | Monetizes the registry; keeps Zr3i out of ops |
| 22 | **Multi-crop generalization** — palms stay first-class | ⬆️ **Elevated 2026-07-02 (issue #595)**: the Owner confirmed intercropping (زراعات بينية) between palms in SOME hawshat at the reference farm — no longer a scale feature but a reference-farm modeling requirement. The `hawsha_crops` composition capture now rides the Stage-M import (SPEC-0003 addendum); intercrop ops/vocabulary/revenue follow post-Stage-M (#595 D3). |

## Tier 4 — later / weigh carefully

| # | Idea | Caution |
|---|---|---|
| 23 | عبدالجليل AI assistant (Stage 11) | After the spine exists; read-only RLS-scoped RPCs only (SPEC-0005) |
| 24 | Arabic voice-note → transcribed operation notes | Genuinely good for literacy; needs a transcription service decision (PII review) |
| 25 | QR/NFC tags per palm/line → scan-to-360 → record | Physicalizes the moat; hardware + labeling logistics — pilot one hawsha first |
| 26 | Buyer/CRM-light + sales orders | Only when revenue module (Slice A) is real and used |
| 27 | Photo-based pest/disease ID | Liability-adjacent (non-negotiable #4); only as "suggest + agronomist confirms," never diagnosis |
| 28 | Anomaly alerts ("labor cost/feddan spiked 40%") | Needs ≥1 full season of real data to be honest |

## Standing DO-NOT-BUILD (from MARKET-DELTA §5)

CV bunch counting · input BNPL · in-house carbon MRV · labor marketplace · RPW IoT hardware · auction price feeds · native ETA submission · bank feeds / multi-entity · IAS-41 bearer plants (Slice-D prestige only).
