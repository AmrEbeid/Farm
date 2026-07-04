# SPEC-0028 — «سجّلت غلط»: the corrections framework (safe reversals)

*Status: **DRAFT** — design only. The last missing UX property (SPEC-0027 master plan §A property 4):
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
| C-1 | `fn_reverse_expense_payment` + pgTAP (balance restored, links, double-reversal blocked) + «سجّلت غلط؟» on expense 360 | Med (money) — migrate-first + independent review |
| C-2 | pending-cancel + reprice + wizards | Med |
| C-3 | collection reversal | Low-med |
| C-4 | custody movement reversal (subsumes the kernel's TODO error text) | Med |
| C-5 | Ledger/360 reversal-pair rendering | Low |

*Recommended build trigger: first real mistake of the pilot week (there will be one) — build C-1 that day;
the spec makes it a 1-session slice.*
