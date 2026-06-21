# 05 — GTM, Pricing & Go-Live

`[V]` verified · `[I]` recommended. Anchored to the research in [01](01-research-and-strategy.md) §7.

---

## 1. Ideal customer profile (ICP)
Medium/large **owner-managed date-palm and fruit farms** in Egypt/MENA with: multiple sectors/hawshat; an owner not always on-site; expense-approval needs; stock leakage / shortage pain; currently on Excel + paper + WhatsApp; a team of owner + manager + engineer + accountant + supervisors + storekeeper. (Adoption rises with size — large 81%, medium 76%, small 36% `[V]` — so lead with medium/large.)

**Best early adopters (first 3–5):** date-palm farms; farms with multi-sector structure; farms with budget-control pain; farms preparing for export/quality; farms open to a paid setup. **Ebeid Farm is the design-partner #1.**

## 2. Sales message — sell control, not software
- **EN:** *We help farms plan operations, control stock and budget, assign responsibility, and keep a full history for every farm part and palm.*
- **AR:** *نظام يساعد المزرعة تخطّط التشغيل، تراقب المخزون والميزانية، تحدد المسؤوليات، وتسجّل كل عملية على مستوى القطاع والحوشة والخط والنخلة.*

Lead with the **wedge**: *"Tell us your plan; we'll tell you what you'll run out of and what to buy — before you're standing in the field short of fertilizer."*

## 3. Pricing model

**Posture (from research `[V/I]`):** price **per-farm (+ per-area above a threshold), in EGP, annual prepay incentive — NOT per-seat** (per-seat punishes the multi-persona team you're selling to and reads badly in MENA; 50% of farmers won't pay anything, 56% in emerging markets cite upfront cost as the #1 blocker). Offer a **free/low entry tier** for land-grab (Zr3i gives 10 feddan free).

**Tiers (hypotheses to test — not final):**

| Tier | Who | Includes | Indicative monthly (EGP) |
|---|---|---|---|
| **Core** | single farm, get-started | farm structure, palm registry + grid map, operations log, expenses, sales, basic reports, 3–5 users | 1,500–3,000 |
| **Pro** *(main tier)* | the real buyer | + **planning**, **stock-coverage intelligence**, **budgets + budget-gated approvals**, purchase requests, farm/palm files, weather, accountant exports, 10–25 users | 4,000–8,000 |
| **Enterprise** | multi-farm / export | + multi-farm, advanced permissions, export/packhouse traceability, **AI assistant**, custom reports, API, priority support | 10,000–30,000+ |
| **Private deployment** | data-sensitive | self-host/VPC, custom | custom |

**Setup / onboarding fee `[V norm]`:** keep **≤ ~15% of year-one ACV**. Productized, priced as enablement (it de-risks the #1 churn cause), ranges by farm size:
- Small 15,000–30,000 · Medium 30,000–75,000 · Large 75,000–200,000+ EGP `[I — your v1 hypothesis, consistent with the 15% rule]`.

**Anchor to a 3:1 ROI story `[V]`:** leakage recovered (stock + unapproved spend) + yield/quality uplift + offshoot revenue captured. Build a one-page EGP ROI calculator for the sales deck.

## 4. Onboarding package (what the setup fee buys)
Each customer gets: farm-data template · people/responsibility template · inventory opening-balance template · expense-categories template · operation templates · **Excel/registry/offshoot data migration** · tree/block census import · 1–2 Arabic training sessions · first monthly plan set up with them · an Arabic playbook. (This is also the de-risking for "steep onboarding → churn," the industry's #1 abandonment cause `[V]`.)

## 5. Demo script (the winning story — 10 beats)
1. Open the **farm map**, tap a sector. → 2. Open a **sector/palm file** (full history). → 3. Create a **monthly plan**. → 4. System **computes materials**. → 5. **Stock shortage** appears (coverage 4 days < 5-day lead time). → 6. **Purchase recommendation** generated (order 300 kg today). → 7. Accountant sees **budget check**; → 8. **Owner approves** (incl. WhatsApp link). → 9. Supervisor **executes on mobile**; inventory + cost update. → 10. **Report** shows planned-vs-actual and the farm file updates automatically. *(This exact loop is the prototype `../farm-os-prototype.html`.)*

## 6. Go-to-market motion
- **Phase 1 — design partners (now):** Ebeid + 2–4 similar date/fruit farms; free/discounted in exchange for feedback + case study + the Arabic customer-voice interviews (the research gap).
- **Phase 2 — channel:** agronomist/consultant seats (Agworld model `[V]`) — consultants pull farms onto the platform; and co-ops/export companies who want traceable supply.
- **Phase 3 — institutional tailwind:** align with FAO/MoALR ICT-extension and SAIL/Hayah Karima programs (date palm + citrus are named pilot themes `[V]`); Gulf expansion via the MEWA/PIF agritech push.
- **Distribution partnerships:** Mozare3 (contract-farming network), and *integrate rather than fight* point-solutions (Palmear RPW acoustic, Aerobotics imaging, Phytech sensors) — be the **book-of-record they plug into**.

## 7. Risks & mitigations

| Risk `[V where cited]` | Mitigation |
|---|---|
| **Steep onboarding → churn** (#1 industry abandonment cause) | white-glove Arabic onboarding, guided setup, templates, role-scoped simple screens |
| **WTP / cost objection** (50% won't pay; 56% EM cite upfront cost) | low EGP entry tier; per-farm not per-seat; ROI/leakage calculator; bundle with co-op/government channels |
| **Unclear ROI** (40%) | lead with cost-per-block + leakage + export-quality; explicit 3:1 case |
| **Rural connectivity** (21-pt urban/rural gap) | offline-first PWA, low-bandwidth, voice/photo capture |
| **Change-resistance / low digital literacy** | Arabic-first, near-zero-typing supervisor/storekeeper flows |
| **Incumbent FarmERP entering Saudi; Zr3i owns Arabic brand** | beat on UX + tree-level + stock-coverage intelligence; partner-or-compete with Zr3i |
| **Over-scope** | strict MVP = the core loop; build in phases |
| **Multi-tenant security** | org-level RLS from day one, no shortcuts ([03](03-architecture-and-data-model.md) §2) |
| **AI wrong advice** | AI assists, doesn't replace expert; sources/checklists; engineer approval on agronomy; "no invented numbers" |
| **Pesticide/agronomy liability** | Academy numbers are editable templates; pesticide doses only from currently-registered Egyptian products + local agronomist sign-off |

## 8. Immediate next 10 actions
1. **Freeze the 9 pillars** (done in [02](02-prd.md)) and the wedge.
2. **Interview 5 farms** (the Arabic customer-voice gap) — convert the `[I]` pains to `[V]`.
3. **Validate EGP pricing & setup-fee willingness** with those farms.
4. **Lock data model v1** ([03](03-architecture-and-data-model.md)) as ADR-0001 (asset + event + quantity; org RLS).
5. **Build the stock-coverage engine** (PAB simulation) as a Postgres function + the one screen — it's the wedge; prove it first.
6. **Stand up the SaaS foundation** (orgs, RLS, roles, audit) on Supabase.
7. **Migrate Ebeid's real data** as the reference tenant (registry, offshoots, 7-yr accounting) + run the cleanup (drawings split, typos, secret removal).
8. **Ship the MVP loop** end-to-end (the demo script) for Ebeid.
9. **Seed the Academy** with the date-palm content ([01](01-research-and-strategy.md) sources) and get a local agronomist + Egyptian pesticide-registration sign-off.
10. **Recruit 2–4 more design-partner farms** and instrument the success metrics ([02](02-prd.md) §9).
