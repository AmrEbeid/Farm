# LINKAGE-MAP — how everything is linked (connective-tissue audit, 2026-07-02)

*Read-only code audit of `origin/main` `6184961`. Grades the LINKS between modules (SOLID / WEAK / BROKEN / MISSING), not module quality (that's `REVIEW-360-2026-07-01.md`). Feeds `BOOM-PLAN-2026-07.md` §1. Paths: `app/` = `apps/farm-os/app/(app)/`, `mig/` = `apps/farm-os/supabase/migrations/`.*

## Verdict

**Farm OS is one genuinely integrated operating system — for materials — surrounded by adjacent modules.** The plan→stock→purchase→execute→event spine is transactional and FK-connected end to end (the wedge, and it works). But money, labor, yield, and signals are islands: the GL speaks exactly 3 cash source_types; the P&L bypasses the GL; execution cost dies in a JSON field; labor hours never reach an operation; nothing records what a tree produced or earned; and **no computed signal ever travels to a human** — zero notification infrastructure of any kind. Only 2 of ~8 cross-role handoffs have a real in-app queue (`/m` field queue, PR approval alert). Fix the top 3 links and the description changes from "excellent inventory OS with a farm-shaped UI" to "an integrated farm OS."

## Loop grades (summary)

| Loop | Closed stages (SOLID) | Broken/missing links |
|---|---|---|
| **1 Wedge** (plan→stock→purchase→execute→report) | plan→requirements→engine→coverage UI→PR (qty prefilled)→receipt (partial, idempotent)→multi-material execute→auto farm_event | PR creation non-atomic client DML, no FK to shortage/plan_op, `plan_id` hardcoded `SEED_PLAN_ID` (`app/inventory/[itemId]/coverage/actions.ts:53-229`); reservation BROKEN (#199/#526: earmarked, never released — no code posts a `release` — ignored at execution); **budget gate BROKEN (#157: approval reads zero budget figures, `app/purchase-requests/[prId]/actions.ts:33-62`; `budget_lines.committed/actual` written by NO code; `budget_category_id` has no FK)**; PvA joins on JSONB `farm_event.data->>'op_id'` |
| **2 Money** | expense→custody movement (1:1 enforced)→payment requests (claim-first)→journal (balanced, idempotent)→trial balance | **Execution `actual_cost` buried in `farm_event.data` JSON — no expense row, no journal (`mig/20260701230000:334`)**; receipt→GL MISSING; GL vocabulary = exactly 3 source_types (all call sites in `mig/20260701220000`); **P&L reads the `expenses` table directly, NOT the GL (`mig/20260701270000:44-52`) — P&L and trial balance can never reconcile**; labor→money MISSING; owner dashboard reads raw tables, no finance RPC |
| **3 People** | people+compensation (RLS-gated), assignees, plan-labor person links | Execution records the CALLER + a head-count integer, not assignees/hours (`mig/20260701390000:195-206`); `labor_logs.plan_op_id` FK exists but NEVER populated (form has no op picker); two labor-cost engines that never meet (`lib/payroll.ts:37-66` actual per person-month vs `:109-137` planned per-op); **attribution dies at the execution→labor_logs boundary** |
| **4 Tree** | registry hierarchy, events→event_assets/locations→palm-360 timeline | Palm treatments hardcode `p_est_cost: 0` (`app/farm/palm/[id]/actions.ts:127`); `expenses` has no `palm_id`; **harvest quantity MISSING (harvest_stage = ripeness label; `quantities` rows = material consumed, never fruit produced; zero yield tables in all 57)**; **sales/revenue MISSING (no table; revenue accounts un-postable; `finance/pnl` hardcodes `revenue = null`; `sales` exists only in draft #368)** |
| **5 Signals** | `/m` overdue alert; owner PR-approval alert; trap-maintenance flags | **No notifications table / email / push / webhook / cron / realtime ANYWHERE** (the only "send" hit is the AI assistant's block-regex); engine's authoritative verdict per-item only, one click deep — dashboards use a static `available < reorder_point` check the code itself disclaims (`app/inventory/dashboard/page.tsx:63-83`); payment-request approvals have no queue/alert; **agronomist sign-off gates NOTHING** (unsigned dose ops execute; `mig/20260701280000` header); pest catch-count spikes computed nowhere; dead RPCs: `fn_assign_plan_operation`, `fn_add_plan_labor`, `fn_pmr_unit_reconcile` |
| **6 Cross-role** | `/m` field queue (assignee-filtered); PR approval (owner rail) | Dead ends → WhatsApp/paper: sign-off (no queue, no gate); supervisor cannot assign (assign RPC dead code); payment 3-step chain queue-less; `done` is terminal (no verify step); shortages never aggregated for the buyer; pest spikes alert nobody |

## Top 10 missing/broken links by value-if-fixed (each one PR)

1. **Execution cost → expenses/GL** — insert a costed `expenses` row per execution inside `fn_execute_operation` (kind `operating`, category from item, `plan_id`/`hawsha_id`/`event_id` FKs exist, idempotent via event id). Money-rule gated.
2. **Harvest quantity capture** — `p_harvest_qty/_unit` on harvest-type ops → `quantities` row (`measure='yield'`) + 360/PvA surfacing.
3. **Revenue/sales** — land the #368 `sales` model + `fn_record_sale` posting Dr 1000 / Cr 4000 via the existing `fn_post_two_line_journal` (kernel is ready).
4. **Real budget gate (#157)** — `fn_approve_purchase_request` deriving committed (open approved PRs) + actual (expenses by category), block/override per `DECISION-0157`; add the missing FK.
5. **Reservation lifecycle (#199/#526)** — release-on-receipt OR drop reserve-at-PR (Owner decision per `DECISION-0199` first).
6. **Actual labor → operation cost** — op picker on the attendance form + execution seeds `labor_logs` from assignees; PvA joins hours×rate.
7. **Pending-actions inbox** — `fn_my_pending_actions(org)` (union of submitted PRs, payment requests by stage, unsigned dose ops, unassigned overdue ops, per caller perms) + shell badge. Cheapest structural change; converts dashboards into workflow.
8. **Engine verdict aggregation** — batch `fn_stock_coverage_all(org)` → inventory-dashboard table + owner alert count.
9. **Sign-off gates execution** — org-setting `require_signoff_for_dose_ops`; `fn_execute_operation` raises when unsigned.
10. **Referential provenance** — `farm_event.plan_op_id` FK (backfill from JSON) + `purchase_request_items.plan_op_id`; PvA switches to the FK.

Honorable mentions: `expenses.palm_id` for per-palm cost; un-hardcode `SEED_PLAN_ID` in PR-from-shortage and manager dashboard; pest catch-count thresholds; wire `fn_assign_plan_operation`.

## Closed loops — protect these

1. **Physical-stock spine** (the wedge): machine-to-machine the whole way; blemishes are control links (budget, reservations), not the material flow.
2. **Custody cash loop**: append-only, RPC-only, idempotent, balance-guarded — a real double-entry system.
3. **Palm activity history**: real per-tree memory.
4. **The field loop**: assignee → `/m` queue → execute → done. The one true cross-role handoff.
