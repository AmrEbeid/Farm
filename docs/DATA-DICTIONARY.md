# Data Dictionary — Farm OS

*Phase 2 of the Product Knowledge System ([`SPEC-0015`](SPEC-0015-product-knowledge-system.md)). Every table with a
stable `TBL-NNN` id, purpose, key columns, foreign keys, RLS posture, and the feature it serves (→ `FEAT-NNN`).
Reconciled to `main` 2026-07-01 (50 tables incl. `user_active_org`, SPEC-0018 custody/payment backend,
SPEC-0016 export-compliance slice 1, and the cash-method accounting kernel GL tables from PR #568
`20260701220000`).
Maturity **L3**. **Every tenant table is `org_id`-scoped + RLS deny-by-default**; only deviations are noted.*

## Tenancy & people
| TBL | Table | Purpose | Key columns | FKs | Notes | FEAT |
|---|---|---|---|---|---|---|
| **TBL-001** | `organization` | Tenant root | id, name, locale='ar', currency='EGP', area_unit='feddan', fiscal_year_start, settings(jsonb) | — | Read = `user_member_org_ids()` (switcher) | FEAT-001 |
| **TBL-002** | `organization_member` | Membership + role | (org_id,user_id) PK, role∈6, scope(jsonb) | organization, auth.users | INS/UPD/DEL revoked (admin only); audited | FEAT-001/002 |
| **TBL-003** | `people` | Staff directory | id, org_id, name, phone, email, position, employment_type, user_id?, reports_to_person_id? | organization, people(self) | **phone/email PII-locked (BR-070)**; `rate` dropped → TBL-004 | FEAT-019 |
| **TBL-004** | `people_compensation` | Wages (segregated) | id, org_id, person_id, rate | organization, people | FORCE RLS; `payroll.read` gate (BR-071); audited | FEAT-022 |
| **TBL-005** | `responsibility_assignments` | Person→scope responsibility matrix | id, org_id, person_id, scope_type, scope_id?, responsibility_type | organization, people | reads org-wide; writes require `responsibility.write` (BR-073) | FEAT-019 |
| **TBL-006** | `audit_log` | Immutable audit trail | id(bigint), org_id, actor_user_id, action, entity_type, entity_id, before/after(jsonb), occurred_at | organization | **SELECT-only; append-only (BR-080)** | FEAT-020 |
| **TBL-038** | `user_active_org` | Active-org preference | (user_id) PK, org_id, updated_at | auth.users, organization | Own-row read; writes via `fn_set_active_org` only | FEAT-001 |

## Structure & assets
| TBL | Table | Purpose | Key columns | FKs | Notes | FEAT |
|---|---|---|---|---|---|---|
| **TBL-007** | `farms` | Farm unit | id, org_id, name, code, area_feddan, owner/manager_person_id?, main_crop | organization, people | — | FEAT-003 |
| **TBL-008** | `sectors` | Farm subdivision (القطاع) | id, org_id, farm_id, name, code, crop, area_feddan, planting_date | organization, farms | 5 sectors (SPEC-0003) | FEAT-003 |
| **TBL-009** | `hawshat` | Plot within sector (الحوشة) | id, org_id, sector_id, name, code, area_qirat, row_count, palm_count_barhi/male | organization, sectors | counts ≥0 (BR-095) | FEAT-003 |
| **TBL-010** | `lines` | Row within hawsha (الخط) | id, org_id, hawsha_id, line_no, line_code, palm_count, direction | organization, hawshat | — | FEAT-003 |
| **TBL-011** | `assets` | Palm/tree (النخلة) | id, org_id, type='palm', parent_id?, sector/hawsha/line_id?, variety, sex, status∈6, id_tag, archived | organization, assets(self), sectors, hawshat, lines | same-org parent guard (BR-052/094) | FEAT-003/004 |
| **TBL-012** | `palm_status_history` | Palm status log | id, org_id, asset_id, status, health_status, changed_by, changed_at, reason | organization, assets | write-gated to `fn_update_palm_status` (BR-065) | FEAT-004 |
| **TBL-013** | `attachments` | Polymorphic media | id, org_id, entity_type, entity_id, storage_path, kind, caption, size_bytes, archived | organization | FORCE RLS; write `op.execute`; DEL revoked (soft) | FEAT-015 |

