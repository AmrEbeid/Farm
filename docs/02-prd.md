# 02 — Product Requirements (PRD)

## 1. Vision & promise

Build an **Arabic-first, flexible Farm Operating System** that helps farms plan work before it happens, control stock and budgets before money is spent, assign responsibility clearly, record every operation, and build a complete history for every farm, part, line, and palm. Not only accounting software; not only a dashboard — the **daily operating brain of the farm**.

- **EN:** *Plan the season, control the budget, track every palm, and never lose a farm record again.*
- **AR:** *خطّط الموسم، راقب الميزانية، وتتبّع كل نخلة، وخلّي كل عملية في المزرعة متسجّلة ومتابعة.*

## 2. Positioning

**For** medium/large owner-managed date-palm and fruit farms in Egypt/MENA **who** run on Excel, paper, and WhatsApp and can't see cost-per-block, control stock/budget, or keep tree-level history, **the Farm OS is** a planning-and-control operating system **that** turns a forward operations plan into live stock-coverage and budget intelligence with Arabic-native, mobile approvals and a per-palm activity file — **unlike** Conservis (English/row-crop), FarmERP (generic ERP UX, no run-out forecasting), or Zr3i (satellite/carbon, no ops/budget).

**Differentiator in one sentence:** *the only system that answers "given my plan, will I run out of stock or budget — and what do I buy, when?" in Arabic, at tree level, with an approval gate.*

## 3. The 9 product pillars

1. **Planning** — weekly/monthly/quarterly/annual operation plans, palm/tree-level targets.
2. **Stock Coverage Intelligence** — forward run-out forecasting vs the plan; reorder/PO recommendations. *(wedge)*
3. **Budget & Approvals** — budget by farm/sector/crop/category; budget-gated purchase requests; owner approval.
4. **People & Responsibility** — one part → many responsible people; one person → many parts; auto-routing.
5. **Palm/Tree Mapping** — grid + GPS + croquis; per-palm code, status, file.
6. **Activity & Follow-up Files** — every event rolls up from palm → line → hawsha → sector → farm.
7. **Weather Intelligence** — operation-vs-weather gating (spray/pollinate/harvest windows, heat stress).
8. **Care Academy** — age-based care, disease/pest library (RPW-first), checklists tied to the plan.
9. **Accounting & Reports** — expenses/sales/vouchers, cost allocation, P&L by farm/sector/crop/operation.

