# RPC Catalog — Farm OS

*Phase 2 of the Product Knowledge System ([`SPEC-0015`](SPEC-0015-product-knowledge-system.md)). Every server
function with a stable `RPC-NNN` id: purpose, args, return, the rule it enforces (→ `BR-NNN`), side effects, and
the feature it serves (→ `FEAT-NNN`). Reconciled to `main` 2026-07-01 (through the cash-method accounting kernel
`20260701220000`, PR #568 — GL + custody settlement; prior SPEC-0018 custody/payment backend
`20260629150000`/`20260629150100`). Maturity **L3**.
All SECURITY DEFINER functions pin `search_path=''` (BR-055) and reject `anon` (BR-053).*

## Callable RPCs (client entry points)
| RPC | Function | Args (high level) | Returns | Purpose | Enforces | Writes | FEAT |
|---|---|---|---|---|---|---|---|
| **RPC-001** | `user_org_ids()` | — | setof uuid | Caller's accessible org(s); narrows to active-org claim | BR-050/BR-054 | (reads) | FEAT-001 |
| **RPC-002** | `user_member_org_ids()` | — | setof uuid | Full membership set (org switcher) | BR-050 | (reads) | FEAT-001 |
| **RPC-003** | `authorize(perm, p_org)` | perm, org | boolean | Org-scoped permission check (1-arg form dropped in `0035`) | BR-060..065 | (reads) | FEAT-002 |
| **RPC-004** | `custom_access_token_hook(event)` | jsonb | jsonb | Inject membership-validated `active_org_id` JWT claim at mint | BR-054 | reads `user_active_org` | FEAT-001 |
| **RPC-005** | `fn_set_active_org(p_org)` | org | void | Set active-org preference (membership-validated) | BR-054 | `user_active_org` | FEAT-001 |
| **RPC-006** | `fn_update_org_settings(p_org,…)` | org, name, locale, currency, area_unit, fy_start | void | Update org profile; owner-only, whitelisted cols | owner gate | `organization` | FEAT-001 |
| **RPC-007** | `fn_stock_coverage(p_item,p_location,p_horizon_weeks)` | item, 'main', 8 | jsonb | Forward coverage: on-hand/reserved/available/PAB/shortfall/recommend_qty | BR-021/22/23/24 | (reads) | FEAT-007 |
| **RPC-008** | `fn_post_movement(…)` | item,type,qty,… | numeric | **Internal** ledger primitive; append movement, rebuild bin | BR-010/014 | `inventory_movements`,`inventory_bin` | FEAT-006 |
| **RPC-009** | `fn_post_receipt(p_pr_id,p_lines)` | pr, lines? | jsonb | Atomic claim-first PR receipt (partial-aware) | BR-041/44/45/46 | `purchase_requests`,movements,bin | FEAT-010 |
| **RPC-010** | `fn_reserve_stock(p_item,p_qty,p_plan_id)` | item,qty,plan | numeric | Role-gated reserve wrapper (only client reserve entry) | BR-062 | movements,bin | FEAT-006 |
| **RPC-011** | `fn_bin_rebuild(p_item,p_location)` | item,'main' | numeric | **Internal** ledger-backed bin reconciliation | BR-014 | `inventory_bin` | FEAT-006 |
| **RPC-012** | `fn_create_plan(…)` | type,start,end,scope | jsonb{id} | Create draft plan; resolve org from scope | BR-061 | `plans` | FEAT-005 |
| **RPC-013** | `fn_set_plan_status(p_plan_id,p_status)` | plan,status | jsonb | Plan status transition (draft/active/closed/abandoned) | BR-061/101 | `plans` | FEAT-005 |
| **RPC-014** | `fn_add_plan_operation(…)` | plan,subtype,date,cost,item,qty,unit | jsonb | Atomically create op + material req; dedup natural key | BR-061/100 | `plan_operations`,`plan_material_requirements` | FEAT-005 |
| **RPC-015** | `fn_assign_plan_operation(p_op_id,p_person_id)` | op,person | jsonb | Assign responsible person (same-org) | BR-061/072 | `plan_operations` | FEAT-005 |
| **RPC-016** | `fn_add_plan_labor(…)` | op,person_or_team,count,days | jsonb | Capture labor requirement (non-negative) | BR-061/100 | `plan_labor_requirements` | FEAT-005 |
| **RPC-017** | `fn_execute_operation(p_op_id,p_actual_qty,p_labor_count,p_note)` | op,qty,labor,note | jsonb | Atomic claim-first execute → event+quantities+issue/release | BR-030/31/32/33 | `plan_operations`,`farm_event`,`event_locations`,`quantities`,movements,bin | FEAT-012 |
| **RPC-018** | `fn_record_event(…)` | location,type,subtype,status,… | jsonb | Ad-hoc event on any node; rolls up ancestor chain | BR-034/104 | `farm_event`,`event_locations`,`event_assets`,`event_status_history`,`quantities` | FEAT-011 |
| **RPC-019** | `fn_set_event_status(p_event_id,p_status,p_note)` | event,status,note | jsonb | Flip event status + history | BR-034 | `farm_event`,`event_status_history` | FEAT-011 |
| **RPC-020** | `fn_add_event_followup(…)` | event,note,due,assignee | jsonb | Add follow-up task to event | BR-034/072 | `event_followups` | FEAT-011 |
| **RPC-021** | `fn_save_sector(…)` | id?,farm,name,code,… | jsonb{id} | Create/edit sector | BR-064 | `sectors` | FEAT-003 |
| **RPC-022** | `fn_save_hawsha(…)` | id?,sector,name,code,counts… | jsonb{id} | Create/edit hawsha (counts ≥0; edit coalesces) | BR-064/095 | `hawshat` | FEAT-003 |
| **RPC-023** | `fn_save_line(…)` | id?,hawsha,line_no,… | jsonb{id} | Create/edit line | BR-064 | `lines` | FEAT-003 |
| **RPC-024** | `fn_save_palm(…)` | id?,hawsha,line?,…sex,tag | jsonb{id} | Create/edit palm; reject archived/cross-org re-parent | BR-090/93/94 | `assets` | FEAT-003 |
| **RPC-025** | `fn_archive_structure(p_type,p_id,p_archived)` | type,id,archived | jsonb | Soft-delete/restore + cascade (provenance-aware) | BR-091/092 | `sectors`,`hawshat`,`lines`,`assets` | FEAT-003 |
| **RPC-026** | `fn_update_palm_status(p_asset_id,p_status,p_note)` | asset,status,note | jsonb | Atomic palm status flip + history | BR-065 | `assets`,`palm_status_history` | FEAT-004 |
| **RPC-027** | `fn_add_attachment(…)` | entity,path,kind,… | jsonb | Attach media; 25 MB ceiling; org-folder path check | BR-052 | `attachments` | FEAT-015 |
| **RPC-028** | `fn_archive_attachment(p_id,p_archived)` | id,archived | jsonb | Soft-archive/restore attachment | BR-056 | `attachments` | FEAT-015 |
| **RPC-029** | `fn_save_custody_account(…)` | id?,org,holder,target,active | uuid | Create/update custody float accounts | BR-067 | `custody_accounts` | FEAT-028 |
| **RPC-030** | `fn_record_custody_movement(…)` | account,type,in,out,date?,expense?,note? | uuid | Post custody cash movement; expense-linked cash-outs are routed and exact-total only | BR-047/067 | `custody_movements` | FEAT-028 |
| **RPC-031** | `fn_set_expense_payment_status(…)` | expense,status,custody_account?,paid_by? | void | Set payment routing; `paid_from_custody` posts one linked cash out | BR-047/048 | `expenses`,`custody_movements` | FEAT-028 |
| **RPC-032** | `fn_custody_balance(p_account)` | account | numeric | Derived custody balance = sum(in)-sum(out), finance-gated | BR-066 | (reads) | FEAT-028 |
| **RPC-033** | `fn_set_expense_kind(p_id,p_kind)` | expense,kind | jsonb | Set operating/drawing/capex classification | BR-111 | `expenses` | FEAT-013/028 |
| **RPC-034** | `fn_create_payment_request(…)` | org,period,custody_account?,note? | uuid | Create draft request with per-org request_no | BR-068 | `payment_requests` | FEAT-028 |
| **RPC-035** | `fn_add_expense_to_request(p_request,p_expense)` | request,expense | uuid | Add eligible operating post-paid expense to a draft request | BR-048/068 | `payment_request_lines` | FEAT-028 |
| **RPC-036** | `fn_submit_payment_request(p_request)` | request | void | Draft -> submitted | BR-068/069 | `payment_requests` | FEAT-028 |
| **RPC-037** | `fn_approve_request_operational(p_request)` | request | void | Submitted -> operationally approved | BR-069 | `payment_requests` | FEAT-028 |
| **RPC-038** | `fn_approve_request_final(p_request)` | request | void | Operationally approved -> final approved (owner only) | BR-069 | `payment_requests` | FEAT-028 |
| **RPC-039** | `fn_payment_request_totals(p_request)` | request | jsonb | Derived net request = post-paid unpaid + custody top-up | BR-048/066 | (reads) | FEAT-028 |
| **RPC-040** | `fn_accounting_trial_balance(p_org)` | org | jsonb | Finance-gated trial balance: debit/credit totals + balance per account | BR-066/116 | (reads) | FEAT-030 |
| **RPC-041** | `fn_record_payment_request_funding(…)` | request,custody_account,amount,date?,note? | jsonb | Record owner funds into custody (amount_in) **before** payout; posts Dr custody / Cr owner-funding | BR-067/119 | `payment_request_fundings`,`custody_movements`,`journal_entries`,`journal_lines` | FEAT-028/030 |
| **RPC-042** | `fn_confirm_request_expense_paid(…)` | request,expense,custody_account,date?,paid_by?,note? | jsonb | Confirm a request line paid from a chosen custody source; posts cash-out + Dr expense-kind account / Cr custody | BR-047/119 | `payment_request_lines`,`custody_movements`,`journal_entries`,`journal_lines` | FEAT-028/030 |
| **RPC-043** | `fn_close_payment_request(p_request)` | request | jsonb | Close a request only once every line has `paid_at` | BR-069/120 | `payment_requests` | FEAT-028/030 |
| **RPC-044** | `fn_transfer_custody(…)` | from_account,to_account,amount,date?,note? | uuid | Transfer custody cash between two holders as one linked out/in pair; no journal/P&L effect | BR-121 | `custody_movements` | FEAT-028 |

