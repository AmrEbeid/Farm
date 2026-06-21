# 04 — UX & Design System

Arabic-RTL-first, mobile-first for field users, role-scoped simplicity (a supervisor must never see the full ERP). The clickable embodiment of this doc is `../farm-os-prototype.html`.

---

## 1. Design principles
1. **Arabic-RTL native** — `dir="rtl"`, logical CSS properties, right-anchored nav, Arabic numerals option, Hijri/Gregorian toggle. Bilingual AR/EN later.
2. **Role-scoped surfaces** — each role gets a homepage and a trimmed nav; the same data, different altitude. Workers/supervisors get near-zero-typing flows.
3. **Field-first capture** — ≤5 fields per common operation, camera-first, GPS auto-tag, big tap targets, works offline with a visible sync queue.
4. **Decisions, not dashboards** — every screen answers a "what should I do?" question (shortage → order; weather bad → reschedule; budget low → approve/transfer).
5. **One record, many views** — an event entered once appears in palm/line/hawsha/sector/farm files automatically.
6. **Trust the numbers** — show provenance ("from the plan", "from the ledger"); never fabricate; label forecasts as estimates.

## 2. Design tokens

| Token | Value | Use |
|---|---|---|
| `--green-900 … 500` | `#11301b → #3d9960` | brand, primary actions, palm theme |
| `--gold` | `#c8922a` | accent, dates/harvest, highlights |
| `--bg / --card / --line` | `#f3f6f3 / #fff / #e3e9e4` | surfaces |
| `--ok / --warn / --danger / --info / --purple` | `#2f7d49 / #e08a1e / #c0392b / #2b6cb0 / #7e57c2` | status semantics |
| Radius | 9–18px | inputs → cards → modals |
| Font | Segoe UI / Tahoma (Arabic-safe); later a licensed Arabic face (e.g. IBM Plex Arabic) | RTL legibility |
| Numerals | tabular-nums for finance | aligned columns |

**Status color language (consistent everywhere):** ok=green, scheduled/warn=amber, blocked/critical=red, info/scheduled=blue, neutral=grey, special=purple.

## 3. Information architecture & navigation

```
Dashboard · Planning · Farm Map · Farm Files · Operations · Inventory · Budgets ·
Purchases · People · Issues & Notes · Weather · Academy · Accounting · Reports · AI · Settings
```
Sidebar grouped: **الرئيسية** (Dashboard, Phases/Reports) · **العمليات والحقل** (Map, Palms, Operations, Schedule, Offshoots) · **المالية** (Vouchers, Accounting, Sales, Inventory) · **الإنتاج والتصدير** (Harvest, Quality, Export) · **الإدارة** (HR, AI, Audit, Settings). Locked items grey out by role.

## 4. Role homepages (the same app, different front door)

| Role | Homepage shows |
|---|---|
| **Owner** | profit · budget variance · pending approvals · stock risks · critical issues · weather risks · delayed ops · best/worst sectors |
| **Manager** | this week's plan · blocked operations · stock readiness · labor availability · weather windows · open follow-ups |
| **Engineer** | disease reports · age-based care priorities · inspection tasks · weather risks · treatment follow-ups |
| **Accountant** | expenses · sales · vouchers · purchase requests · budget variance · pending approvals · reports |
| **Storekeeper** | stock levels · reservations · items below reorder · purchase needs · movements · expiry risks |
| **Supervisor** | today's tasks · assigned parts · report operation · report issue · stock request · photos |

## 5. Signature screen specs (the differentiators)

### 5.1 Planning Workspace (6-step builder)
1. **Plan type** (weekly/monthly/quarterly/annual) → 2. **Target** (farm/sector/hawsha/line-range/specific palms/crop/age-group/health-status) → 3. **Add operations** (type, date, priority, responsible, materials, labor, equipment, est. cost) → 4. **System checks** panel (weather · stock · budget · labor · responsibility · conflicts · age-risks, each ✅/⚠️/⛔) → 5. **Resolve blockers** (shortage→PR, over-budget→approval/transfer, bad weather→reschedule) → 6. **Submit for approval** → execute → **planned-vs-actual** compare.
Plan statuses surfaced as chips: draft · needs review · needs stock check · needs budget approval · needs owner approval · approved · partially executed · completed · delayed · over budget.