Plus the **AI assistant "عبدالجليل"** — permission-aware, grounded in farm data (named after Ebeid's real farm manager م/ عبد الجليل أسامة).

## 4. Personas & jobs-to-be-done

| Persona | Primary JTBD | Must-have screens |
|---|---|---|
| **Owner** | See profit per block; approve spending; spot risks remotely; prevent leakage | Owner dashboard, approvals inbox, P&L, alerts |
| **Farm manager** | Plan operations; assign people; track execution & delays; monitor stock/labor | Planning workspace, stock readiness, follow-ups |
| **Agri-engineer** | Plan care programs; track disease/treatment; link advice to palm age | Palm/hawsha files, Academy, inspections, weather |
| **Accountant** | Record & allocate expenses; vouchers; budgets; exportable reports | Accounting, vouchers, budgets, reports |
| **Supervisor** | Know today's work; report done/issues; request materials; photos | Mobile task list, operation capture, issue report |
| **Storekeeper** | Know stock; reserve for plans; record in/out; reorder alerts | Inventory, movements, reorder dashboard |
| **Worker** | Simple task list; location; mark done | Mobile task list (near-zero typing) |
| **Consultant** | Read + advise across multiple farms/orgs | Scoped read access across orgs |

## 5. Core product principles
- **Flexible, not hardcoded** — customers define hierarchy, role labels, operation types, approval flows, budgets, crop calendar, stock rules.
- **Location-first** — every record answers farm → sector → hawsha → line → palm.
- **Planning before spending** — check plan/stock/budget/weather/labor/approval *before* execution.
- **Every operation becomes a record** — one append-only event stream.
- **Responsibility must be clear** — every task/issue/budget line/part has owners; kills "everyone knows, nobody owns it."
- **Mobile-first for field users** — select location → photo → note → done → issue → stock request.
- **Arabic-first** — RTL, فدان/قيراط, قطاع/حوشة/خط/نخلة, إذن صرف, فسائل, عمالة, مشرف.

## 6. Full module map

```
1. Organization & SaaS foundation        12. Labor, attendance & payroll
2. Farm structure & mapping               13. Weather & farm intelligence
3. Palm/tree registry                      14. Disease & care academy
4. Activity & follow-up files              15. Issues, inspections & notes
5. Planning workspace                      16. Accounting: expenses, sales, vouchers
6. Operations management                   17. Harvest & production
7. Consumables & inventory                 18. Reports & dashboards
8. Stock coverage intelligence  (wedge)    19. AI assistant
9. Budget planning & control               20. Imports, exports & onboarding tools
10. Purchase requests & approvals          21. Notifications & audit logs
11. People & responsibility                22. Admin & customization
```

(Module-by-module functional specs in [03](03-architecture-and-data-model.md) §Modules; screen specs in [04](04-ux-and-design-system.md).)

## 7. MVP scope

**MVP must include (the loop that proves the wedge + daily value):**

| # | Capability | Why in MVP |
|---|---|---|
| 1 | Multi-tenant org + users + roles + RLS + audit log | foundation; can't ship multi-customer without it |
| 2 | Farm/sector/hawsha/line setup + palm registry + palm code + grid view | location-first backbone; Ebeid has the data ready |
| 3 | Activity-file timeline (event model) | the "never lose a record" promise |
| 4 | Weekly + monthly planning + operation templates | pillar 1 |
| 5 | Inventory items + stock in/out + reservations + reorder point + **stock-coverage alerts** | **the wedge** |
| 6 | Budget setup + budget-vs-planned check | pillar 3 |
| 7 | Purchase request + approval workflow (+ WhatsApp approval link) | pillar 3, owner value |
| 8 | People + responsibility assignments + auto-routing | pillar 4 |
| 9 | Issue/note reporting + photo attachments | field value, RPW follow-up |
| 10 | Expenses + sales + payment vouchers + cost allocation | pillar 9, accountant value |
| 11 | Role dashboards + PDF/Excel reports + WhatsApp summary | owner value |
| 12 | Arabic RTL UI + mobile-responsive supervisor flow + audit log + notifications | non-negotiable |

**MVP excludes (later):** full IoT/drone/satellite analytics, complex offline sync (start with simple queue), full payroll-tax, advanced export-compliance automation, AI disease *diagnosis* (vision), marketplace, billing automation, languages beyond AR/EN, complex equipment maintenance, full native app.

**MVP acceptance (the demo story must work end-to-end):** Manager creates a monthly plan → system computes materials → stock shortage detected → purchase recommendation generated → accountant checks budget → owner approves (incl. via WhatsApp) → storekeeper receives stock → operation becomes ready → supervisor executes on mobile → inventory decremented + cost allocated → farm/hawsha/palm files update → report shows planned-vs-actual.

## 8. Phased roadmap

| Phase | Goal | Key deliverables | Acceptance |
|---|---|---|---|
| **0 — Research & validation** | de-risk before build | competitor matrix, customer-voice DB, ICP, MVP scope, pricing hypothesis, data model v1, prototype (✅ much of this done) | 5 farm interviews; signed-off MVP |
| **1 — SaaS foundation** | multi-tenant base | orgs, users, roles, permissions, **RLS**, audit log, settings, farm-setup wizard | multiple orgs isolated; owner invites users; roles gate access |
| **2 — Farm structure & palm mapping** | location backbone | farms→sectors→hawshat→lines→palms, codes, grid view, palm/sector/farm files, QR | import palms; open palm file; events roll up |
| **3 — Activity & operations** | the record | event model, operation records, notes, attachments, follow-ups, timeline | any operation recorded → linked to location → appears in files |
| **4 — Planning workspace** | pillar 1 | weekly/monthly plans, plan operations/targets, templates, planned-vs-actual, approval status | create plan; assign people; see planned cost & materials |
| **5 — Inventory & stock coverage** | **wedge** | items, movements, reservations, rules, reorder point, **coverage date, shortage alarms, PO recommendation** | available stock computed; plan reserves stock; early-runout warning; PO recommended |
| **6 — Budget & approvals** | pillar 3 | budgets, lines, budget checks, purchase requests, approval chains, vouchers | plan checks budget; PR approved/rejected; budget dashboard |
| **7 — Accounting & reports** | pillar 9 | expenses, sales, allocation, P&L dashboards, exports | expenses/sales link to farm/sector/operation; P&L by sector; Excel/PDF |
| **8 — People & labor** | pillar 4 | directory, responsibility, teams, labor logs, basic payroll | many-to-many responsibility; alerts route; labor cost → operations |
| **9 — Weather** | pillar 7 | forecast, weather rules, alerts, spray/heat gating, plan weather-check | weather in weekly plan; can block/warn an operation |
| **10 — Academy** | pillar 8 | care stages, age-based learning, disease library, checklists, issue-linked guidance | age-based content shown; disease issue suggests checklist |
| **11 — AI assistant** | عبدالجليل | farm-data context, permission-aware answers, owner summaries, planning/stock/budget assistants | answers from farm data; respects permissions; no invented numbers |

## 9. Success metrics

| Stage | Metric | Target |
|---|---|---|
| Activation | farm fully set up (structure + ≥1 plan + ≥1 inventory item) within 14 days | ≥80% of onboarded farms |
| Core-loop adoption | farms that run plan→stock-check→PR→approval at least monthly | ≥60% by month 3 |
| Field adoption | weekly operations logged by supervisors (vs manager backfill) | ≥70% logged same-day |
| Value proof | leakage/variance surfaced per farm per quarter (the ROI story) | quantified in owner report |
| Retention | logo retention year 1 | ≥85% |
| Expansion | Core→Pro upgrade (adds stock-coverage + budget + accounting) | ≥40% within 6 months |

## 10. Out-of-scope / non-goals (v1)
Not a marketplace, not a fintech/lender (Mozare3/Apollo space), not a satellite/remote-sensing platform (Zr3i/Farmonaut space — integrate instead), not a hardware vendor (integrate Phytech/Palmear), not a full GAAP accounting suite (cash-basis voucher ledger; integrate/export to formal accounting if needed).
