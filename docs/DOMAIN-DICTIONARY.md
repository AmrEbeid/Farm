# Domain Dictionary — Farm OS

*Tier 1 of the Product Knowledge System ([`SPEC-0015`](SPEC-0015-product-knowledge-system.md)). One definition per
business/domain term, with the verified Arabic↔English mapping, source of truth, relationships, and common
confusion. Merges the proposed Glossary-for-AI + Localization terms. Arabic labels are **verified against the
code** (file:symbol cited) or marked **NV** (no Arabic label found in code — proposed, needs verification).
Reconciled to `main` 2026-06-27. Maturity **L3**.*

Arabic-first is a product non-negotiable (CLAUDE.md #2). Where a term has no UI label yet, the English/DB term is
the identifier and the Arabic is a recommendation (NV).

## Structure & tenancy
| Term (EN) | Arabic | Definition | Source | Relationships / confusion |
|---|---|---|---|---|
| Organization | المؤسسة *(NV)* | A tenant. Every tenant table carries its `org_id`. | `organization` (`0001`) | Top of isolation; **a user can belong to several orgs** (active-org switch). |
| Organization member | عضو *(NV)* | A user's membership + role in one org. | `organization_member` (`0001`) | Removing a member instantly cuts access (RLS join). |
| Active org | المؤسسة النشطة *(NV)* | The org a multi-org user is currently acting in (JWT claim). | `0085`; `fn_set_active_org` | Fail-closed; narrows RLS. Confusion: ≠ "default" org. |
| Farm | المزرعة | A physical farm within an org. | `farms`; `lib/nav.ts` | Parent of sectors. |
| Sector | **القطاع** | Top structural division of a farm (5 sectors, SPEC-0003). | `StructureForm.tsx` `LEVEL_AR` | Parent of hawshat. Confusion: earlier docs said "حوض"; **code uses القطاع**. |
| Hawsha | **الحوشة** | A plot/block within a sector (≈28 total). | `StructureForm.tsx` `LEVEL_AR` | Parent of lines. Plural حوش (CLAUDE.md). |
| Line | **الخط** | A row within a hawsha. | `StructureForm.tsx` `LEVEL_AR` | Holds palms; **unique active line number per hawsha** (BR family). |
| Palm | **النخلة** | A single date palm (the leaf asset). | `StructureForm.tsx` `LEVEL_AR` | The `assets` table; canonical count 4,380 برحي / 299 ذكور (CLAUDE.md #5). |
| Offshoot / seedling | فسيلة *(NV)* | A young palm/offshoot. | — | NV — no verified UI label. |

## Roles & permissions (all verified — `lib/auth.ts`)
| Term (EN) | Arabic | Source |
|---|---|---|
| Owner | المالك | `ROLE_LABEL_AR` |
| Farm manager | مدير المزرعة | `ROLE_LABEL_AR` |
| Agricultural engineer | مهندس زراعي | `ROLE_LABEL_AR` |
| Accountant | محاسب | `ROLE_LABEL_AR` |
| Field supervisor | مشرف ميداني | `ROLE_LABEL_AR` |
| Storekeeper | أمين مخزن | `ROLE_LABEL_AR` |
| Permission | صلاحية *(NV)* | Verified strings: `structure.write`, `inventory.write`, `plan.write`, `op.execute`, `budget.write`, `payroll.read` (+ `pr.approve`). Source: `authorize()` (`0035`). |

## Events & operations
| Term (EN) | Arabic | Definition | Source | Confusion |
|---|---|---|---|---|
| Farm event | حدث *(NV)* | An append-only record of something done/observed; the operational ledger. | `farm_event` partitioned (`0004`) | The unit everything rolls up from (palm→line→hawsha→sector→farm). |
| Event type | — | One of: **operation/عملية, inspection/تفتيش, issue/ملاحظة, note/مذكرة**. | `fn_record_event` (`0083`); `RecordActivity.tsx` `TYPE_OPTIONS` | Verified. |
| Operation subtype | — | **fertilization/تسميد, irrigation/ري, spraying/رش, pollination/تلقيح, inspection/تفتيش**. | `lib/labels.ts` `SUBTYPE_AR` | Verified. Centralized in `lib/labels.ts`. |
| Operation status | — | planned/مخطط, approved/معتمد, reserved/محجوز, ready/جاهز, in_progress/قيد التنفيذ, done/منفذ, blocked/محظور, abandoned/ملغاة, skipped/متخطّاة. | `lib/labels.ts` `OP_STATUS_AR` | Verified. State machine; execution only from active statuses (BR-032). |
| Palm status | — | active/سليمة, watch/تحت المراقبة, sick/مريضة, dead/ميتة, removed/مُزالة, replaced/مُستبدلة. | `farm/palm/[id]` `STATUS_AR` | Verified. Written only via `fn_update_palm_status` (BR-065). |

## Planning
| Term (EN) | Arabic | Definition | Source |
|---|---|---|---|
| Plan | الخطة / الخطط | A forward set of operations over a period. | `lib/nav.ts` |
| Plan type | — | weekly/أسبوعية, monthly/شهرية, quarterly/ربع سنوية, annual/سنوية. | `plans/page.tsx` `PLAN_TYPE_AR` (verified) |
| Plan status | — | draft/مسودة, active/نشطة, closed/مغلقة, abandoned/ملغاة. | `plans/page.tsx` `PLAN_STATUS_AR` (verified) |
| Plan operation | عملية الخطة *(NV)* | A single planned operation (targets, labor, materials). | `plan_operations` (`0006`) |
| Plan check | فحص الخطة *(NV)* | A coverage/budget pre-execution check result. | `plan_checks`; `PlanChecksRunner.tsx` |

## Inventory & stock
| Term (EN) | Arabic | Definition | Source | Confusion |
|---|---|---|---|---|
| Inventory | المخزون | Items, stock levels, movements. | `lib/nav.ts` | — |
| Stock coverage | التغطية *(NV; "تغطية" used in UI)* | Forward projection of whether on-hand+incoming covers planned demand, and what to buy when. | `fn_stock_coverage` (`0009`) | **"تغطية" = coverage, NOT insurance.** The product wedge. |
| On hand | الموجود | Current physical stock. | `inventory/page.tsx` (verified) | — |
| Reserved | المحجوز | Stock committed to planned operations. | `inventory/page.tsx` (verified) | — |
| Available | المتاح | on_hand − reserved. | `inventory/page.tsx` (verified) | Confusion: ≠ on_hand. |
| Movement | حركة *(NV)* | A ledger entry. Types: **receipt, issue, return, adjustment, transfer, loss, expiry, reserve, release** (9, no AR labels). | `inventory_movements` (`0005`) | Append-only (BR-010..014). |
| Reservation | حجز *(NV)* | A `reserve`/`release` movement pair tying stock to an operation. | `fn_reserve_stock` (`0037`) | Released on execution. |
| Supplier | المورد / الموردون | A vendor of items. | `lib/nav.ts` (verified, plural) | — |
| Batch / expiry | تشغيلة / صلاحية *(NV)* | Optional lot + expiry tracking on a movement. | `inventory_items.expiry_tracked`, `batch_no` (`0005`) | — |

## Purchasing & finance
| Term (EN) | Arabic | Definition | Source | Confusion |
|---|---|---|---|---|
| Purchase request (PR) | طلبات الشراء | A budget-gated, multi-line request to buy, with SoD approval. | `lib/nav.ts` (verified) | Confusion: there is **no separate "purchase order"** entity yet (future). |
| PR status | — | draft/مسودة, submitted/مرسل, approved/معتمد, rejected/مرفوض, received/مُستلم, partially_received/مُستلم جزئيًا. | `purchase-requests/page.tsx` `PR_STATUS_AR` (verified) | — |
| Partial receipt | مُستلم جزئيًا | A receipt covering only some of the ordered qty. | `purchase-requests/[prId]` (verified) | — |
| Budget | الموازنة | Spend plan by farm/sector/category. | `lib/nav.ts` (verified) | The gate is decision-support + approval, not a hard DB spend cap (BUD-1). |
| Committed cost | الملتزم *(NV)* | Approved-but-unspent commitment. | `budgets`/`budget_lines` | Confusion: committed ≠ actual. |
| Actual cost | التكلفة الفعلية *(NV)* | Realized spend from done operations + expenses. | `expenses`; `reports/[planId]/pva` | The basis of planned-vs-actual. |
| Expense | المصروفات | A recorded cost; `kind` separates opex from owner drawings. | `lib/nav.ts` (verified); `expenses.kind` | CLAUDE.md #6: keep drawings (مسحوبات) separate. |

## Media, audit, people
| Term (EN) | Arabic | Definition | Source |
|---|---|---|---|
| Attachment | مرفق *(NV)* | A file (receipt/photo/doc) on an entity; soft-delete posture. | `attachments` (`0082`); `farm-media` bucket |
| Audit log | سجل التدقيق *(NV)* | Immutable record of DML on audited tables. | `audit_log` (`0002`/`0008`) |
| Person | فرد *(NV)* | A staff member (PII-locked: phone/email service-role only). | `people` (`0002`/`0048`) |
| Employment type | — | permanent/دائم, seasonal/موسمي, daily/يومي, contractor/مقاول. | `people/page.tsx` `EMP_TYPE_AR` (verified) |
| Compensation | الأجور *(NV)* | Wage data, readable only with `payroll.read`. | `people_compensation` (`0046`) |

**Maintenance:** when a UI label is added/changed, update the Arabic + flip NV→verified with the file:symbol.
New term → add to the right group. Machine-readable export (for AI) is a Phase-2/5 follow-on (SPEC-0015).
