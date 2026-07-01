# MARKET-DELTA — external landscape refresh (2026-07-02)

*Web-researched delta vs the June-2026 internal research (docs 01/05, MARKET-RESEARCH-2026-06-26, PRICING-RESEARCH-89). Confidence: **[2+]** = ≥2 independent sources, **[1]** = single-source. Owner: Amr Ebeid.*

## 1. 🔴 URGENT — Egypt ETA e-invoicing assumption REFUTED

The roadmap treated ETA (Slice C) as "gated, maybe deferrable." That no longer holds:
- Resolution 281/2025 **halved the mandatory registration threshold to EGP 250,000 annual gross revenue**; registration deadline **2026-03-31 (already passed)**; tiered penalties (EGP 20k immediate + EGP 1k/day non-registration; up to EGP 10k/invoice; invoicing suspension); **QR codes mandatory on printed e-receipts**. **[2+]**
- Agricultural relief covers only small artisanal farmers/fishermen (Circular 53/2023) **[1]**. A farm grossing EGP 6–20M is ~25–80× the threshold.
- **Action (this month):** Owner's accountant determination (entity form matters — the drafted memo #578 is the input). Default assumption flips to **"probably obligated, deadline passed."**
- **Build posture:** integrate a submission layer (Daftra/Wafeq) — do NOT build native ETA submission (e-signature + legal maintenance burden).

## 2. Competitive delta

| Player | What changed | Implication |
|---|---|---|
| **Conservis → Traction Ag** | Acquired Conservis + Granular; $10M round (Coop Ventures, 2025) for enterprise farm accounting **[2+]** | Rename threat-watch entry. Still English/row-crop. Consolidation validates the plan+budget+inventory+**accounting** bundle as the commercial model. |
| **Zr3i (Egypt)** | 8.5M palms claimed; MoU with Khalifa International Award (UAE entry); bridge round; first credits 2027 **[2+]** | Still carbon-only — but they own the palm-owner relationship layer at scale. **Partner via read-only carbon-MRV data export** from the registry before they need ops features. |
| **Mazoon Soft (Oman)** — NEW | Arabic/English cloud palm-farm program: per-palm unique codes, per-palm expense/revenue, accounting, work teams, QR e-invoices **[1 — vendor site]** | **Weakens the claim "no Arabic per-tree registry in MENA."** Restate the wedge: coverage-engine + budget-gated approvals + Egypt statutory depth, Arabic at tree level. Do a demo teardown. |
| **KSA government stack (NCPD)** | e-farmer portal, Mozare marketplace, Murshiduk advisory — free, targets ≤500-palm smallholders; 2025+ subsidies require irrigation-rationalization certificate (شهادة الترشيد) **[2+/[1]** | **KSA white space = commercial farms 1k+ palms** (unserved by the free stack). "Subsidy-compliance-ready records" is a productizable KSA feature. |
| **Platfarm** | Confirmed Egypt+KSA date-palm focus, satellite/IoT axis **[2+]** | Remote-sensing lane, not an ops OS. (Repo's 07-01 deep review also tracks AGRXAI — no independent footprint found beyond that research **[1 — absence]**.) |
| **FarmERP** | No new date-palm product found 2025-26; still quote-only/vendor-configured **[1 — absence]** | Threat posture unchanged. |
| **AgriCash (Egypt)** — NEW | BNPL farm-input financing, interest-free ≤12mo, ceilings to EGP 3M, seed round 2025 **[2+]** | Input-financing wedge is now occupied (with Mozare3). **Partner/refer, don't build.** |

## 3. Practice/regulatory signals worth productizing

- **RPW digital reporting institutionalizing:** Egypt FAO+MoALR **SusaHamra** app (trap + inspection data → cloud mapping; national rollout 2023-25) **[2+]**; KSA C4IR+NCPD+WEQAA framework **[1]**. Not yet mandatory for private farms **[1 — absence]** → a SusaHamra-shaped export from the existing pest-scouting module is cheap future-proofing + a GTM story with extension services.
- **GlobalGAP for dates:** certification requires exactly the records Farm OS captures (irrigation, fert, pesticide+PHI, harvest, traceability, training) **[2+]** → an "evidence pack" report converts existing data into an export-enablement pitch.
- **Egypt water:** EGP 17.5bn FY25/26 into agriculture/irrigation modernization against a ~7bn m³ deficit **[2+]** → water-m³ per irrigation op + per-feddan report aligns with subsidy/finance narratives (and equals KSA's ترشيد metric). No IoT needed.
- **FAO: 2027 = International Year of the Date Palm** (Saudi proposal) **[1]** → free 2027 GTM hook; time KSA entry to it.
- **Discovery channels Egypt:** WhatsApp/Facebook groups + agronomist/extension networks **[2+]** → supports the white-glove GTM and the WhatsApp field layer (SPEC-0022).

## 4. Pricing

No new published MENA farm-SaaS price points; FarmERP remains quote-only **[2+ absence]**. PRICING-RESEARCH-89's guidance stands (main band 20–40k EGP/yr per farm; Pro 48–96k flagged too high). KSA note: pricing power only at 1k+ palms (government serves below free).

## 5. Do-NOT-build (reconfirmed + new)

CV/AI bunch counting (research-stage; manual counts give the same forecast) · input BNPL (AgriCash/Mozare3) · in-house carbon MRV (Zr3i) · labor marketplace (cold-start) · RPW acoustic/IoT hardware (Palmear/FarmSense exist; stay sensor-agnostic) · live date-auction price feeds (no public APIs; manual benchmark field suffices) · native ETA submission engine · bank feeds/multi-entity consolidation · IAS-41 bearer-plant accounting near-term.

## 6. Verdict on the wedge

**Validated with one restatement.** Nobody found doing coverage-vs-plan run-out forecasting in Arabic with budget-gated approvals. But "only Arabic tree registry" is no longer literally true (Mazoon Soft). The moat = **the engine + approvals + statutory depth + (Season 1) the season-cycle spine (SPEC-0021)**, with the WhatsApp field layer (SPEC-0022) as the adoption weapon.