### 5.2 Stock-Coverage Intelligence
- Per-item **coverage card**: available · planned consumption · **coverage days** · **projected stock-out date** · lead time · a verdict chip (مغطّى / منخفض بعد العملية / نقص / محظور / يتطلب شراء).
- **Time-phased PAB chart** (the plan simulation): opening balance, planned issues (down bars), expected receipts (up bars), running projected balance line, with the **first-shortage period highlighted red** and the safety-stock band shaded.
- **Purchase recommendation panel**: item, min needed, recommended qty (shortfall+SS, rounded to pack), needed-by date, supplier, est. cost, linked plan/operation, budget impact, "Create PR" button.

### 5.3 Budget Check (gate)
A pre-approval panel on any plan/PR: planned + committed + actual vs budget, remaining, **budget-runout date**, verdict (enough/low/exceeded), and the action it forces (proceed / request approval / transfer). The thing that makes a purchase request *require* owner sign-off.

### 5.4 Purchase Request → Approval chain
PR card (requester, items, est. cost, linked shortage/plan, budget category, attachments) → review (manager/engineer) → budget check (accountant) → **owner approve/reject (+ WhatsApp deep link)** → order → receive → stock updated → close. Every step writes an immutable audit row.

### 5.5 Palm/Tree Map (3 modes)
- **Grid map** (palm farms): each line/palm as a cell colored by status (healthy/watch/sick/dead/removed/male/empty/other-crop). Tap → palm file; select line-range or palms for an operation.
- **GPS map**: find/locate a palm, pin issue location, export mapping.
- **Croquis overlay**: upload a hand-drawn/scanned farm map and pin areas/lines — for farms with paper maps.
Map actions: open file · report issue · record operation · add note/photo · mark health · create follow-up · assign inspection · print QR labels.

### 5.6 Activity & Follow-up Files (timeline)
Every farm/sector/hawsha/line/palm has a living file — a filterable timeline of all events (operations, issues, inspections, treatments, weather alerts, stock usage, expenses, photos, follow-ups, recommendations, yield, sales). Each event answers: what · where · when · who did it · who's responsible · why · materials · cost · follow-up.

### 5.7 Issue report (mobile, near-zero typing)
Location (auto from QR/GPS) → issue type → severity → description (voice note option) → photos → suggested action. System auto-fills farm/sector/hawsha/line/palm code, responsible people, palm age, recent operations, weather context; auto-assigns engineer; links Academy material; creates follow-up; saves to all relevant files.

## 6. Component library
Cards (KPI, chart, list) · tables with sticky headers + tabular-nums + status tags · progress bars (ok/warn/danger) · tabs/sub-tabs · timeline · drawer (notifications) · modal forms · field-form grid · map grid · phase/roadmap cards · chat (AI) · toast · alert rows (ok/warn/info/danger) · role switcher · global search. (All implemented in the prototypes.)

## 7. Mobile / offline / accessibility
- **PWA** with service worker + IndexedDB queue; optimistic UI; retry queue; image compression before upload; small payloads.
- **Offline indicator + sync count** visible on the field screens.
- **Accessibility for the field:** large fonts, high contrast for sunlight, voice-note attachments for low-literacy workers, icon+text labels, RTL-correct focus order.
- **Print/PDF:** Arabic-correct RTL output for owner monthly report, voucher, export-readiness sheet.

## 8. Two prototypes (design artifacts)
- **`../farm-os-prototype.html`** — productized, multi-tenant framing; demonstrates the **core differentiator loop** (Plan → Stock coverage simulation → Budget gate → Purchase approval → Execute → Farm file) + palm grid map + role homepages.
- **`../ebeid-farm-os-demo.html`** — Ebeid-specific, loaded with the real registry/accounting/offshoot data; the 18-module walkthrough + project-phases roadmap.
