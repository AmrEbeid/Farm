# Market Research — Self-Serve Control Panel & Per-Feature Best Practices

**Date:** 2026-06-26 · **Status:** research / design input (un-gated) · **Owner to ratify**

> Goal (per Owner request): the **control panel should let the customer set up *everything* in the system themselves**. This doc benchmarks Farm OS against the real market, captures best practice per feature/page, and recommends what to build — prioritized, with what the customer self-configures. Research only; nothing built or merged.

---

## 0. Executive summary & positioning

Across the agriculture-software market, **no incumbent combines all four of** *(Arabic-RTL-first + multi-tenant + date-palm domain + deep owner-operated self-serve admin)*:

- **Cropin, FarmERP** — broad + have Arabic, but heavyweight and **configured by the vendor**, not self-serve.
- **Platfarm, AGRXAI** (MENA/date-palm focused) — lead with **IoT**, not customer self-configuration. AGRXAI notably ships full Arabic + RTL + localized units/terminology — proof MENA buyers expect locale-first, not a translation layer.
- **Agworld, Agrivi, Conservis, AgriWebb, Farmbrite** — strong Western FMS, no MENA/RTL.

**Farm OS's wedge = the self-serve, white-label, Arabic-first control panel** on top of two existing differentiators the research confirmed are ahead of market:
1. **Fine-grained scope hierarchy** (farm → sector → hawsha → line → palm) — competitors stop at field/block.
2. **5-gate pre-flight check** on plans (stock/budget/weather/labor/responsibility) — rare in agri-software, well-established in CMMS/field-service.

**The headline principle for the control panel:** *everything the customer configures should be **data, not code*** — templates, calendars, thresholds, roles, rates, registries — editable by the Owner with no developer in the loop.

---

## 1. Control Panel / Settings — "set up everything" (the headline ask)

### Market best practice
- **Onboarding as a system, not a screen.** Orient → Activate → Reinforce; target **time-to-value < 5 min**; map each wizard step to a *real* workspace task (not a demo); progress bars/checklists lift completion 20–30%. First user becomes Owner by default — make that explicit. (WorkOS, DesignRevision)
- **Org/profile settings:** locale (ar/en), currency (EGP base), units, and **editable terminology/labels** are table-stakes for white-label. (AGRXAI validates demand.)
- **RBAC:** small canonical set of system roles + optional per-tenant custom roles; a **"compare roles / permission-diff" view**; **enforce at the API/service layer, not just UI.** (WorkOS, Permit.io)
- **Template management:** Cropin's customer-defined workflows/dashboards is the benchmark — let tenants define their own operation/budget/stock templates.
- **User invitation & management; white-label branding** (logo/colors/typography + per-tenant feature toggles); **guided CSV import**; **tenant-isolated audit log** visible to the Owner. (EnterpriseReady, Developex)

### Recommendations — what the Owner self-configures
**Must-have (V1):**
- **Guided setup wizard** (Arabic-first, RTL): create farm → sectors/hawsha → invite users & assign roles/scope → **import palm registry + opening stock (CSV)** → create first operation template. Checklist + progress; < 5-min TTV; every step persists *real* data.
- **Org settings:** locale, currency, units, **editable terminology/labels** ← the differentiator vs Cropin/FarmERP.
- **RBAC editor:** system roles (Owner → Worker) **scoped by sector** + permission-diff view; server-side enforcement.
- **Template manager:** operation, budget, and stock/reorder templates the Owner defines and clones.
- **User & invitation management**; **tenant-isolated audit log** for the Owner.

**Nice-to-have (V2):** custom roles; theme/branding builder with live preview; per-tenant feature toggles; SSO/SCIM; multi-currency; API-driven config.

**Pitfalls to avoid:** UI-only RBAC (enforce at API); role-name sprawl (keep a canonical set); demo-style wizards that don't persist real data; treating Arabic/RTL as translation vs locale-first; cross-tenant audit-log leakage.

