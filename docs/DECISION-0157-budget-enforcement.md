# DECISION-0157 — Budget enforcement (chart-of-accounts mapping + cap policy)

*Status: **DECISION REQUIRED (Owner) — design + decision-support only.** No code, no migration, no data
change is performed by this document. The fix it scopes is a **money/budget** change (PROJECT RULES hard
stop + non-negotiable #1): Owner-ratified, independent-review-required, applied via a forward migration.*

*Feeds [`SPEC-0004`](SPEC-0004-accounting-and-pnl.md) (the accounting/P&L workstream — this is its Step-2
enforcement). Source: GitHub issue **#157** (open, "no real budget enforcement"). Verified 2026-06-26
against repo `main` @ prod migration `0048`.*

---

## 1. Why this is parked (the concrete blocker, with evidence)

The budget "check" today is **app-only, display-only, and hardcoded to one category** — it gates no write
and moves no money:

- `app/(app)/plans/[planId]/actions.ts` `runPlanChecks` reads `budget_lines` with a literal
  `.eq("category", "أسمدة")` and sums `est_cost` only for `subtype = "fertilization" && status = "planned"`,
  writes the result to `plan_checks`, and renders a banner. `approvePurchaseRequest`
  (`purchase-requests/[prId]/actions.ts`) consults **zero** budget figures — only status/version + the SoD
  RLS policy.
- `budget_lines.committed` / `.actual` are **written by no code** — they are frozen seed numbers. The
  `0043`/`0044` rolegate migrations only added `authorize('budget.write')` to the WITH CHECK (a
  direct-REST tamper guard); they explicitly note "no app code writes these tables."
- `purchase_requests.budget_category_id` exists (migration `0007`) but is **NULL on every row and has no
  FK** to `budget_lines` — there is no reliable PR→line link.

**Why a category-match default is wrong (the proof):** a free-text `inventory_items.category → budget_lines.category`
join only aligns 1 of 5 categories in the seed —

| `inventory_items.category` | matching `budget_lines` | result |
|---|---|---|
| `أسمدة` | `أسمدة` | ✅ the only clean match |
| `وقود` | `ري ووقود` | ❌ different string |
| `مبيدات`, `مكافحة`, `مستلزمات تعبئة` | — | ❌ no budget line |
| — | `عمالة` (labor) | ❌ no inventory feeder |

So a generalized join silently routes 4/5 categories to the wrong line or none → **charges the wrong
budget** (non-negotiable #1: never fabricate financial data / stand up a fake control). This is a genuine
chart-of-accounts decision, not a missing default.

## 2. The decisions the Owner owes (each turns a guess into a mis-charge)

1. **Mapping (chart of accounts).** How does an operation/PR line map to a `budget_line`? Recommended:
   populate `purchase_requests.budget_category_id` (FK to `budget_lines`) explicitly at PR creation
   (a picker), NOT a free-text category join. The Owner must also confirm the **canonical budget-line set**
   (the seed has only أسمدة / ري ووقود / عمالة — real ops also need مبيدات, تعبئة, مكافحة, وقود).
2. **Cap policy.** Hard-block an over-budget approval, or warn-with-owner-override + audit? SPEC-0004 §5.4
   recommends **hard-cap with an audited owner-override**, AND-ed into the existing `pr_update` SoD RLS
   predicate. Owner to confirm.
3. **Actual basis.** What feeds `committed`/`actual`? Goods-at-est-cost (interim) vs invoice-at-real-cost —
   depends on the SPEC-0004 expense-posting RPC + a real price source (#89: `est_cost` is NULL when
   `unit_cost` is unset, so a NULL-priced PR must be **rejected**, never treated as 0).

## 3. Ready-to-build slice (AFTER §2.1 + §2.2 are ratified)

- `alter table purchase_requests add constraint fk_budget_cat foreign key (budget_category_id) references budget_lines(id)`;
  backfill the picker.
- A `fn_approve_pr` SECURITY DEFINER RPC (claim-first, same pattern as `fn_post_receipt`): recompute
  `available = approved − committed − actual` for the mapped line; `raise` on overspend unless an audited
  `owner_override` is set; `committed += PR total` on approve, `committed → actual` on receipt; enforcement
  AND-ed into the `pr_update` WITH CHECK.
- **pgTAP oracle (write first):** over-budget approve → raises; under-budget → passes; owner-override →
  records a reason in `audit_log`; committed→actual on receipt; **NULL-priced PR → rejected** (not 0).

## 4. Decision log

- **2026-06-26 (held, pending Owner):** budget enforcement cannot ship autonomously — the
  `inventory_items.category ↔ budget_lines.category` default is broken for 4/5 categories (§1), and
  `committed`/`actual` are not yet a live ledger, so any cap today gates against frozen seed numbers (a fake
  control). The honest-signal Step-1 (judge a plan-op's real cost, not the old `42000` constant) already
  shipped via #190. **One Owner message unblocks §3:** the budget-line set + how a PR maps to a line + hard-cap
  vs override.
