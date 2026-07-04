# Page Help — Farm OS (the 5-question blocks)

*The content layer for in-app contextual help ([`SPEC-0014`](SPEC-0014-knowledge-living-documentation.md) A1/A2).
Each real page answers the five questions: **what / why / when / how / common mistakes**. Drawn from the
[Feature Registry](FEATURE-REGISTRY.md) + verified page purposes; cross-links the relevant `FEAT`/`BR`/"Why?".
**Documentation content only** — this would later populate a typed `pageMeta` + Help drawer; it is not wired into
the app here (that is app code, Owner-gated). Reconciled to `main` 2026-06-27. Maturity **L3**.*

> Format per page: **What** · **Why** · **When** · **How** · **Avoid** (→ Why-Catalog) · refs.

## Structure (FEAT-003/004)
**`/farm` — Farm structure.** *What:* the tree of your farm (sector → hawsha → line → palm). *Why:* every
operation, cost, and history rolls up this tree. *When:* set up or correct the physical layout. *How:* add/edit a
sector/hawsha/line/palm; archive to remove (soft). *Avoid:* re-parenting a palm into an archived hawsha (it
vanishes — error `22023`, BR-090); restoring a child before its parent (BR-091). Refs: RPC-021..025.

**`/farm/palm/[id]` — Palm file.** *What:* one palm's 360 (identity, status history, photos). *Why:* tree-level
record is the product's core promise. *When:* inspect or update a palm's health. *How:* change status
(active/watch/sick/dead/removed/replaced) — writes history. *Avoid:* editing status outside the status control.
Refs: FEAT-004, RPC-026, BR-065.

**`/farm/croquis` — Croquis map.** *What:* a visual map of the farm. *When:* orient spatially. *How:* view. *Note:*
GIS coordinates/zones/heatmaps are not built yet.

## Planning (FEAT-005)
**`/plans` + `/plans/[planId]` — Plans.** *What:* forward operation plans (weekly→annual) with operations, labor,
materials. *Why:* plan before spending; feeds coverage + budget checks. *When:* start a season/month. *How:*
create plan → add operations (subtype, target, est cost, materials) → assign people → run checks. *Avoid:* negative
costs/quantities (BR-100); only owner/farm-manager can write (BR-061, error `42501`). Refs: RPC-012..016.

## Inventory & coverage (FEAT-006/007)
**`/inventory` — Inventory.** *What:* items, on-hand, reserved, available. *Why:* stock truth feeds the wedge.
*When:* check stock, manage items. *How:* view; storekeeper/manager receive & reserve. *Avoid:* expecting negative
stock (BR-014); direct ledger edits (writes go through RPCs).

**`/inventory/[itemId]/coverage` — Stock coverage (the wedge).** *What:* will I run out, and what to buy when.
*Why:* the core differentiator. *When:* before committing a plan. *How:* read the PAB chart + verdict; create a PR
if short. *Avoid:* ignoring an overdue PO that won't cover the period (BR-023). Refs: RPC-007, RPT-04.

## Purchasing & budget (FEAT-008/009/010)
**`/purchase-requests` + `/[prId]` — Purchase requests.** *What:* budget-gated, multi-line buy requests with
approval. *Why:* control spend before money moves. *When:* a shortage or need arises. *How:* create lines → submit
→ owner approves → receive (partial ok). *Avoid:* approving your own PR (SoD, BR-001 — "Why can't I approve?");
editing lines after approval (BR-040); over-receiving (BR-044). Refs: RPC-009, RPC-T01.

**`/budget/[planId]/check` — Budget check.** *What:* does this plan fit the budget. *Why:* the gate before
approval. *When:* before executing costed operations. *How:* read approved/committed/actual + verdict. *Note:*
currently scoped to the fertilization (أسمدة) category + seed plan (MVP). Refs: RPT-05.

**`/budgets` — Budgets.** *What:* budget overview by category. *Who:* owner/accountant/farm_manager. *How:* view
planned vs committed vs actual. Refs: BR-063.

**`/suppliers` — Suppliers.** *What:* vendor directory. *How:* any member views; owner/farm-manager/storekeeper add
(BR-062). *Avoid:* expecting to add as another role (error `42501`).

## Field & events (FEAT-011/012)
**`/m` — Field.** *What:* the mobile task list for supervisors. *Why:* low-friction field capture. *When:* in the
field. *How:* open an operation to execute. *Note:* offline-**tolerant** only — with no signal the page may not load
(true offline is not built). *Avoid:* assuming offline queueing.

**`/m/execute/[opId]` — Execute operation.** *What:* mark an operation done + log quantities. *Why:* records the
real event + consumes stock + computes actual cost. *How:* enter actual qty/labor → submit. *Avoid:* double-submit
(idempotent — "already done", BR-031); only `op.execute` roles (BR-030).

## Reports & account (FEAT-013/014/018/019/001)
**`/reports/[planId]/pva` — Planned vs actual.** *What:* planned vs actual qty/cost per operation. *Why:* see
variance + control. *When:* after executing. *How:* read the variance chart + table. Refs: RPT-06.
**`/finance/revenue-reports` — Revenue and A/R reports.** *What:* finalized revenue, pending-price deliveries,
collections, and A/R aging. *Why:* separates priced revenue from deliveries whose price is still unknown. *When:*
weekly/monthly revenue and collection review. *How:* choose period/as-of date, review KPIs/charts/tables, export
CSV when needed. *Avoid:* treating pending-price deliveries as revenue or A/R before final price. Refs: RPT-07,
RPC-053, BR-127.
**`/expenses` — Expenses.** *What:* record costs; separate owner drawings from opex. *Who:* owner/accountant/
farm_manager. *Avoid:* mixing drawings into opex (BR-111). **`/people` — Team.** *What:* staff directory
(PII-locked). *Avoid:* expecting to see phone/email/wages (BR-070/071). **`/weather` — Weather.** *What:* forecast +
advisory operation gates. *Note:* needs the server `WEATHER_API_KEY`. **`/dashboard` (owner/manager).** *What:*
role overview. *Note:* manager view uses a seed plan (MVP). **`/profile`.** *What:* your identity, role, active org
(read-only). **`/settings`.** *What:* org settings (owner only, BR-... `fn_update_org_settings`).

Maintenance: when a page is added/changed, update its block + the [Documentation Health](DOCUMENTATION-HEALTH.md)
scorecard. Arabic-first phrasing (CLAUDE.md #2); agronomy guidance stays template-not-prescription (BR-113).