## Events
| TBL | Table | Purpose | Key columns | FKs | Notes | FEAT |
|---|---|---|---|---|---|---|
| **TBL-014** | `farm_event` | Activity spine (**partitioned** by month) | (id,occurred_at) PK, org_id, type, subtype, status∈8, planned_at, plan_id?, data(jsonb) | organization, people, plans | RLS on parent + partitions; BRIN(occurred_at) | FEAT-011 |
| **TBL-015** | `event_assets` | event→asset M2M | (event_id,asset_id) PK, org_id | assets, organization | — | FEAT-011 |
| **TBL-016** | `event_locations` | Denormalized ancestor chain (roll-up) | id, event_id, org_id, farm/sector/hawsha/line_id? | organization, farms/sectors/hawshat/lines | enables 360 roll-up | FEAT-011 |
| **TBL-017** | `quantities` | Event measurements | id, org_id, event_id, measure, value_num, value_den, material_id?, inventory_adjustment | organization, inventory_items | neg adjustment = consumption | FEAT-011 |
| **TBL-018** | `event_status_history` | Event status log | id, org_id, event_id, status, changed_by/at | organization | — | FEAT-011 |
| **TBL-019** | `event_followups` | Follow-up tasks | id, org_id, event_id, due_at, assigned_to_person_id?, status, note | organization, people | — | FEAT-011 |
| **TBL-020** | `event_attachments` | Event media | id, org_id, event_id, storage_path, kind, checksum | organization | predates polymorphic `attachments` | FEAT-015 |

## Inventory
| TBL | Table | Purpose | Key columns | FKs | Notes | FEAT |
|---|---|---|---|---|---|---|
| **TBL-021** | `suppliers` | Vendor master | id, org_id, name, phone, terms, lead_time_days | organization | write-gated (`0067`) | FEAT-009 |
| **TBL-022** | `inventory_items` | Material catalog | id, org_id, name, category, unit, min/max/safety_stock, reorder_point/qty, preferred_supplier_id?, expiry_tracked, unit_cost | organization, suppliers | write-gated (`0066`); DEL revoked | FEAT-006 |
| **TBL-023** | `inventory_bin` | Stock snapshot | (item_id,location) PK, org_id, on_hand, reserved, ordered, projected | organization, inventory_items | rebuild-only (BR-013) | FEAT-006 |
| **TBL-024** | `inventory_movements` | **Append-only ledger** | id, org_id, item_id, type∈9, qty, unit_cost, location, occurred_at, expiry_date, batch_no | organization, inventory_items, suppliers | INS via RPC only; no UPD/DEL (BR-010/11/12) | FEAT-006 |

## Planning
| TBL | Table | Purpose | Key columns | FKs | Notes | FEAT |
|---|---|---|---|---|---|---|
| **TBL-025** | `plans` | Operation plan | id, org_id, type, period_start/end, scope_type, scope_id?, status='draft' | organization | `plan.write` gate (BR-061) | FEAT-005 |
| **TBL-026** | `plan_operations` | Task within plan | id, org_id, plan_id, subtype, target_type/id, planned_at, responsible_person_id?, est_cost, status∈8 | organization, plans, people | est_cost ≥0; status enum (BR-100/101) | FEAT-005 |
| **TBL-027** | `plan_material_requirements` | Op bill-of-materials | id, org_id, plan_op_id, item_id, qty, unit | organization, plan_operations, inventory_items | qty ≥0 | FEAT-005 |
| **TBL-028** | `plan_labor_requirements` | Op labor needs | id, org_id, plan_op_id, person_or_team, count, days | organization, plan_operations | count/days ≥0 | FEAT-005 |
| **TBL-029** | `plan_checks` | Coverage/budget/etc. results | id, org_id, plan_id, kind∈{weather,stock,budget,labor,responsibility}, result∈{ok,warn,block}, detail(jsonb) | organization, plans | DEL gated (`0069`) | FEAT-005 |

## Purchasing & finance
| TBL | Table | Purpose | Key columns | FKs | Notes | FEAT |
|---|---|---|---|---|---|---|
| **TBL-030** | `budgets` | Spend ceilings | id, org_id, name, period, scope_type/id, category, planned/approved/committed/actual, status | organization | `budget.write` gate (BR-063) | FEAT-008 |
| **TBL-031** | `budget_lines` | Budget line items | id, org_id, budget_id, category, planned/approved/committed/actual | organization, budgets | — | FEAT-008 |
| **TBL-032** | `purchase_requests` | Procurement workflow | id, org_id, code, requested_by, needed_by, status∈6, approved_by, approved_at, version | organization, plans | explicit policies (no FOR ALL); SoD UPDATE (BR-001/060) | FEAT-009 |
| **TBL-033** | `purchase_request_items` | PR line items | id, pr_id, org_id, item_id, qty, unit, supplier_id?, est_cost, received_qty | purchase_requests, organization, inventory_items, suppliers | UNIQUE(pr_id,item_id) (BR-042); lines freeze (BR-040); `received_qty` RPC-only (BR-041) | FEAT-009/010 |
| **TBL-034** | `expenses` | Cost records | id, org_id, date, farm/sector/hawsha/plan_id?, category, supplier_id?, qty, unit_price, total, kind, status | organization, farms/sectors/hawshat/plans/suppliers | `budget.write` gate (BR-063); `kind` = opex vs drawings (BR-111) | FEAT-013 |
| **TBL-039** | `custody_accounts` | Custody float accounts | id, org_id, holder_label, holder_user_id?, target_float, active | organization | reads require `finance.read`; writes via `fn_save_custody_account` / `custody.write`; audited | FEAT-028 |
| **TBL-040** | `custody_movements` | Append-only custody cash ledger | id, org_id, custody_account_id, occurred_at, movement_type, amount_in/out, expense_id?, transfer_group_id? | organization, custody_accounts, expenses | reads require `finance.read`; inserts via `fn_record_custody_movement` or paired `fn_transfer_custody`; one side only; read reports via `fn_custody_ledger_report` / `fn_custody_cash_expense_report`; audited | FEAT-028 |
| **TBL-041** | `payment_requests` | Payment request header / approval lifecycle | id, org_id, request_no, period_start/end, status, custody_account_id?, approver stamps | organization, custody_accounts | reads require `finance.read`; writes via request RPCs; final approval owner-only; audited | FEAT-028 |
| **TBL-042** | `payment_request_lines` | Payment request expense lines | id, org_id, payment_request_id, expense_id, **paid_at, paid_by, paid_from_custody_account_id, custody_movement_id, journal_entry_id** (settlement, `20260701220000`) | organization, payment_requests, expenses, custody_accounts, custody_movements, journal_entries | RPC-only; one request per expense; only operating `post_paid_unpaid` expenses; settlement fields set by `fn_confirm_request_expense_paid` | FEAT-028/030 |

