# Permissions Matrix — Farm OS

*Phase 2 of the Product Knowledge System ([`SPEC-0015`](SPEC-0015-product-knowledge-system.md)). The authoritative
role × permission × page × action map. **Enforcement is in Postgres** (RLS + `authorize()` + SoD triggers), not the
UI. Reconciled to `main` 2026-06-30 (`lib/auth.ts`, `authorize()` union through `20260622000092`, role-gates,
verified page guards).
Maturity **L3**.*

## Roles (verified `lib/auth.ts`)
`owner` (المالك) · `farm_manager` (مدير المزرعة) · `agri_engineer` (مهندس زراعي) · `accountant` (محاسب) ·
`supervisor` (مشرف ميداني) · `storekeeper` (أمين مخزن). A user may belong to **multiple orgs**, with **one role
per org**; the **active-org** JWT claim narrows RLS to the current org (BR-054).

## Permission → roles (the `authorize(perm, org)` map)
| Permission | Granted to | Governs | BR |
|---|---|---|---|
| `pr.approve` | **owner** | Approve purchase requests | BR-060 |
| `plan.write` | owner, farm_manager | Create/edit plans & operations | BR-061 |
| `op.execute` | owner, farm_manager, agri_engineer, supervisor | Execute operations, record events, attach media, palm status | BR-030/065 |
| `inventory.write` | owner, farm_manager, storekeeper | Post movements/receipts, reserve, write items/suppliers | BR-062 |
| `budget.write` | owner, accountant | Write budgets, budget lines, expenses | BR-063 |
| `payroll.read` | owner, accountant | Read `people_compensation` (wages) | BR-071 |
| `structure.write` | owner, farm_manager | Create/edit/archive farm structure | BR-064 |
| `responsibility.write` | owner, farm_manager | Write responsibility assignments | BR-073 |
| `finance.read` | owner, accountant | Read finance-confidential custody/payment-request rows and derived balances | BR-066 |
| `custody.write` | owner, accountant | Create custody accounts and post custody movements through RPCs | BR-067 |
| `request.prepare` | owner, accountant | Create/submit payment requests and add eligible post-paid lines | BR-068 |
| `request.approve.op` | owner, accountant | Operationally approve payment requests | BR-069 |
| `request.approve.final` | owner | Final-approve payment requests | BR-069 |
| `export.write` | owner, farm_manager | Write export registrations/accreditations/residue tests/results | BR-074 |
| `academy.write` | owner, agri_engineer | Forward-compatible Care Academy content write gate; tables/routes still draft #366 | BR-075 |

## Role × capability (✓ = allowed, via the permission above)
| Capability | owner | farm_manager | agri_engineer | accountant | supervisor | storekeeper |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Approve PR | ✓ | | | | | |
| Create/edit plan | ✓ | ✓ | | | | |
| Execute operation / record event | ✓ | ✓ | ✓ | | ✓ | |
| Edit farm structure | ✓ | ✓ | | | | |
| Write inventory / receive / reserve | ✓ | ✓ | | | | ✓ |
| Write budget / expenses | ✓ | | | ✓ | | |
| Read wages (payroll) | ✓ | | | ✓ | | |
| Edit responsibility assignments | ✓ | ✓ | | | | |
| Read custody/payment requests | ✓ | | | ✓ | | |
| Record custody movements | ✓ | | | ✓ | | |
| Prepare payment requests | ✓ | | | ✓ | | |
| Operationally approve payment requests | ✓ | | | ✓ | | |
| Final-approve payment requests | ✓ | | | | | |
| Write export compliance records | ✓ | ✓ | | | | |
| Write academy content (permission only; draft tables held) | ✓ | | ✓ | | | |
| Read core farm data (RLS, own org) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Page access (verified guards)
| Route | Guard | Who |
|---|---|---|
| `(app)` layout (all pages) | `requireMembership()` | any authenticated org member |
| `/dashboard` | `requireMembership()` (routes by role) | all → role landing |
| `/dashboard/owner` | `requireRole(["owner","accountant"])` | owner, accountant |
| `/dashboard/manager` | `requireRole(["farm_manager","agri_engineer"])` | farm_manager, agri_engineer |
| `/settings` | nav `roles:["owner"]` | owner |
| `/expenses`, `/budgets` | nav `roles:["owner","accountant","farm_manager"]` | those roles |
| `/people` | nav `roles:["owner","farm_manager","agri_engineer","accountant"]` | those roles |
| `/m` (field) | nav `roles:["supervisor","agri_engineer","owner","farm_manager"]` | those roles |
| `/farm*`, `/plans*`, `/inventory*`, `/purchase-requests*`, `/suppliers`, `/weather`, `/budget/[planId]/check`, `/reports/[planId]/pva`, `/profile` | `requireMembership()` | any member (writes still gated server-side) |

> **Read-broad, write-gated:** most detail pages are readable by any member; the *mutations* are gated in the RPC/RLS
> (e.g. `/suppliers` read = any member, but `createSupplier` is rejected unless `authorize('inventory.write')`).

## Separation of Duties & isolation invariants
| Invariant | Rule | BR |
|---|---|---|
| PR self-approval | requester ≠ approver; `requested_by` immutable; approver stamped from `auth.uid()` | BR-001/002 |
| PR revert SoD | revert blocked when requester = approver | BR-003 |
| Tenant isolation | RLS deny-by-default + FORCE RLS; cross-org FK rejected; anon denied | BR-050/51/52/53 |
| Export compliance refs | export-compliance rows are org-readable, `export.write`-writable, and same-org for responsible person/residue parent | BR-052/074 |
| PII | phone/email service-role only; wages `payroll.read` only | BR-070/071 |
| Audit | immutable `audit_log`; membership/people changes audited (PII redacted) | BR-080/081 |

## Admin / support operator (planned — NOT built)
A **platform-operator** role for the commercial layer (suspend/extend/upgrade tenants, admin console) must be
**outside** the six tenant roles, audited, no raw table access — see [`SPEC-0013`](SPEC-0013-commercial-saas-layer.md)
S5 / FEAT-027. Today there is no such role. Maintenance: when a permission/role/gate changes, update this matrix +
the relevant `BR` and `pageMeta`.