## Trigger functions (fire on table DML)
| RPC | Function | Table / when | Enforces | BR | FEAT |
|---|---|---|---|---|---|
| **RPC-T01** | `pr_guard_approval` | `purchase_requests` BEFORE UPDATE | SoD: requester≠approver, `requested_by` immutable, stamps approver from `auth.uid()` | BR-001/002 | FEAT-009 |
| **RPC-T02** | `fn_pr_bump_version` | `purchase_requests` BEFORE UPDATE | optimistic-lock version bump (AP-3) | — | FEAT-009 |
| **RPC-T03** | `fn_pr_items_lock_when_decided` | `purchase_request_items` BEFORE INS/UPD/DEL | freeze lines once PR approved/received | BR-040 | FEAT-009 |
| **RPC-T04** | `inv_guard_receipt_no_open_po` | `inventory_movements` BEFORE INSERT | reject receipt while approved-open PO exists (ENGINE-DC) | BR-020 | FEAT-007 |
| **RPC-T05** | `fn_audit` | audited tables AFTER INS/UPD/DEL | append immutable audit row | BR-081 | FEAT-020 |
| **RPC-T06** | `fn_audit_org_member` | `organization_member` | audit membership/privilege changes | BR-081 | FEAT-020 |
| **RPC-T07** | `fn_audit_people` | `people` | audit with phone/email redaction | BR-070/081 | FEAT-019/020 |
| **RPC-T08** | `assets_parent_same_org` | `assets` BEFORE INS/UPD | parent FK same-org guard | BR-052 | FEAT-003 |
| **RPC-T09** | `people_reports_to_same_org` | `people` BEFORE INS/UPD | `reports_to` same-org guard | BR-072 | FEAT-019 |
| **RPC-T10** | `expense_guard_routed_money_immutable` | `expenses` BEFORE UPDATE OF total,kind | routed expense amount/kind immutable after custody/payment routing | BR-047/048 | FEAT-028 |
| **RPC-T11** | `journal_lines_balance_guard` | `journal_lines` deferred constraint trigger (per entry, at commit) | reject any journal entry whose Σdebit ≠ Σcredit (double-entry integrity) | BR-116 | FEAT-030 |

**Notes:** `fn_post_movement` (RPC-008) and `fn_bin_rebuild` (RPC-011) are **internal** (EXECUTE revoked from
`authenticated` in `0037`/`0030`) — clients reserve via `fn_reserve_stock` (RPC-010) and receive via
`fn_post_receipt` (RPC-009). The GL kernel helpers `fn_ensure_account`, `fn_account_for_expense_kind`, and
`fn_post_two_line_journal` (`20260701220000`) are likewise **internal** (no client EXECUTE) — journals are posted
only as a side effect of the gated finance RPCs. RPC-030/031/035/038/039 were **re-emitted** in `20260701220000`
to post the matching journal entry / carry settlement fields (FEAT-030). Idempotency = claim-first (RPC-009,
RPC-017) + unique `(org, source_type, source_id)` on journal postings (RPC-041/042, BR-117). Atomicity = single
transaction (RPC-009, RPC-014, RPC-017, RPC-018, RPC-026, RPC-031, RPC-034..RPC-038, RPC-041..RPC-043). Maintenance:
a new RPC → next free `RPC-NNN` + add its `BR`/`FEAT`.
