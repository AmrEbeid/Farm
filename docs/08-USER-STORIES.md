# 08 — User Stories (by module × persona)
*Format: As a [persona], I want [capability], so that [value]. Personas: Owner, Manager, Engineer, Accountant, Supervisor, Storekeeper, Worker, Consultant. ⭐ = in MVP-0.*

---

## Planning
- ⭐ **Manager:** build a weekly/monthly/quarterly/annual operation plan, so I know required materials, labor, budget, and weather risks before execution.
- ⭐ **Manager:** see system checks (stock/budget/weather/labor/responsibility) on a plan before approval, so I don't start work that will get blocked.
- **Owner:** approve or reject a plan and see its cost, so spending is controlled before it happens.
- **Engineer:** add care operations tied to palm age/season, so the plan reflects real agronomy.
- ⭐ **Manager:** compare planned vs actual after execution, so I see discipline and variance.
- **Supervisor:** see only my assigned plan operations for the week, so I know today's work.

## Stock Coverage *(wedge)*
- ⭐ **Manager:** see whether stock covers a planned operation and when it runs out, so I order before I'm short.
- ⭐ **Storekeeper:** get a recommended purchase quantity + order-by date per shortage, so I don't guess.
- ⭐ **Storekeeper:** reserve stock against an approved plan, so two plans don't double-book the same stock.
- **Manager:** see a time-phased projected balance (run-out date), so I can sequence operations safely.
- **Storekeeper:** get an alarm when an item drops below reorder point or before expiry, so nothing lapses silently.

## Budget & Approvals
- ⭐ **Accountant:** check a plan/PR against the category budget (available = approved − actual − committed), so we don't overspend.
- ⭐ **Owner:** be the only one who can approve a purchase request that breaches a budget threshold, so control stays with me.
- ⭐ **Owner:** approve from a WhatsApp link, so I don't need to be at a desk.
- **Accountant:** transfer budget between categories with a record, so reallocation is auditable.
- **Owner:** see budget-runout date per category, so I anticipate cash needs.

## Purchase Requests
- ⭐ **Storekeeper:** create a purchase request draft from a stock shortage, so the need is captured with its reason.
- ⭐ **Owner:** approve/reject a PR with the linked shortage, plan, and budget impact visible, so I decide with context.
- **Storekeeper:** mark a PR ordered then received, updating stock, so the loop closes.
- **Accountant:** see committed (approved-unpaid) spend, so the budget reflects obligations.

## Farm Structure & Mapping
- ⭐ **Manager:** define farms → sectors → hawshat → lines with our own labels (قطاع/حوض/حوشة), so it matches how we talk.
- **Engineer:** open the palm grid map and mark health by line range, so scouting is fast.
- **Manager:** find a palm by code/QR, so I can locate it in the field.

## Palm/Tree Registry & Files
- ⭐ **Engineer:** open any palm/hawsha/sector/farm file and see its full event history, so I never lose a record.
- **Owner:** see yield and cost history per palm/sector, so I know what performs.
- **Engineer:** change a palm's status (watch/sick/removed) with a reason, so the lifecycle is tracked.
- **Manager:** import the palm registry from our records, so we don't re-enter 4,380 palms by hand.

## Operations
- ⭐ **Supervisor:** record an operation on my phone with a photo in under a minute, so the record exists without paperwork.
- ⭐ **Supervisor:** save a draft offline and have it sync when internet returns, so weak signal doesn't lose my work.
- **Manager:** use operation templates (rates, weather rules, follow-up), so plans are consistent.
- **Engineer:** schedule a follow-up from an operation (e.g., inspect 14 days after spray), so nothing is forgotten.

## Offshoots (الفسائل)
- **Manager:** track offshoots from a mother palm (detach date, size, rooting, disposition: planted/sold/gifted/ترقيع), so the asset is managed.
- **Accountant:** link an offshoot sale to a buyer and price, so the revenue line is captured.
- **Owner:** see offshoot production and revenue per season, so I value the propagation asset.

## Inventory & Procurement
- ⭐ **Storekeeper:** see on-hand, reserved, available, and reorder flags per item, so I know real stock.
- **Storekeeper:** record receipts/issues/adjustments with cost, so the ledger and bin stay accurate.
- **Manager:** see input usage and cost allocated to a sector/crop, so cost-per-block is real.
- **Storekeeper:** manage suppliers with lead time and terms, so reorder timing is correct.

## Accounting (post-MVP-0)
- **Accountant:** record expenses and allocate to farm/sector/crop/operation/season, so P&L is meaningful.
- **Accountant:** keep owner drawings separate from operating expenses, so the operating P&L is clean.
- **Owner:** see P&L by sector and crop, so I know the best/worst performers.
- **Accountant:** never silently edit an approved record — corrections create a reversing entry, so the books are trustworthy.

## Sales & CRM (post-MVP-0)
- **Accountant:** record a sale (local/export) with costs deducted and net, so margin is real.
- **Owner:** see receivables and overdue invoices, so cash is collected.
- **Manager:** keep a buyer/exporter directory, so relationships are tracked.

## Labor & Payroll (post-MVP-0)
- **Manager:** log labor per operation (count, days, rate), so labor cost allocates to the work.
- **Accountant:** run basic payroll (salary/daily/task) with advances/deductions, so staff are paid correctly.
- **Owner:** see labor cost per feddan/palm/operation, so I benchmark productivity.

## Weather (post-MVP-0)
- **Manager:** see a 7-day forecast and operation-vs-weather gating (spray/pollinate/harvest), so I schedule into good windows.
- **Engineer:** get a heat-stress alert for young palms, so I raise irrigation in time.

## Care Academy (post-MVP-0)
- **Engineer:** see age-based care guidance and a disease library (RPW-first) tied to our context, so advice is relevant.
- **Engineer:** when I report a suspected disease, get a checklist and auto-assignment, so follow-up isn't lost.

## Issues & Inspections
- ⭐ **Supervisor:** report an issue with a photo and have it auto-assigned to the engineer, so problems get owned.
- **Engineer:** track an issue through its lifecycle (reported→resolved→verified→closed), so nothing stalls.

## Reports
- ⭐ **Owner:** get a planned-vs-actual report per plan, so I see variance.
- **Owner:** get a monthly owner summary as PDF + WhatsApp, so I stay informed off-site.
- **Accountant:** export any report to Excel/PDF, so I can work outside the system.

## AI Assistant عبدالجليل (post-MVP-0)
- **Owner:** ask "which sector is losing money / what runs out this month / what should I approve today" and get answers from our data, so I decide faster.
- **All:** trust that the assistant only answers from data I'm allowed to see and never invents numbers.

## Platform / Admin
- **Owner:** invite users and set their role and sector scope, so access matches responsibility.
- **Consultant:** access multiple farms/orgs with the right role in each, so I advise across clients.
- **Owner:** export all my data and request deletion, so I own and control my data.
- **Admin:** see an immutable audit trail of approvals/edits, so every change is attributable.