## General ledger (accounting kernel — PR #568)
| TBL | Table | Purpose | Key columns | FKs | Notes | FEAT |
|---|---|---|---|---|---|---|
| **TBL-047** | `accounts` | Chart of accounts | id, org_id, code, name_ar, account_type, normal_balance | organization | UNIQUE(org_id,code); reads `finance.read`; writes via `fn_ensure_account` (internal); audited | FEAT-030 |
| **TBL-048** | `journal_entries` | Double-entry journal header | id, org_id, entry_date, source_type, source_id, status∈{posted,reversed}, reversal_of? | organization, journal_entries(self) | UNIQUE(org_id,source_type,source_id) → idempotent posting (BR-117); reads `finance.read`; RPC-only; audited | FEAT-030 |
| **TBL-049** | `journal_lines` | Double-entry journal lines | id, org_id, journal_entry_id, account_id, debit, credit, description, custody_account_id?, custody_movement_id?, expense_id?, payment_request_id? | organization, journal_entries, accounts, custody_accounts/movements, expenses, payment_requests | CHECK one-sided ((debit>0)⊻(credit>0)); Σdebit=Σcredit per entry via deferred trigger (BR-116); reads `finance.read`; RPC-only; audited | FEAT-030 |
| **TBL-050** | `payment_request_fundings` | Owner funds received into custody for a request | id, org_id, payment_request_id, custody_account_id, amount, occurred_at, custody_movement_id?, journal_entry_id? | organization, payment_requests, custody_accounts, custody_movements, journal_entries | reads `finance.read`; writes via `fn_record_payment_request_funding`; read report via `fn_owner_funding_report`; audited | FEAT-028/030 |

## Export compliance
| TBL | Table | Purpose | Key columns | FKs | Notes | FEAT |
|---|---|---|---|---|---|---|
| **TBL-043** | `export_registrations` | GACC/CIFER market registration evidence | id, org_id, market, registration_no, enterprise_name, product, status, valid_from/to | organization | FORCE RLS; org-readable; writes require `export.write`; valid window check; audited | FEAT-029 |
| **TBL-044** | `farm_export_accreditations` | CAPQ seasonal farm-export accreditation | id, org_id, season, farm_code, crop, variety, area_feddan, approved_qty_ton, destination_market, valid_from/to, responsible_person_id? | organization, people | FORCE RLS; writes require `export.write`; same-org person guard; nonnegative/window checks; audited | FEAT-029 |
| **TBL-045** | `residue_tests` | QCAP residue-test header | id, org_id, lab, certificate_no, received_at, crop, variety, sample_ref | organization | FORCE RLS; org-readable; writes require `export.write`; audited | FEAT-029 |
| **TBL-046** | `residue_test_results` | QCAP residue-test result line | id, org_id, residue_test_id, compound, value_mg_kg, method | organization, residue_tests | FORCE RLS; writes require `export.write`; same-org parent guard; nonnegative residue value; audited | FEAT-029 |

**Hierarchies:** location `farms→sectors→hawshat→lines→assets`; planning `plans→plan_operations→{material,labor}_requirements`;
budget `budgets→budget_lines`; custody/payment `custody_accounts→custody_movements` and `payment_requests→payment_request_lines`;
export compliance `residue_tests→residue_test_results`; general ledger `journal_entries→journal_lines→accounts`
(with `payment_request_fundings` linking a request to its custody-in movement + journal entry); events denormalize
the ancestor chain in `event_locations` for roll-up.
**Note (`sales` table):** referenced by draft PR #368 (FEAT-023) — **still not on `main`** (revenue/A-R is Slice A
of [`ROADMAP-accounting-custody-2026-07-01.md`](ROADMAP-accounting-custody-2026-07-01.md)). Maintenance: new table →
next free `TBL-051` + its `FEAT`/RLS note.
