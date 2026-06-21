# 07 — Screen Map (v1)
*Every screen with: Purpose · Users · Key fields · Actions · Permissions · Empty state · Mobile behavior. MVP-0 screens marked ⭐ (see [06](06-MVP-0-BUILD-SPEC.md)).*

Legend for permissions: O=owner, M=manager, E=engineer, A=accountant, S=storekeeper, V=supervisor, W=worker.

---

### ⭐ Login + Role
- **Purpose:** authenticate; pick active org (consultants) and land on role homepage. **Users:** all. **Fields:** phone, OTP, org selector, role badge. **Actions:** sign in, switch org. **Permissions:** public→authenticated. **Empty state:** n/a. **Mobile:** full-screen, large inputs, OTP autofill.

### ⭐ Owner Dashboard
- **Purpose:** decisions at a glance — profit, approvals, risks. **Users:** O. **Fields:** profit-to-date, sales/expense, **pending approvals**, stock risks, critical issues, weather risks, delayed ops, best/worst sector. **Actions:** open approval, drill into a sector, run owner report. **Permissions:** O view; A read-only finance. **Empty state:** "No data yet — finish farm setup." **Mobile:** stacked KPI cards, approvals first.

### ⭐ Manager Dashboard
- **Purpose:** run the week. **Users:** M. **Fields:** this week/month plan, blocked operations, stock readiness, labor availability, weather windows, open follow-ups. **Actions:** open plan, resolve blocker, assign. **Permissions:** M; E read. **Empty:** "No active plan — create one." **Mobile:** plan + blockers prioritized.

### ⭐ Supervisor Mobile Home
- **Purpose:** today's work, near-zero typing. **Users:** V, W. **Fields:** today's tasks (by sector), 3 big buttons: Record operation / Report issue / Request stock. **Actions:** mark task done, open execution form, take photo. **Permissions:** V/W scoped to assigned sectors. **Empty:** "No tasks today." **Mobile:** primary surface — thumb-reachable, offline-draft badge.

### Engineer Dashboard
- **Purpose:** agronomy focus. **Users:** E. **Fields:** disease reports, age-based care priorities, inspection tasks, weather risks, treatment follow-ups. **Actions:** open issue, create inspection, open Academy. **Permissions:** E; M read. **Empty:** "No open agronomy items." **Mobile:** issues + inspections.

### Accountant Dashboard
- **Purpose:** money control. **Users:** A. **Fields:** expenses, sales, vouchers, purchase requests, budget variance, pending approvals, supplier balances. **Actions:** record expense, export, open budget. **Permissions:** A; O read. **Empty:** "No transactions this period." **Mobile:** read-mostly; entry on desktop.

### Storekeeper Dashboard
- **Purpose:** stock control. **Users:** S. **Fields:** stock levels, reservations, items below reorder, purchase needs, movements, expiry risks. **Actions:** receive stock, reserve, create PR. **Permissions:** S; M read. **Empty:** "No items — add inventory." **Mobile:** receive + movements.

### ⭐ Farm Map / Structure
- **Purpose:** navigate the farm spatially. **Users:** M, E, O. **Fields:** sector polygons/cards, palm counts, modes (grid / GPS / croquis). **Actions:** open file, select range for operation, print QR. **Permissions:** all read; M/E act. **Empty:** "No sectors — run setup." **Mobile:** sector list + tap-to-file (grid optional).

### Palm Grid Map
- **Purpose:** per-palm status at a glance. **Users:** E, V. **Fields:** cells colored by status, line labels. **Actions:** tap palm→file, drag to select line range, mark health, report issue. **Permissions:** E/M/V scoped. **Empty:** "No palms imported for this hawsha." **Mobile:** horizontal scroll, pinch-zoom.

### ⭐ Farm / Sector / Hawsha / Line / Palm File
- **Purpose:** the living activity file (one component, 5 scopes). **Users:** O, E, M. **Fields (palm):** code, location, variety, sex, age, status, source, offshoots, yield; **timeline** of all events (ops, issues, inspections, treatments, photos, stock usage, cost, follow-ups). **Actions:** add note/photo, create follow-up, record operation, change status (E/M). **Permissions:** read all; status change E/M; finance fields A/O. **Empty:** "No events yet." **Mobile:** timeline first, collapsible header.

