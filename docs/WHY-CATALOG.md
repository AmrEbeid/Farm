# "Why?" Catalog (rule-based) — Farm OS

*The content layer for the rule-based **"Why?"** surface ([`SPEC-0014`](SPEC-0014-knowledge-living-documentation.md)
A3). Maps the real error codes in `apps/farm-os/lib/errors.ts` and the common "why can't I…?" situations to a plain
Arabic explanation, the business rule behind it (→ `BR-NNN`), and the user's next steps. **No AI** — this is a static
explainer; the AI "Why?" is Tier C, gated behind Stage 11. Reconciled to `main` 2026-06-27. Maturity **L3**.
This is documentation content (would later populate a `WhyButton`); it is not wired into the app here.*

## By error code (from `lib/errors.ts` `DEFAULT_AR`)
| SQLSTATE | Current Arabic message | Why it happened | Rule | What to do |
|---|---|---|---|---|
| `42501` | ليس لديك صلاحية لتنفيذ هذه العملية | Your role lacks the required permission for this action (e.g. approve/execute/write). | BR-030/060–065 | Ask an owner/farm-manager to do it, or to grant the needed role. |
| `23514` | المخزون غير كافٍ لتنفيذ هذه الكمية | The action would drive stock below zero. | BR-014 | Receive/adjust stock first, or reduce the quantity. |
| `22023` | قيمة غير صالحة في الطلب | An invalid value — e.g. a bad quantity, or re-parenting a palm into an **archived** hawsha. | BR-090/093 | Correct the value; pick a **live** hawsha/line. |
| `23505` | تم تنفيذها بالفعل أو الحالة غير متوقعة | A claim-first guard fired — the operation/receipt was **already done**, or a duplicate. | BR-031/042/046 | Refresh — it's already recorded; don't resubmit. |
| `23503` | بيانات مرتبطة غير موجودة | A referenced record doesn't exist (or is in another org). | BR-052 | Pick a valid linked record in **this** org. |
| `23502` | بيانات ناقصة مطلوبة | A required field is missing. | BR-100/103 | Fill the required field and retry. |
| `P0002` | العنصر المطلوب غير موجود | The target row wasn't found (missing, archived, or not in your org). | BR-050/052 | Confirm it exists and isn't archived. |
| `40001`/`40P01` | تعارض مؤقت، يُرجى المحاولة مرة أخرى | Two writes collided (serialization/deadlock). | (concurrency) | Retry — the system protects stock accuracy under load. |
| `57014` | استغرقت العملية وقتًا طويلًا | The query timed out. | (timeout) | Retry; if it persists, narrow the request. |
| *(unmapped)* | تعذّر تنفيذ العملية. حاول مرة أخرى. | Generic fallback — never leaks raw English (CLAUDE.md #2). | BR-110 | Retry; contact support if it persists. |

## By situation ("why can't I…?")
| Question | Explanation | Rule | Options |
|---|---|---|---|
| **Why can't I approve this purchase request?** | You created it; separation-of-duties requires a **different** person (an owner) to approve. | BR-001/002/060 | Have the owner approve; you can't approve your own request. |
| **Why is the budget check blocking?** | This plan's planned spend would exceed the approved budget for the category (verdict = block). | (RPT-05) | Request a budget increase, split the purchase, or reduce scope. |
| **Why is the budget "approval-needed"?** | Spend after this op would exceed ~90% utilization. | (RPT-05) | Proceed with owner approval (a PR is linked). |
| **Why can't I receive more than ordered?** | A receipt can't exceed the remaining-on-order quantity. | BR-044 | Receive only the remaining qty; raise a new PR for more. |
| **Why can't I edit this PR's lines?** | The PR is approved/received — its lines are frozen to protect the financial commitment. | BR-040 | Revert to draft (if SoD allows) or raise a new PR. |
| **Why did my receipt do nothing the second time?** | Receipts are idempotent — the first call already posted it. | BR-046 | None needed; it's already received. |
| **Why can't I see staff phone/email or wages?** | Contact PII is service-role-only; wages need `payroll.read` (owner/accountant). | BR-070/071 | Ask an owner/accountant if you need the figure. |
| **Why did my coverage shortage not include that PO?** | An overdue PO isn't projected into the current period (so it can't mask a real shortage). | BR-023 | Update the PO's needed-by date, or treat the shortage as real. |

Maintenance: a new error code added to `lib/errors.ts` must get a row here (the Documentation Health Score checks
"Why?" coverage for a page's error codes — see [`DOCUMENTATION-HEALTH.md`](DOCUMENTATION-HEALTH.md)).
