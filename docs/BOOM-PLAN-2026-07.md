# BOOM-PLAN — Farm OS growth strategy (2026-07)

*Synthesis of the 360° review (`REVIEW-360-2026-07-01.md`, PR #588), the market delta (`MARKET-DELTA-2026-07-02.md`), and the 2026-07-02 deep-dive trio: the linkage map (`LINKAGE-MAP-2026-07-02.md`), customer demand research (`RESEARCH-customer-demand-2026-07-02.md`), and GTM growth research (`RESEARCH-gtm-growth-levers-2026-07-02.md`). Owner: Amr Ebeid. Status: strategy proposal — every build item stays behind the normal gates.*

## The thesis

**Reposition Farm OS as the absentee owner's control-and-anti-leakage instrument, make that story technically true by closing three broken links, and sell it through the layer above the farm — timed to Egypt's 2026 compliance deadlines.**

Why the three research streams lock together:
- **Demand:** the buyer is the absentee owner; what he already pays for is *control* (the management POA with reserved powers, the watchdog accountant, the عهدة cycle). Nobody pays for "planning software." Pitch: *"see and approve every pound; catch shortfalls and leakage before they cost you."*
- **Code:** that story is not yet technically true. Execution cost dies in JSON and never reaches the P&L; labor hours never become money; nothing records what the farm produces or earns; the budget gate approves without reading budgets. The broken links are exactly the links the control story needs (see LINKAGE-MAP).
- **GTM:** farm-direct digital acquisition is the pattern that kills agri-SaaS (FarmLogs, Granular, BharatAgri). Survivors sell to the layer above (Cropin, Pula, Tarfin, DeHaat). The 2026 export-coding (تكويد المزارع) requirement + Egypt's expanding e-invoicing/e-receipt system create the pull. ⚠️ **ETA-claim dispute (2026-07-02):** the specific "threshold halved to EGP 250k, deadline passed 31 Mar 2026" claim FAILED independent verification (it traces to SEO-blog sources; tier-1 compliance vendors describe Resolution 281/2025 as a B2C e-receipt expansion). Treat the ETA urgency as **unverified until the Owner's accountant determination** — which was the recommended action anyway and stands regardless.

## 1. Product — the OS-ification lane (in order; each one PR; all AFTER Stage-M real data)

| # | Link to close | Why |
|---|---|---|
| P1 | **Execution → expense/GL**: `fn_execute_operation` inserts a costed `expenses` row per execution (kind `operating`; `plan_id`/`hawsha_id`/`event_id` FKs exist) | The single highest-value PR: P&L, budget actuals, and hawsha cost all light up. Money-rule gated (Owner decision on the posting rule first). |
| P2 | **Labor → cost**: seed `labor_logs` (with `plan_op_id`) from assignees at execution; op picker on the attendance form; hours×rate joins the cost spine | Labor = #2 cost and #1 leakage suspect; today it is an island (`labor_logs.plan_op_id` never populated). |
| P3 | **Harvest quantity + first revenue slice**: `produced` quantities on harvest ops; minimal `sales` table (#368 draft exists) + `fn_record_sale` posting to the ready GL kernel | Without an output side, cost-vs-yield per hawsha — the product's promise — cannot exist (`finance/pnl` hardcodes `revenue = null`). |
| P4 | **Real budget gate (#157)** + **engine verdict aggregation** (`fn_stock_coverage_all(org)` → dashboard alert) + payment-request queue | The digital POA's "reserved powers." Today the flagship engine verdict is one click deep; dashboards use a static check the code disclaims. |
| P5 | **Pending-actions inbox** — `fn_my_pending_actions(org)` (union: submitted PRs, payment requests by stage, unsigned dose ops, unassigned overdue ops, per caller perms) + shell badge/inbox. Then the WhatsApp layer (SPEC-0022) rides it. | Zero notification infrastructure exists; this is the cheapest structural change that moves work between roles instead of WhatsApp/paper. |

Cheap adjacent wiring (same lane): make agronomist sign-off actually gate dose executions (org-setting toggle; today display-only), and wire the written-but-never-called `fn_assign_plan_operation` (supervisor assignment dead end).

**Sequencing note:** this lane comes directly after Stage-M real data + the money-integrity fixes from REVIEW-360 (custody↔GL vocabulary, audit_read pin, reversal RPC, balance floor), and ahead of most Season-1 features. The season-cycle engine (SPEC-0021) and pollination module then build ON these closed loops.

## 2. Positioning

- **From** "farm planning & stock coverage OS" → **to** **"سيطرة — see and control your farm's money from anywhere."** Planning is the delivery vehicle, not the headline.
- Do not claim the industry's #1 pain (price realization — we don't solve it). Claim the *owner's* pain.
- ⚠️ **Linchpin unvalidated:** "leakage outranks price and pests for this buyer" has zero published confirmation. The 5 design-partner interviews (guide ready in RESEARCH-customer-demand §f; owner and manager separately; Q1–Q2 decide) MUST run before any public rebrand.

## 3. GTM — sell through the layer above

1. **Exporters/packhouses** (highest ceiling): "supplier records pilot" with whoever buys the reference farm's dates → one exporter mandate = many farms. **Build once, serves three channels:** the GlobalGAP/export-ready records export (rides SPEC-0016).
2. **Agronomist/GlobalGAP consultants** (Agworld pattern — they adopt for their own multi-farm workflow): free multi-farm consultant accounts for 2 pilots. FAO TCP/EGY/4002 is training 150 engineers across 10 date zones now — a target list.
3. **The lighthouse**: the Ebeid farm's printed **before/after ledger** (real spend, shortages avoided, per-palm cost) + quarterly open days (flagship at harvest) + seed a "مديرو مزارع النخيل" WhatsApp community (none exists).
4. **Arabic content/SEO/YouTube**: the palm-management SERP is near-empty; 5 cornerstone articles + phone-shot videos from the real farm; 2 articles + 1 video/month cadence.
5. **Programs** (credibility, not revenue): FAO phase-2 record-keeping layer pitch; Khalifa Award entry; Siwa festival; Buraidah (KSA) later.
6. **Deprioritize:** input dealers (misaligned incentives). **Park:** ag banks/insurance.

**Services-led:** sell **"إدارة سجلات المزرعة كخدمة"**, not software. Four hard rules: explicit expensive setup fee (the headline number); never label human work as automation; fixed-scope onboarding capped at 2–3 concurrent; design the DFY→DIWY hand-off (train the farm's clerk) so **founder-hours/farm decays** — that decay is the SaaS conversion.

## 4. Pricing deltas (vs. current per-farm EGP + paid onboarding)

Keep the structure. Change: **15–40k EGP/yr all-in** (no per-module à la carte) · setup fee = the big number, **repriced every season** · **harvest-aligned billing** (deposit at signup + balance after harvest — no vendor anywhere does this; microfinance evidence de-risks it) · annual repricing clause vs EGP devaluation, collect cash up front · family/holding deals per-farm + group discount + one owner dashboard · **"your data, exportable anytime"** pledge · **drop** outcome-based pricing (unmeasurable baseline); use outcome-based *marketing* (the named ledger) instead.

## 5. The 12-month sequence

| Quarter | Motion |
|---|---|
| **Q1 (Jul–Sep 2026)** | Ebeid before/after ledger · GlobalGAP/export records export (the wedge feature) · 5 cornerstone Arabic articles + 2 videos · 2 consultant partners · reprice per §4 · **run the 5 design-partner interviews** |
| **Q2 (Oct–Dec 2026)** | Harvest-season lighthouse open day → 3–5 farms at full price (cap 2–3 onboardings) · WhatsApp community seeded · 3 exporter pitches → 1 LOI · FAO/Khalifa contacts · Siwa festival |
| **Q3 (Jan–Mar 2027)** | Exporter-pilot supplier farms onboarded · DFY→DIWY hand-offs (founder-hours/farm must trend down — if not, stop adding farms and fix the hand-off) · second open day · first family-holding deal |
| **Q4 (Apr–Jun 2027)** | **First renewal cohort with post-harvest ledgers = THE metric** (renewal is the willingness-to-pay evidence that doesn't exist in the literature) · exporter pilot converts to paid mandate or dies · 2–3 named Arabic case studies · KSA prep: Buraidah (Aug 2027) booked, SAR pricing, Qassim/Madinah conversations |

**Exit criteria at month 12:** 10–15 paying referenceable farms · ≥1 exporter mandate in motion · renewal rate known · founder-hours/farm decaying · top-3 Arabic SERP on category keywords · a KSA entry date. **Not 100 farms — 15 referenceable ones.**
**Honest pivot rule:** if renewals fail despite the ledgers, the primary model becomes exporter-paid (the Cropin/Pula pattern), not farm-paid subscriptions.

## 6. Failure patterns on watch

1. Unvalidated WTP for records-as-such → tie every renewal to the season ledger; attach to compliance pull. 2. Founder = only salesperson → channels 1–2 multiply him; cap onboardings. 3. Season-misaligned billing churn → §4 harvest billing. 4. Services burying the software (Bench/ScaleFactor) → the four hard rules. 5. Feature sprawl chasing top-down deals → ONE wedge artifact (the records export) serves exporters + consultants + certification. Watch item: a subsidized state platform à la KSA NCPD appearing in Egypt — the FAO relationship is the early-warning system.

## 7. What changes in STATUS.md priorities

Nothing displaces the top (accountant/ETA meeting, Stage 0, real registry import — real data remains the precondition). Deltas: **(i)** the OS-ification lane P1–P5 becomes the first build lane after real data, ahead of most Season-1 features; **(ii)** the GlobalGAP/export records export jumps the queue (product + channel simultaneously); **(iii)** the 5 design-partner interviews are scheduled NOW, in parallel with everything.

## 8. Decision asks (Owner)

1. Approve the repositioning *direction* pending interview validation (no public rebrand yet).
2. Approve the OS-ification lane order (P1–P5) as the post-Stage-M build queue; P1's expense-posting rule is a money decision — decide the posting convention (per-execution `operating` expense, category from item).
3. Approve running the 5 design-partner interviews with the §f guide (who: 5 medium/large date farms; when: before harvest).
4. Approve the pricing deltas (§4) for the next signed farm.
5. Pick the first exporter/packhouse to pitch (whoever buys the farm's dates).
