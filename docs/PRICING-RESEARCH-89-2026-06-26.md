# Pricing research — per-farm EGP anchors (issue #89)   ·   2026-06-26

*Decision-support only. Read-only market research; **no commercial decision is made here** — the
per-farm EGP price + setup fee are an Owner-only call (CLAUDE.md "Owner & approvals") and need the
**5 design-partner interviews** ([`05-gtm-pricing.md`](05-gtm-pricing.md) next-actions) to finalize.
This memo arms that decision with comparable evidence. Companion to [`05-gtm-pricing.md`](05-gtm-pricing.md)
and the [`OWNER-DECISIONS-2026-06-24.md`](OWNER-DECISIONS-2026-06-24.md) pricing item.*

## 1. The question
What per-farm EGP subscription price + setup-fee anchors should Farm OS test for the reference
tenant (~60 feddan, 4,380 برحي)? Constraint (non-negotiable #3): **per-farm EGP, never per-seat.**

## 2. What the market shows (cited)

**Per-farm / per-area is the norm; per-seat is the outlier.** Across MENA and global farm-management
SaaS, pricing is per-farm-flat or per-area (per-feddan/acre/hectare). Per-seat appears only in
Croptracker ($27.50/user, 10-user min) and FarmERP ($600/user/yr) — both ill-suited to a farm with
few office users + many seasonal field workers. The per-farm players (Farmbrite, AgriWebb, Agworld,
Climate FieldView) deliberately **bundle users** and tier by **features/modules**. → Farm OS's
per-farm constraint matches convention; per-seat is correctly ruled out.

**Closest regional comparable — Zr3i (زراعي):** Egypt, Arabic/RTL, date-palm focus; **free up to 10
feddan**, paid subscription price **unpublished**; also earns carbon-credit revenue. No published EGP
per-farm subscription price exists from any direct Egyptian competitor — a genuine gap that only the
interviews can close.

**Global published flat per-farm bands (USD/yr):** Farmbrite $290–$1,090; Climate FieldView Plus $649;
Trimble Core→Pro $199→$1,788. Per-area tools: Cropio $1–5/ha/yr, Farmonaut ~$2.7–6.6/acre–ha/yr.
Enterprise (Cropin/AGRIVI/Conservis/Granular) = contact-sales, opaque.

**Egyptian SMB B2B SaaS bands (EGP/yr, local tools — Daftra, Edara, Odoo, Optify):**
- Entry/micro: **~2,400–6,000** (Daftra Basic ~5,900; Optify from ~2,500)
- Mid SMB: **~12,000–24,000** (Daftra Premium ~23,500)
- Upper SMB / light-ERP: **~36,000–60,000** (Edara Pro ~46k; Odoo ~55k)
Local tools price per-account + per-module/warehouse, **not heavily per-user**.

## 3. Willingness-to-pay for a ~60-feddan date farm
Mature/productive 60-feddan gross revenue ≈ **6M–20M+ EGP/yr** (variety-dependent; premium Medjool far
higher); SMBs spend ~0.1–0.5% of revenue on a single vertical tool. Cross-checked against the local
comparables, the **comfortable annual WTP band ≈ 15,000–60,000 EGP/yr**, with soft resistance ~80–100k.
Below ~15k under-prices a vertical tool vs generic accounting SaaS; above ~100k invites full-ERP
procurement scrutiny + explicit ROI demands. **Caveat:** young plantations (yrs 1–7) have little
revenue → far lower WTP; segment by farm maturity.

## 4. ⚠️ Flag: the current GTM hypotheses look high
[`05-gtm-pricing.md`](05-gtm-pricing.md) hypothesizes **Pro 4,000–8,000 EGP/month** (= **48k–96k/yr**) —
at/above the WTP ceiling for a single 60-feddan SMB farm. Likely **too high for the single-farm
segment** (may fit only large/multi-farm enterprises). Recommend the interviews validate this **down**;
do not publish the monthly hypotheses as-is.

## 5. Recommendation (provisional — to TEST, not publish)
1. **Model:** per-farm flat, **EGP-denominated**, **annual prepay timed to post-harvest**, tiered by
   **features/modules** (records → planning/stock → analytics) — never per-seat; bundle users.
2. **Provisional main-tier band to test:** **~20,000–40,000 EGP/yr** (mid-upper SMB band, inside the
   WTP comfort zone), with a **low entry tier ~6,000–10,000/yr** and a **free feddan-gated tier**
   (Zr3i pattern) to drive adoption in a price-sensitive market.
3. **Setup fee:** one-time **~15% of year-1 ACV (~3,000–6,000 EGP)**, positioned as Arabic white-glove
   onboarding (data migration + field training) — market-normal and expected; keep heavy
   "implementation ≥ license" only for a future enterprise/multi-farm tier.
4. **EGP, not USD:** the pound's ongoing depreciation (~10%/yr) makes USD-priced SaaS a churn risk;
   EGP pricing is a trust/affordability signal.
5. **Validate before publishing:** confirm the band + setup fee in the 5 design-partner interviews
   (the H1–H4 / ≥5-of-7 gate); convert `[I]` hypotheses to `[V]` first.

## 6. Caveats
USD↔EGP ≈ 50 and moving — re-check before any USD-anchored figure. Many Arabic per-feddan profit
figures come from promotional feasibility studies (optimistic). Zr3i's actual price is unknown. This
is decision-support; the number is the Owner's, post-interviews.

## Sources
MENA: zr3i.com (+ /faq), farmonaut.com case study, wamda.com/agfundernews (Mozare3), restofworld.org
(FreshSource), agfundernews (Pula), techjockey/cropin, capterra (AGRIVI), xfarm.ag/versions-and-prices.
Global: agworld.com/pricing, corteva/tractionag (Granular), conservis.ag, saasworthy (FarmERP),
ag.trimble.com, climate.com/pricing, agriwebb.com/pricing, farmbrite.com/pricing, croptracker.com/pricing,
capterra (Cropio), onesoil.ai. Egypt SMB/econ: daftra.com/en/plans, getedara.com/pricing,
optifyegypt.com, buildn.tech (ERP cost Egypt 2026), exchange-rates.org / tradingeconomics (USD/EGP 2026),
v-alue.com / almaal.org (date-palm feasibility), tridge.com / selinawamucii (date prices), paddle.com
(setup-fee benchmarks).
