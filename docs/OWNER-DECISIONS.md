# Owner Decision Packet — Farm OS      2026-07-01 (for Amr)

The single actionable list of what's **waiting on your decision**. Every decision-free engineering task is
done (28 PRs, 10 prod migrations, 100% of the code audited — see `SESSION-BRIEF.md` / issue #505). What
remains cannot be done without an Owner choice (product / financial / architecture / people / access — which
per `CLAUDE.md` a tool must never decide silently). Ordered by value. Each: what it unblocks, the options, my
recommendation, and where the full design lives. **On your one-line answer to any item, I implement it
(define-check-first + independent review + migrate-first).**

---

## P1 — Reservation-wipe masked shortage — #512   ✅ DONE (masked shortage fixed)
**Shipped (PR #525, migration `20260701190000`), on-recommendation with a lifecycle investigation + independent
review that PROVED non-masking arithmetically.** The fix: **remove** `fn_execute_operation`'s blind bin-wide
release (it owned no per-op reserve, so it was wiping unrelated earmarks). Minimal change that cannot mask —
`reserved` can now only rise → `available` only falls → over-order, the safe direction. `tests/105` (the #512
pin) is now a passing HARD gate. **All three masked-shortage vectors are now closed (#509, #216, #512).**
**Remaining (over-order only, SAFE, never masks — owner-gated, NOT urgent):** #199 (reserved demand double-count)
+ **#526** (earmark accumulation) + a reserve double-subtract (reserving deepens the apparent shortage). A
read-only investigation proved **no autonomous fix is provably non-masking** — the reserve model has a
SPEC-vs-code contradiction, so any bin-wide change risks the cardinal sin. **The ONE decision (full evidence on
#526):**
- **Does `reserved` mean (a) EXISTING on-hand committed to a plan-op (released at EXECUTE, per SPEC-0001:18) — or
  (b) an INCOMING purchased-stock earmark (released at RECEIPT, what the live coverage wedge actually does)?**
  The formula `available = on_hand − reserved` was built for (a); the only live caller implements (b); they
  disagree. On your answer I implement the provably-safe **op/PR-keyed** model (add `plan_op_id`/`pr_id` to reserve
  movements, scope `bin.reserved` per key, net #199 op-by-op, release #526 keyed to the fulfilling PR) with the
  #512 rigor loop. **Until then I hold the current over-ordering — it's the safe state (never masks).**

## P2 — Unit-of-measure model (masked shortage, both sides) — #216   ✅ DONE
**Shipped (both sides), on-recommendation with independent review + migrate-first:** Option A single-unit
enforcement — a `plan_material_requirements` trigger + the `fn_post_movement` funnel default a null unit to the
item's canonical unit and reject a non-null mismatch; `fn_reserve_stock` no longer hardcodes `'kg'`. Demand side
**PR #521** (`20260701170000`), supply side **PR #522** (`20260701180000`). Prod was clean (0 mismatches), so it
validated with no backfill. #216 CLOSED. (Option B — a UoM conversion table for bag↔kg *entry* — remains a
future enhancement if you ever want to enter stock in non-canonical units; not needed for correctness.)

## P3 — Budget enforcement + price source — #157 (+ #89 mostly done)
**What:** #89 is largely shipped (`unit_cost` + honest-null discipline). The open item is **#157: budget
"enforcement" is display-only** — PR approval reads no budget figures; `committed`/`actual` are frozen seed;
no PR→budget-line link. Design proposal on **#157**.
**Decisions:**
7. Canonical **chart of budget lines** + how a PR line maps to one (picker vs default).
8. **Cap policy** — hard-block over-budget approval vs warn+owner-override, and the tolerance (the current 90% is a placeholder).
9. **Unknown price** at the gate — block (safe default) vs allow-with-review.
10. Who can override (typed, audited reason)? And does `committed` book at est-cost on approve → `actual` at invoice on receipt?
**Unblocks:** turns the budget gate from cosmetic into a real money control (SPEC-0004 acceptance gate).

## P4 — Access / product gates (no design needed — your call/action)
11. **Leaked-password protection** (#229iii) — enable the toggle in the Supabase Auth dashboard (1 click; no MCP path). Recommended: on.
12. **#215 control panel** — confirm scope = tenant config layer before any build (7 sub-decisions in the #215 plan). Nothing built ahead of this.
13. **Expert sign-off gates** — **#366** (care-academy agronomy content needs a named agronomist + current Egyptian pesticide-registration sign-off, non-negotiable #4) and **#368** (accounting reconciliation needs an accountant). Draft migrations `0091`/`0088`+`0097` are staged, **not applied**, behind these.
14. **#388 wage/payroll model** — greenfield (payroll isn't built); needs the wage-policy decision (piece/daily/hourly + rates) before it's worth designing.

## P5 — Environment-blocked (not a decision — needs a build-capable env)
15. **#500** — the design-system `dist` (tabs component) can't rebuild here: esbuild's postinstall is disabled by the repo's allow-scripts policy. Needs a session where DS deps can build. App-side is unaffected.

---

### Governance reminder
P1–P3 touch the stock-coverage engine / money — each needs **independent review** and is applied **migrate-first**
by someone other than the actor that wrote it (`CLAUDE.md`). I'll produce the change + evidence; you gate the apply.
Full shipped-work record and running decision log: **issue #505**.
