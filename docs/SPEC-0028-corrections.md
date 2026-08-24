# SPEC-0028 — «سجّلت غلط»: the corrections framework (safe reversals)

*Status: **ACTIVE** — C-1 and C-4 are released in production; C-2, C-3 and C-5 remain design only. The last missing UX property
(SPEC-0027 master plan §A property 4):
every mistake has a guided correction. Principle: **posted money is never edited — it is reversed**,
with both entries linked, a mandatory reason, and plain-Arabic wizards that state exactly what will
happen. `journal_entries.reversal_of` exists since the kernel (20260701220000) — unused until now.*

## 0. The correction map (artifact → safe path)

| What was recorded wrong | State | The safe correction |
|---|---|---|
| Expense, **unrouted** | no journal, no custody | Direct edit already allowed (guards re-validate) — nothing new needed |
| Expense **paid from custody** | movement + journal exist | **C-1 `fn_reverse_expense_payment`**: mirror custody movement (money back in) + reversal journal (`reversal_of` set) + expense returns to unrouted (editable again) or `cancelled` |
| Sale, **pending price** | posts nothing | **C-2 `fn_cancel_pending_sale`**: guarded delete (only while pending + zero collections). بون serial gaps are legitimate history — the cancel reason is audit-logged |
| Sale, **finalized — wrong price** | revenue journal posted | **C-2 `fn_reprice_sale`**: reversal journal → back to pending → finalize at the right price (one wizard, two postings, both linked) |
| Sale, **finalized — wholly wrong** | journal + maybe collections | reverse collections first (C-3), then full sale reversal |
| **Collection** wrong | journal posted, A/R reduced | **C-3 `fn_reverse_collection`**: reversal journal + row marked reversed (never deleted) |
| **Custody movement** standalone | movement + maybe journal | **C-4 `fn_reverse_custody_movement`**: mirror movement + reversal journal — replaces today's error-message advice ("post a reversal") with an actual button |
| **Execution** (قطف/عملية) | stock demand posted | Deferred: engine adjustments are shortage-mask-sensitive — needs its own review (v2) |

## 1. Framework rules (every C-slice obeys)
1. **Reversal, never edit**: original rows keep their truth; the mirror carries `reversal_of` and shows
   both ways in every ledger/360 («عُكس بواسطة…» / «عكسٌ لـ…»).
2. **Reason mandatory** (free text, audited) — «سجّلت غلط» is a reason too, but it must be said.
3. **Same gate as creation** + money paths require `budget.write`. No authorize() changes.
4. **UI**: one «سجّلت غلط؟» affordance on each detail page → a wizard that says in plain Arabic exactly
   what will be posted («سيُعاد ٥٬٠٠٠ ج إلى عهدة X ويُقيَّد قيد عكسي — صحيح؟»).
5. **Idempotent + race-safe**: a reversal of a reversal is blocked; already-reversed is a friendly no-op.
6. المعاملات ledger shows reversal pairs adjacent with a ↩ marker; totals stay honest (they net out).

## 2. Slices
| # | Contents | Risk |
|---|---|---|
| C-1 | `fn_reverse_expense_payment` + pgTAP (balance restored, links, double-reversal blocked) + «سجّلت غلط؟» on expense 360 | Released 2026-08-06 |
| C-2 | pending-cancel + reprice + wizards | Med |
| C-3 | collection reversal | Low-med |
| C-4 | custody movement reversal (subsumes the kernel's TODO error text) | Released 2026-08-22 through PR #1008 |
| C-5 | Ledger/360 reversal-pair rendering | Low |

*Recommended build trigger: first real mistake of the pilot week (there will be one) — build C-1 that day;
the spec makes it a 1-session slice.*

## 3. C-1 released contract (production since 2026-08-06)

- The original expense, custody cash-out amount/details and journal remain evidence. The original movement
  receives only reciprocal reversal status/link fields, and one unique compensating
  cash-in links to the original movement through `reversal_of`; the existing journal reversal helper creates
  the linked mirror journal and enforces both original-period and reversal-period locks.
- The owner/accountant chooses one closed outcome: `unrouted` restores the exact `NULL` payment state and
  immediately exposes a guided edit-and-reroute control on the expense page; `cancelled` uses the existing
  P&L-excluded void state when the whole expense was wrong. Both require a written reason and explicit date.
- The `unrouted` follow-up updates the corrected fields and chooses custody, unpaid/request, or no route through
  one row-locked `fn_correct_and_route_reversed_expense` transaction. Concurrent/stale submissions fail closed;
  the application never leaves an edited amount half-routed because a second database call failed.
- The RPC takes expense and movement row locks, requires both `custody.write` and `budget.write`, is active-org
  scoped, binds the request to the exact displayed movement ID, and returns the existing result on an exact
  replay. A unique partial index prevents two reversal
  movements even under concurrent submissions.
- Any payment-request line or request-linked movement fails closed. Request settlement has additional line,
  funding and lifecycle state, so reversing it inside C-1 would create a new mismatch; that requires a separate
  request-level correction design and is not silently approximated here.
- A same-account, same-amount unlinked cash-in recorded after the original payment is treated as a possible
  legacy manual correction. C-1 fails closed until finance reconciles that evidence, preventing the custody
  balance from being restored twice.
- The expense 360 page shows the original and reversal movements together. It never describes the original as
  deleted, and the guided Arabic control is rendered only to owner/accountant on an eligible custody-paid row.

## 4. C-4 released contract (production since 2026-08-22)

- C-4 applies only to a journaled standalone `استلام عهدة من المالك` cash-in. Expense, payment-request,
  transfer, journal-less and reversal rows fail closed and stay on their dedicated correction paths.
- The owner/accountant opens the movement 360 page, supplies an explicit correction date and reason, and sees
  the original amount/account before confirming. The control is hidden when the row is ineligible.
- One transaction locks the custody account before the movement, verifies the exact two-line owner-funding
  journal, checks the live balance floor, appends an equal cash-out mirror and journal reversal, and links both
  directions. No original amount, date or description is overwritten.
- Exact retries return the existing result. A changed reason/date, a reversal before the original journal date,
  either locked period, a consumed balance, a second reversal or direct use of the generic journal-reversal RPC
  fails closed. The generic route remains available for ordinary journals but cannot bypass C-4 for owner funding.
- Migration `20260822140600` is append-only/replay-tested; pgTAP `206` covers the contract. Independent money
  review approved the final lock-order, malformed-link, future-date and damaged-replay fixes. It was applied
  migrate-first in the 21-migration dependable-accounting production batch, then PR #1008 merged as
  `046a14e902ab1c0e4f3b3dbfa636937edff88c55` and deployed successfully. Authenticated real-record role smoke
  remains part of the wider accounting acceptance gate, not a reason to describe C-4 as unreleased.
