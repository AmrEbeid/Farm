# Farm Operating System — Product Documentation
### نظام تشغيل المزارع — وثائق المنتج

> **One-line definition:** A planning-and-control operating system for farms that connects a forward operations plan to live **stock-coverage intelligence**, **budget-gated approvals**, **people/responsibility**, and a **tree-level activity history** — Arabic-first, mobile-first, built for date-palm and fruit farms in Egypt/MENA.
>
> **التعريف:** نظام تخطيط ورقابة للمزارع يربط خطة التشغيل المستقبلية بذكاء تغطية المخزون، والموافقات المقيّدة بالميزانية، والمسؤوليات، وسجل كل نخلة — عربي أولاً، للموبايل أولاً.

---

## What this is
This folder is the full product blueprint produced from (a) your *Farm Operating System — Full Product Plan v1*, (b) the real Ebeid Farm data (palm registry, offshoot jard, 7-year accounting), and (c) deep market/technical/customer research (4 cited research streams, June 2026).

## Document index

| # | Document | What's inside |
|---|----------|---------------|
| 00 | **[README](README.md)** | This index + executive summary |
| 01 | **[Deep Research & Strategy](01-research-and-strategy.md)** | 25+ competitor matrix, open-source teardown, customer-voice & pain ranking, pricing landscape, **white-space / wedge**, gap analysis, lessons & anti-patterns |
| 02 | **[Product Requirements (PRD)](02-prd.md)** | Vision, positioning, personas, the 9 pillars, full module map, **MVP scope**, phased roadmap, success metrics |
| 03 | **[Architecture & Data Model](03-architecture-and-data-model.md)** | Multi-tenant model, **the asset+event+quantity schema**, RLS patterns, the **Stock-Coverage (MRP-lite) engine math**, budget engine, scaling, AI assistant architecture |
| 04 | **[UX & Design System](04-ux-and-design-system.md)** | Arabic-RTL design system, IA & navigation, role homepages, the differentiator screen specs, component library, mobile/offline, accessibility |
| 05 | **[GTM, Pricing & Go-Live](05-gtm-pricing.md)** | Pricing model (EGP, per-farm), tiers, setup/onboarding package, ICP, sales motion, demo script, risks |

### Build specs (implementation detail — what a developer builds from)
| # | Document | What's inside |
|---|----------|---------------|
| ⭐ 06 | **[MVP-0 Build Spec](06-MVP-0-BUILD-SPEC.md)** | **The first buildable spec** — MVP-0 goal/hypothesis, 14 screens, table subset, user stories, real test data, exact workflows, acceptance tests, out-of-scope, demo script, pilot validation gates |
| 07 | **[Screen Map](07-SCREEN-MAP.md)** | Every v1 screen: purpose · users · fields · actions · permissions · empty state · mobile |
| 08 | **[User Stories](08-USER-STORIES.md)** | Stories per module × persona (owner/manager/engineer/accountant/supervisor/storekeeper/worker/consultant) |
| 09 | **[Acceptance Tests](09-acceptance-tests.md)** | Given/When/Then for every critical feature (stock coverage, budget, approvals, RLS, import, offline, financial correction…) — the check suite |
| 10 | **[Operations & Readiness](10-operations-and-readiness.md)** | Import/onboarding, offline policy, attachments, financial-correction rules, export/deletion, backup/DR, weather provider, agronomy ownership, templates, pricing validation, support ops, integrations, legal/privacy, scale targets, Definition-of-Done |

### Governed under the AI Project Operating System v3
| File | What's inside |
|---|---|
| ⭐ **[MASTER-PLAN.md](MASTER-PLAN.md)** | **Product master plan + the detailed risk-tiered staged plan**, governance & separation of duties, verification/evidence, full risk register, ready-to-paste execution prompts, and the **playbook-lens review & enhancements** of this project |
| **[CLAUDE.md](CLAUDE.md)** | PROJECT RULES — the tool instruction file (read at the start of every session) |
| **[PROJECT-TRACKER.md](PROJECT-TRACKER.md)** | Stages, status, open gates, known risks |
| **[SESSION-BRIEF.md](SESSION-BRIEF.md)** | Context for the next session (updated last) |
| **[SPEC-0001](SPEC-0001-stock-coverage-engine.md)** | First workstream spec — the stock-coverage engine (the wedge), checks-first |

**Companion design artifact:** `../farm-os-prototype.html` — a clickable prototype of the core differentiator loop (Plan → Stock check → Budget gate → Purchase approval → Execute → Farm file) plus the palm-grid map and stock-coverage simulation. The earlier `../ebeid-farm-os-demo.html` remains as the Ebeid-specific, data-loaded demo.

---

## Executive summary

**The bet.** Most farm software *records what happened*. The market is crowded with mapping, weather, and field-log apps, and a few real ERPs. But research across 25+ products confirms a genuine gap: **no product answers "given my plan, will I run out of stock or budget — and what do I buy, when?" in Arabic, at tree level, with an approval gate.** Conservis proves farms pay for plan+budget+inventory; FarmERP and Zr3i prove Arabic/date-palm demand exists — but nobody sits in the intersection.

**The wedge (defensible differentiator):**
> A forward operations plan drives a **live stock-coverage forecast** ("at the current plan you run out of potassium sulphate in 4 days — that's inside your 5-day supplier lead time; order 300 kg today"), which **gates a purchase request against the budget** through an **Arabic-native, mobile, offline-tolerant approval workflow**, on top of a **per-palm activity history**.

**Why it wins where incumbents can't:** the planning-intelligence core is genuinely rare (only Conservis approaches it, reactively); Arabic-first + tree-level + approvals form the moat that keeps Conservis/Cropin/FarmERP from trivially copying it.

**Who it's for.** Medium/large owner-managed date-palm and fruit farms in Egypt/MENA — exactly the Ebeid profile (5 sectors, 28 hawshat, ~4,380 palms, mixed crops, owner + manager + engineer + accountant + supervisors + storekeeper).

**The shape.** Multi-tenant SaaS, Next.js + Supabase (Postgres + RLS), Arabic RTL-first, mobile/offline field capture. The data spine is an append-only **asset + event(log) + quantity** model (farmOS-proven) whose single `pending/done` status makes *plan*, *reservation*, and *actual* the same row at different stages — which is exactly what the stock-coverage simulation iterates over.

**The 9 product pillars:** Planning · Stock Coverage · Budget & Approvals · People & Responsibility · Palm/Tree Mapping · Activity & Follow-up Files · Weather Intelligence · Care Academy · Accounting & Reports — with an AI assistant ("عبدالجليل") on top of the structured data.

**Pricing posture.** Per-farm (not per-seat — per-seat punishes the multi-persona team and reads badly in MENA), billed in EGP, with a free/low entry tier for land-grab and a productized paid onboarding (Excel migration + tree census + training) capped at ~15% of year-one value.

**Biggest risks** (and why they're manageable): onboarding friction is the #1 churn cause industry-wide → mitigated by white-glove Arabic onboarding and role-scoped simple screens; 50% of farmers globally won't pay for agtech → mitigated by a concrete leakage/ROI story and low EGP entry tier; rural connectivity → offline-first PWA.

---
*Generated June 2026. Confidence markers used throughout: `[V]` verified from a cited source · `[I]` inferred/recommended. Numeric agronomy templates are starting points to be tuned by a local agronomist and current Egyptian pesticide registrations.*