### ⭐ Monthly Plan / Weekly Plan
- **Purpose:** the forward plan. **Users:** M. **Fields:** plan period, target, list of plan operations with status chips, planned cost/materials totals, **check summary** (weather/stock/budget/labor/responsibility). **Actions:** add operation, run checks, submit for approval, compare planned-vs-actual. **Permissions:** M create; O approve; A budget review. **Empty:** "No operations — add the first." **Mobile:** read + status; building on desktop.

### ⭐ Operation Builder
- **Purpose:** add one planned operation. **Users:** M. **Fields:** type (from template), target (sector/hawsha/line/palms/age/health), date/range, priority, responsible, materials+qty, labor, equipment, est cost, approval-needed. **Actions:** save, run checks, duplicate. **Permissions:** M. **Empty:** template picker. **Mobile:** stepper form.

### ⭐ Operation Execution Form (mobile-first)
- **Purpose:** record actual work in the field. **Users:** V, W. **Fields:** location (auto QR/GPS), op type, materials used, labor count, cost, photo, note (voice). **Actions:** save draft (offline), mark done, attach photo. **Permissions:** V/W scoped; consumes inventory, allocates cost. **Empty:** picks from assigned tasks. **Mobile:** ≤5 fields, camera-first, offline-draft + sync badge.

### ⭐ Inventory List
- **Purpose:** stock at a glance. **Users:** S, M. **Fields:** item, category, on-hand, **reserved, available**, reorder point, unit cost, status flag, expiry. **Actions:** receive, adjust, reserve, open coverage, create PR. **Permissions:** S/M write; others read. **Empty:** "No items — import opening stock." **Mobile:** list + receive.

### ⭐ Stock Coverage Screen *(the wedge)*
- **Purpose:** forecast run-out vs plan + recommend purchase. **Users:** M, S. **Fields:** item, available, planned consumption, **coverage days, projected stock-out date**, reorder point, safety stock, **PAB chart** (first-shortage highlighted), purchase recommendation (qty, order-by, supplier, cost, budget impact). **Actions:** create PR, adjust assumptions. **Permissions:** M/S; A reads budget impact. **Empty:** "No plan consumption for this item." **Mobile:** card + chart, recommendation CTA.

### ⭐ Budget Check Screen
- **Purpose:** the spend gate. **Users:** A, O, M. **Fields:** category, budget, actual, committed, **available**, this-plan cost, verdict (enough/low/exceeded), budget-runout date. **Actions:** route to approval, request transfer. **Permissions:** A/O; M read. **Empty:** "No budget set for this category." **Mobile:** verdict + action.

### ⭐ Purchase Request
- **Purpose:** draft→approve→order→receive. **Users:** S, M, O. **Fields:** code, items+qty, supplier, est cost, reason (linked shortage/plan), budget category, attachments, status, approval chain. **Actions:** create draft, submit, **approve/reject (O)**, mark ordered/received. **Permissions:** create S/M; **approve O only**; receive S. **Empty:** "No requests." **Mobile:** view + approve (owner).

### People & Responsibility
- **Purpose:** who is accountable. **Users:** O, M. **Fields:** people directory, positions, teams, **responsibility assignments** (scope×type), auto-routing rules. **Actions:** assign, reassign, add person. **Permissions:** O/M manage; others read own. **Empty:** "No assignments." **Mobile:** read.

### Issue / Note / Inspection Form
- **Purpose:** capture a problem fast. **Users:** V, E. **Fields:** location (auto), type, severity, description, photo, voice, suggested action; auto-fills responsible/age/recent-ops/weather. **Actions:** submit (auto-assign), add action, resolve, reopen. **Permissions:** V/E create; E resolve. **Empty:** "No open issues." **Mobile:** primary capture surface, offline-draft.

### Reports
- **Purpose:** export evidence. **Users:** O, M, A. **Fields:** report catalogue (owner monthly, P&L by sector/crop, planned-vs-actual, stock coverage, purchase needs, labor cost, activity file, issues). **Actions:** generate PDF/Excel, WhatsApp summary, print. **Permissions:** O/M/A; finance reports A/O. **Empty:** "No data for this period." **Mobile:** view + share.

### Settings
- **Purpose:** configure the org. **Users:** O, admin. **Fields:** farm profile, units/currency/locale, terminology labels, **users & roles**, operation/budget/stock templates, security status. **Actions:** edit, invite user, set role/scope. **Permissions:** O/admin only. **Empty:** setup wizard. **Mobile:** read; edit on desktop.

---
**Cross-cutting components (every screen):** RTL layout, role-aware nav, notifications drawer, global search, toasts, audit-on-write, offline-draft badge on field forms, empty-state with a primary CTA.