---

## 2. Inventory & Stock-Coverage

**Where Farm OS already leads:** reservations/allocations against plans (≈ MRP demand-pegging) and the **PAB projected-available-balance curve flagging first-shortage date** — most ag tools lack this.

**Best practice (Zoho/Odoo/NetSuite/SAP; Agrivi/FarmERP/Conservis/Cropin for ag):**
- **Reorder point** derived, not typed: `ROP = (avg daily demand × lead-time days) + safety stock`, with `safety stock = Z × σ_demand × √lead-time` (Z = service level, e.g. 1.65 ≈ 95%).
- **Min/Max replenishment** (simplest, farmer-friendly); **EOQ** as nice-to-have.
- **Lot/batch + expiry with FEFO** and pre-expiry alerts — *critical* for agro-chemicals; a differentiator Farm OS should lean into.
- **Multi-location stock** (store-room per farm/site) with transfers.

**Recommendations:**
- *Must-have:* lot/batch + expiry (FEFO) + alerts; Min/Max; safety-stock-aware reorder point; multi-store stock.
- *Nice-to-have:* EOQ suggestion; statistical (service-level) safety stock; seasonal demand curves.
- *Owner self-configures:* per-item reorder/min/max, lead-time days, service level or flat safety stock, unit cost, expiry-alert lead days, storage locations, units of measure.

---

## 3. Purchase Requests / Procurement

**Best-practice flow:** Requisition (PR) → approval → **PO** → **GRN (goods receipt)** → invoice → **match** → pay. (NetSuite, Procurify, Precoro)

- **Threshold-driven approvals** — auto-approve small amounts, escalate large; Owner-only is fine for a single-owner farm but should become amount/category-driven.
- **Partial receipts** — track received-qty per line, keep PO open for the balance, allow multiple GRNs.
- **Two-/three-way match with tolerance** — for a farm, two-way (PO↔GRN) is the pragmatic floor.
- **Supplier records** (contacts, price history, **lead time** → feeds inventory calc); **budget-remaining check at approval** (Farm OS already links PR → budget category + shortage reason — a strength).
- **Skip** for farms: formal RFQ/tender, multi-bid sourcing, contract catalogs, 4-way matching.

**Recommendations:**
- *Must-have:* explicit **GRN + partial receipts** with open-PO balance; **threshold-based approval**; supplier records with lead time; budget-remaining check at approval.
- *Nice-to-have:* two/three-way match w/ tolerance; supplier on-time scoring; one-click shortage→PR; PO encumbrance against budget.
- *Owner self-configures:* approval thresholds & approver per tier, budget categories/limits, supplier list, match tolerance %, GRN-required toggle, default tax/payment terms.

> Note: SPEC-0009 (goods-receipt partial receipts) already exists — this research corroborates it as must-have.

---

## 4. Plans & Operations (planning + field execution)

**Where Farm OS already leads:** the scope hierarchy and the 5-gate pre-flight pattern.

**Best practice (Agworld/Agrivi/AgriWebb/Climate FieldView; CMMS for work-orders):**
- **Templates + copy-forward** are table-stakes — add **save-actual-as-template** and **clone-plan-to-next-period**.
- **Crop/phenology calendar** that auto-suggests operations by palm growth stage (pollination window, dethorning, harvest passes) — a current gap.
- **Recurring/calendar-driven operations** (e.g. irrigate every N days) + auto-generate (CMMS PM model).
- **Operation-aware gating:** strict weather thresholds for **spraying** (wind/rain → drift/wash-off), lax for inspection.
- **PHI/REI safety gate** — block harvest/entry within the label **pre-harvest / re-entry interval** after a spray. *Compliance- and export-critical* (residue limits).
- **Field capture:** offline-first + QR/GPS + photo/voice already matches best practice (QField/ArcGIS Field Maps bar). Add **icon-driven near-zero-typing** Arabic UX, **conditional forms** per subtype, **per-subtype checklists**, and **crew (not just individual) assignment**.
- **Planned-vs-actual:** weekly, field-level; flag the three high-impact variances — **input-rate deviation, unscheduled extra passes, labor overruns in peak windows.**

