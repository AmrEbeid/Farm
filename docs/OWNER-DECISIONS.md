# Owner Decision Packet — Farm OS      2026-07-01 (for Amr)

The single actionable list of what's **waiting on your decision**. Every decision-free engineering task is
done (28 PRs, 10 prod migrations, 100% of the code audited — see `SESSION-BRIEF.md` / issue #505). What
remains cannot be done without an Owner choice (product / financial / architecture / people / access — which
per `CLAUDE.md` a tool must never decide silently). Ordered by value. Each: what it unblocks, the options, my
recommendation, and where the full design lives. **On your one-line answer to any item, I implement it
(define-check-first + independent review + migrate-first).**

---

## P1 — Reservation model (HIGH: a masked shortage, the cardinal sin) — #512 + #199   ⏳ NEEDS ONE DECISION
**What:** executing an operation posts a blind bin-wide stock `release` not scoped to the op that reserved, so
executing op B can wipe op A's earmark → A's shortage is masked. Design proposal (op-keyed reservations) on **#512**.
**Why I did NOT auto-implement this** (unlike #216): the reserve/release keying is fundamentally broken —
reserve posts under `SEED_PLAN_ID` (the coverage wedge), release under the op's real plan, with no op-level
identity — so fixing execute's blind release ALONE would break the lifecycle (reserves would accumulate,
never released). It needs a genuine model decision + coordinated app changes, not a surgical patch.
**Decisions (the blocker is #3):**
1. **Granularity** — reservations keyed to the operation (recommended; required to fix cleanly) vs the plan.
2. **#199 semantics** — how a reserved op's demand is counted once: **net by backing reserve** (recommended, safe) vs exclude reserved ops from demand (unsafe) vs stop subtracting reserved from available (changes what "available" means).
3. **Reserve-on-approval? (the key call)** — today the only reserve is the coverage wedge; the clean fix needs the full approve→reserve(op-keyed)→execute→issue lifecycle. Confirm you want it, and I implement the whole thing (schema `plan_op_id` + 4 RPCs + app) with the same rigor loop used for #216.
**Unblocks:** removes the highest-risk masking path; unpins `tests/105`.

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