**Recommendations:**
- *Must-have:* PHI/REI gate; operation-aware weather gate; recurring/calendar-driven ops from a crop calendar; save-as-template + clone-to-next-period; auto-reorder alert on execution; crew assignment + per-subtype checklists.
- *Nice-to-have:* conditional execution forms; variance dashboard per scope node; geofence auto-verify GPS vs target.
- *Owner self-configures:* operation templates (materials/labor/equipment/cost/checklist), crop/phenology calendars, gate thresholds (budget tolerance %, wind/rain limits per subtype, labor min, **per-pesticide PHI tables**, reorder points), crews/teams.

---

## 5. Finance — Accounting / Sales / P&L  *(SPEC-0004, not yet built)*

**Best practice (Conservis, Figured, Granular, Traction Ag; CPA guidance):**
- **Field/enterprise-level cost capture** rolling up to profitability; budget **at the field level** so every input ties to a field.
- **Two-tier cost model:** direct costs booked to a crop/field cost-center; overhead allocated by a driver — **area (feddan) or tree-count** for orchards.
- Report **cost-of-production per unit** (per crate/kg), not just cost-per-feddan — the true profitability metric.
- **Perennial/tree-crop specifics (key for date palms):** establishment costs during the multi-year **pre-production period are capitalized as an asset and amortized** over productive life — needs a **CapEx vs OpEx** distinction, not just expenses.
- **Sales/revenue link:** harvest → inventory (qty/grade) → sale (price × qty) → revenue tagged to the same crop/season dimension as costs.
- **Don't rebuild a GL** — sync to mainstream accounting (Figured↔Xero model; QuickBooks/Zoho Books/Odoo common in MENA). **Egypt:** note **ETA e-invoicing**, EGP base, Arabic chart of accounts.

**Recommendations:**
- *Must-have:* sales/revenue linked to harvest+inventory; receipt/payment vouchers; **crop + season dimensions** on every expense/sale/budget line; two-tier cost model; live budget actuals (variance); **P&L by sector/crop/season**.
- *Nice-to-have:* owner-drawings classification (equity, excluded from P&L); per-feddan & per-tree unit costing; CapEx vs OpEx flag w/ multi-year amortization; QuickBooks/Xero/Zoho/Odoo sync; ETA export.
- *Owner self-configures:* chart of accounts (Arabic), cost centers (sectors/fields), overhead allocation driver, season calendar, voucher numbering.

---

## 6. People, Labor & Payroll  *(SPEC-0006, not yet built)*

**Best practice (FarmRaise, Seso, AgriERP, Croptracker; FarmERP):**
- **Three wage models in one system — daily, hourly, AND piece-rate.** Date farming is piece-rate-heavy (per palm pollinated, per crate harvested); piece-rate is the key labor-productivity lever.
- **Field-grade attendance** (mobile, possibly biometric) feeding wage calc; **crew/gang** management — log work by crew → task → field/crop, which also **feeds labor cost into the crop P&L** (§5).
- **Egypt/MENA compliance (configurable, not hardcoded):** Social Insurance Authority registration (~18.75% employer / ~11% employee on banded salary); 2025 Labor Law covers seasonal/informal via fixed-term contracts; agriculture has special minimum-wage treatment. Build configurable rates/bands.
- **PII/confidentiality:** wages are sensitive — restrict payroll visibility to Owner/Manager, separate from the general people directory. *(Corroborates the PII-1 finding, issue #173.)*

**Recommendations:**
- *Must-have:* labor logs (worker/crew → task → field/crop → date); piece/daily/hourly wage calc; attendance tied to logs; payroll run → payslips; **role-gated payroll visibility**.
- *Nice-to-have:* crew/gang grouping; mobile/offline entry; per-worker piece-count quality; auto-feed labor cost into crop P&L; configurable social-insurance engine; bilingual (Arabic) payslips.
- *Owner self-configures:* wage rates per task/piece, pay periods, crew rosters, contribution rates/bands, contract types (seasonal/permanent).

---

## 7. Weather, Care Academy, AI Assistant, IoT  *(SPEC-0005/0007/0008, not yet built)*

### Weather (SPEC-0007)
- **Advise, don't hard-gate.** Surface spray windows (48h wind/rain/temp), heat/dust/wind alerts (pollination disruption matters more than frost in MENA), GDD, ET-based irrigation — as **overridable recommendations** with a reason ("wind 25 km/h — drift risk"). Hard-gating on a forecast is risky given MENA data sparsity.
- **APIs for Egypt (sparse ground stations → model/satellite-blended):** **Tomorrow.io** (AI hyperlocal, 14-day) as primary; **Meteoblue Agro** (soil/veg, arid-tuned); **Open-Meteo** (free, returns GDD & ET — great for MVP); **OpenWeather** fallback.

### Care Academy (SPEC-0008) — the liability line
- Ship **editable advisory templates**, NOT prescriptions. Recommending an unregistered/prohibited pesticide creates liability (EPA/agronomy-law guidance).
- Require a **licensed-agronomist + local-registration sign-off** before any pesticide name/dose surfaces; store a **per-tenant pesticide registry** so only locally-registered products appear; never auto-prescribe doses.
- **Date-palm templates anchored to FAO GAP/IPM (active in Egypt):** pollination (2+ passes, 2–4 day intervals), bunch thinning (~10 leaves/bunch), harvest at Tamar ~200 days post-pollination, **RPW monitoring** (pheromone traps + inspection cadence) — age/stage templates the Owner edits per cultivar.

### AI Assistant — عبدالجليل (SPEC-0005)
- **RAG over the tenant's own data + Care Academy KB**, citing the source record/template.
- **Refuse to invent numbers**; **permission/role-aware** (worker can't see financials); **read-only** by default; pesticide queries route to the sign-off-gated registry. *(Matches SPEC-0005's trifecta-safe design.)*

### IoT (future)
- Highest-ROI for an Egyptian date farm: **RPW acoustic/seismic sensors** (TreeVibes, Agrint IoTree) — detect in-trunk activity before visible signs. Start with **networked pheromone-trap logging** (cheap, manual); add acoustic sensors on high-value/older palms later; soil-moisture + station for ET irrigation when budget allows. **Design hooks now, deploy later.**

**Owner self-configures:** farm location/elevation, weather alert thresholds, cultivar care templates & calendar dates, the locally-registered pesticide list (with agronomist sign-off).

---

## 8. Consolidated priority view

| Area | Must-have (V1) | Nice-to-have | Future |
|---|---|---|---|
| **Control panel** | Setup wizard; org/locale/terminology; RBAC editor (sector-scoped, API-enforced); template manager; user mgmt; tenant audit log | Custom roles; theme builder; feature toggles; SSO/SCIM | API-driven config |
| **Inventory** | Lot/expiry FEFO; Min/Max; safety-stock ROP; multi-store | EOQ; statistical safety stock | Seasonal forecasts |
| **Procurement** | GRN + partial receipts; threshold approvals; suppliers; budget check | 2/3-way match; supplier scoring; PO encumbrance | — |
| **Plans/Ops** | PHI/REI gate; op-aware weather gate; crop-calendar recurring ops; save/clone templates; crews + checklists | Conditional forms; variance dashboard; geofence verify | — |
| **Finance** | Sales+vouchers; crop/season dims; 2-tier costing; live actuals; P&L by sector/crop/season | Drawings; per-tree costing; CapEx/amortization; accounting sync | ETA e-invoice |
| **Payroll** | Labor logs; piece/daily/hourly; attendance; payslips; role-gated PII | Crews; offline entry; cost→P&L feed; SI engine | — |
| **Weather/Agronomy/AI** | Open-Meteo/Tomorrow.io advisories (overridable); advisory care templates; pesticide registry + sign-off; RAG AI (role-scoped, no fabricated numbers) | DEWS pest-risk; GDD stage progression; trap logging | RPW acoustic sensors; soil probes |

> **Cross-cutting non-negotiable:** every "self-configure" item above is **data the Owner edits**, never code — this is what makes the control panel deliver on "set up everything."

---

---

# Part II — Remaining pages (full screen-map coverage)

*Second research pass covering every screen not in Part I: role dashboards, farm mapping/registry, issues/inspections, reports/notifications, accountability routing, and cross-cutting platform features.*

## 10. Role-based dashboards (6 homes)

**Best practice:** persona-first; **4–8 KPIs per role** (5–7 is the overload ceiling); **5-second / inverted-pyramid** layout (big numbers top-left, trends middle, detail bottom); only show a KPI if its owner can *act* on it; **overview-first, details-on-demand** (drill-down drawers keep context); push threshold alerts instead of manual checks. Information overload is the #1 dashboard failure (~47% of users). (Klipfolio, NN/g, Pencil & Paper, Den Otter)

**How agri does it:** Cropin Grow models C-suite/supervisor/field-user/farmer roles with customizable dashboards; Conservis does field-level profitability for owners + a plans→work-orders mobile flow for managers/field. None foreground an **approvals-first owner home** — a Farm OS differentiator.

**Config best practice:** **hybrid** — strong role-based fixed defaults + optional show/hide/rearrange for desk roles; keep the **supervisor mobile layout fixed** (no drag-drop); let the Owner set **targets/thresholds/alert rules** per metric.

| Role | Must-have (top row) | Nice-to-have |
|---|---|---|
| **Owner** | Pending approvals first (approve-in-place), profit-to-date, sales vs expense, critical issues/stock risks, best/worst sector | Weather risk, delayed ops, drill to sector P&L |
| **Manager** | This-week plan + blocked ops, stock readiness, labor availability | Weather windows, open follow-ups |
| **Supervisor (mobile)** | Today's tasks by sector; 3 big icon buttons (Record/Issue/Stock); sync status | Voice input, photo, offline-queue count |
| **Engineer** | Disease reports, inspection tasks, treatment follow-ups | Age-based care priorities, weather risk |
| **Accountant** | Pending approvals, expenses/sales, budget variance, supplier balances | Vouchers, PRs, cash-flow trend |
| **Storekeeper** | Items below reorder, stock levels, purchase needs | Reservations, expiry risks, movements |

*Owner self-configures:* KPI targets/thresholds, which optional widgets show per role, alert rules + channels. *Keep fixed:* supervisor mobile layout, approvals-first ordering, the must-have KPI set.

## 11. Farm map / structure & per-tree registry (SPEC-0003)

**The key design axis is vine-level vs block-level.** Mainstream FMS map the **field polygon** as the atom (Climate FieldView, OneSoil, EOSDA, Agworld). But the right analogs for date palms are **orchards/vineyards**, which track **each asset**: Aerobotics & SeeTree give every tree a GPS identity + "medical record"; vineyard tools (Sentinel, Vinea, UvaLink) use **row×position addressing** ("row 14, vine 32") that works **with no GPS coordinates at all**. Farm OS's 4,380-palm registry is firmly **vine-level — the correct premium choice.**

**No survey GPS? That's the norm, not a compromise.** Automated boundary detection fails on small irregular MENA fields; farmer sketch maps are an accepted method. Recommended layered model:
- **Mode A — grid (default):** Owner enters hawsha + rows×positions; palms auto-placed on a logical lattice. No GPS.
- **Mode B — croquis:** free-form sketch of sector cards/polygons with palm counts.
- **Mode C — GPS (later upgrade):** pin-drop or import polygons — *without re-modeling*, because identity lives in the logical address, not coordinates.

**Living activity file = CRM/EHR single-record timeline,** best built **event-sourced/append-only**: each event (operation, issue, treatment, photo, stock-usage, cost, follow-up) is an immutable typed record keyed to scope-id+level; the **same timeline component renders at all 5 scopes** by aggregating children upward (free audit trail + cost roll-ups). **QR per palm/sector** with the code embedded resolves **offline**. Mapping tech: **Mapbox GL or Leaflet** (ESRI is overkill).

*Must-have:* grid mode default; vine-level registry + append-only timeline; offline QR; status-colored palm grid with drag-to-select line ranges; one timeline component across 5 scopes. *Nice-to-have:* croquis mode; optional GPS pins + offline tiles; registry CSV import; configurable status taxonomies. *Future:* satellite/NDVI; drone/AI per-tree health; RFID tags. *Owner self-configures:* sector/hawsha layout & counts, grid dimensions, registry import, QR batch print, status taxonomy. **No mature Arabic date-palm per-tree registry exists in MENA — a genuinely open niche.**

## 12. Issues / notes / inspections (scouting)

**Pattern: customizable scouting templates, not fixed forms** (FarmQA, Croptracker, Agrivi); photo + geotag are table-stakes; the real edge is **threshold tracking over time** (e.g. RPW trap counts trending to an action threshold), à la Cropin DEWS.

**AI image diagnosis — advisory only.** Plantix/Agrio claim >90% lab accuracy but field accuracy drops (~88% uncontrolled), and **RPW is largely internal to the trunk** so photo diagnosis is fundamentally weak (literature leans on acoustic/thermal). **AI should pre-fill the "type" field as a labelled suggestion, never auto-trigger treatment.** Pesticide application carries liability → requires Engineer (agronomist) sign-off. *Trust AI for triage speed; distrust it for RPW early-stage and any dose.*

**UX:** true **offline creation** (not just cached forms); Arabic **voice-to-text + photo** as primary inputs; auto-context pre-fill (GPS→nearest palm via QR, weather, palm age, recent ops, responsible person) so the supervisor taps minimally; visible draft queue. **Routing:** borrow SafetyCulture Actions — a flagged item spawns a corrective action **carrying its evidence**, assigned to a **group/queue (more resilient than an individual)** with due date, status, resolve/reopen, completion photo; support **link issue → follow-up treatment/operation.** **Cadence:** recurring inspections; RPW = **traps serviced every 7–14 days, palms inspected weekly**, ~0.5–1 trap/ha (FAO).

*Must-have:* offline voice+photo+auto-GPS/QR capture; owner-configurable issue-type/severity/pest catalog (RPW front-and-center); auto-context pre-fill; auto-assign to role/group w/ escalation + resolve/reopen; issue→follow-up link. *Nice-to-have:* threshold-trend alerts; recurring trap/inspection schedules; AI "suggested type." *Future:* predictive risk layer; acoustic/thermal RPW sensing. *Owner self-configures:* issue/severity taxonomy, pest catalog, routing rules, inspection schedules, AI-suggestion on/off.

## 13. Reports, exports & notifications

**Catalogue, not a builder (yet).** Agri-SMB norm is a curated report library (Agrivi exports PDF/Word/Excel; Farmbrite = fixed reports + grid export). The must-have is a **parameterised catalogue** (date range, sector/crop filter); a full custom builder is *future*. Zoho's model (40+ standard + **scheduled email delivery to users and non-users**) is the template.

**Arabic-RTL export is the hard part.** PDF needs font-with-Arabic-glyphs + **bidi** + **glyph shaping** — ReportLab RTL is only experimental (v4.4.0), react-pdf has no native RTL. **Most reliable = HTML-template → headless Chromium (Puppeteer/Playwright)**, which handles bidi/shaping natively; embed an Arabic webfont + RTL CSS. Excel: set RTL sheet direction but **wrap numbers/dates/Latin IDs in LTR marks**; apply explicit EGP `#,##0.00 "ج.م"` + Egypt locale.

**WhatsApp summaries** (big in MENA) are viable as an **opt-in utility template + PDF document header**; outside the 24h window only pre-approved templates send, explicit opt-in mandatory, per-message pricing since Jul 2025. **🔒 At-scale WhatsApp/email outbound is a sensitive action — gate behind Owner approval + stored per-recipient opt-in + rate limits + audit.**

**Notifications:** match format to severity (toasts for passive, modal only for action-required); **3 tiers**; **batch/digest** to fight fatigue; **per-user prefs + mute/snooze** across channels. **Embedded BI** (Metabase/Superset) is heavy for small multi-tenant + fights Arabic-RTL → keep **hand-built server-rendered reports** now.

*Must-have:* parameterised report catalogue → Arabic-RTL PDF+Excel via headless-Chromium; role-gated finance reports; notifications drawer (3 tiers) + toasts + prefs/mute; WhatsApp summary as opt-in template (manual send). *Nice-to-have:* scheduled delivery; digest/batching; timestamped audit-ready PDF archive. *Future:* custom report builder; embedded BI. *Owner self-configures:* enabled reports, parameters, schedules, recipients, channels, notification prefs.

## 14. Accountability routing & cross-cutting platform

**Accountability:** model as **RACI** (exactly one Accountable per scope) + auto-routing borrowed from on-call/ticketing/dispatch. Farm OS's "person × activity-type × scope" *is* the field-dispatch routing key. **Resolve most-specific scope first** (sector → zone → farm-wide) with an explicit **fallback chain: assigned person → team/group (load-balanced) → Manager → Owner**, each hop on an **escalation timeout**; keep **manual reassignment override**. Missing fallback contacts are the #1 on-call misconfiguration. (PagerDuty, Zendesk, Salesforce FS; note Opsgenie EOL 2027.)

**Cross-cutting best practice:**
- **Auth/org-switch:** one identity → many orgs via join table; **active org_id in the JWT** (validated against membership, can't be spoofed); refresh token on switch; RLS columns indexed.
- **Role-aware nav:** hide what a role can't use, but **always re-check server-side/RLS** (hiding a menu ≠ blocking the URL); prefer capability checks over hardcoded role names.
- **Global search:** ⌘K command palette across entities, **permission-scoped to active org+role**; for Arabic, **normalize** (strip tashkeel/tatweel, fold hamza/alef) — Postgres `unaccent` + custom function covers it without Elasticsearch.
- **Audit-on-write:** capture actor/action/time/resource/tenant/**before-after diff**/IP; write **in the same transaction** (not fire-and-forget); add **HMAC hash-chain** for tamper-evidence; strictly tenant-isolated; surface to Owner as a filterable timeline.
- **Offline-first sync:** local SQLite (**WatermelonDB**) + delta sync + per-form sync queue with status badge; **last-write-wins** acceptable for independent field reports, manual reconciliation only for shared records.
- **Toasts vs drawer:** toasts = transient self-action confirmations; drawer = persistent history + unread badge (new assigned issue → drawer + badge).

*Must-have:* scope×type responsibility matrix (single Accountable) + rule-based routing with fallback chain + escalation timeout; transactional tenant-isolated audit-on-write; JWT active-org + indexed RLS; server-enforced permission nav; offline draft+sync badge; toasts + drawer. *Nice-to-have:* ⌘K Arabic-normalized permission-scoped search; load-balanced team assignment; HMAC audit chain; drag-drop manual reassign. *Future:* time-based on-call schedules; CRDT conflict merge; skills/equipment-aware routing; audit export to immutable storage. *Owner self-configures:* responsibility matrix, routing/escalation/fallback rules, roles + nav/permissions, search scope.

## 15. Consolidated priority view — Part II

| Page/feature | Must-have (V1) | Nice-to-have | Future |
|---|---|---|---|
| **Role dashboards** | 4–8 actionable KPIs/role; approvals-first owner; fixed low-typing supervisor home; targets/alerts | Show/hide widgets for desk roles; trend drilldowns | Predictive risk widgets |
| **Farm map/registry** | Grid-mode default (no GPS); vine-level registry + append-only timeline; offline QR; status grid | Croquis mode; GPS pins + offline tiles; registry CSV import | NDVI/satellite; drone per-tree AI; RFID |
| **Issues/inspections** | Offline voice+photo+QR capture; configurable taxonomy/pest catalog (RPW); auto-assign+escalate; issue→follow-up | Threshold-trend alerts; recurring schedules; AI "suggested type" | Predictive risk; acoustic/thermal RPW |
| **Reports/notifications** | Parameterised catalogue → Arabic-RTL PDF/Excel (headless-Chromium); role-gated finance; drawer+toasts+prefs; WhatsApp opt-in template | Scheduled delivery; digest/batching; audit-PDF archive | Custom builder; embedded BI |
| **Accountability/cross-cutting** | RACI matrix + routing w/ fallback+timeout; transactional tenant-isolated audit; JWT org-switch + indexed RLS; server-enforced nav; offline sync; toasts+drawer | ⌘K Arabic search; load-balanced assign; HMAC audit chain; manual override | On-call schedules; CRDT merge; skills routing |

> Same non-negotiable as Part I: every "self-configure" item is **data the Owner edits, not code.**

## 9. Sources (selected)
Cropin · FarmERP · Agrivi · Conservis · Agworld · AgriWebb · Farmbrite · **Platfarm** · **AGRXAI** · Palmear · WorkOS (RBAC) · Permit.io · EnterpriseReady (audit) · DesignRevision (onboarding) · Developex (white-label) · Zoho/Odoo/NetSuite/SAP (inventory) · Procurify/Precoro/NetSuite (procurement) · Climate FieldView · QField · ArcGIS Field Maps · NPIC/Keep-It-Clean (PHI) · eMaint/ClickMaint/FTMaintenance (CMMS) · Figured/Traction Ag · Farm & Ag CPA · AccountingTools/UC-Davis (orchard costing) · FarmRaise/Seso/AgriERP/Croptracker · Papaya Global/EY (Egypt labor) · Tomorrow.io/Meteoblue/Open-Meteo/OpenWeather · FAO Egypt date-palm GAP/IPM · TreeVibes/Agrint/Koppert (RPW IoT).

**Part II adds:** Klipfolio/NN-g/Pencil&Paper/Geckoboard/Den Otter (dashboards) · PerformYard/Modeliks (farm KPIs) · DesignStudio/Gapsy/WizyVision (low-literacy field UX) · Aerobotics/SeeTree (per-tree) · Sentinel/Vinea/UvaLink (vineyard row×vine) · Mapbox/Leaflet/QField/ArcGIS Field Maps · Nutshell/InfoQ (timeline/event-sourcing) · FarmQA/Agrio/Plantix/Cropin DEWS (scouting/AI dx) · SafetyCulture/Fulcrum (inspections) · Frontiers/MDPI (field-AI accuracy, RPW sensing) · Agrivi/Farmbrite/Zoho/Odoo (reports) · ReportLab/react-pdf/Puppeteer (Arabic-RTL PDF) · Meta WhatsApp Business API docs · Knock/Courier/NN-g (notifications) · Metabase/Superset (embedded BI) · Atlassian/Asana RACI · PagerDuty/Zendesk/ServiceNow/Salesforce FS (routing) · Supabase/Clerk/Makerkit (multi-tenant auth+RLS) · WatermelonDB/PouchDB (offline sync) · lucene-arabic-analyzer (Arabic search) · PatternFly/LogRocket (drawer/toasts). *(Full URLs in the agent research logs.)*
