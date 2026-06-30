# SPEC-0018 — العهدة وطلبات الصرف (Custody & Payment Requests)

*Status: **Built on `main`**. Backend schema/RPCs were reviewed, applied to Farm prod, and merged via #468
(`27065f1`). Frontend routes/actions were refreshed against that live backend and merged via #474 (`2eb6025`).
This spec intentionally avoids real line-item amounts, receipt details, worker matrices, and payment identifiers;
real Ebeid financial/PII import remains Stage-M gated.*

Related docs: [`FEATURE-REGISTRY`](FEATURE-REGISTRY.md) `FEAT-028`,
[`DATA-DICTIONARY`](DATA-DICTIONARY.md) `TBL-039..042`,
[`RPC-CATALOG`](RPC-CATALOG.md) `RPC-029..039`, and
[`BUSINESS-RULES-CATALOG`](BUSINESS-RULES-CATALOG.md) `BR-047/048/066..069`.

---

## 1. Problem

The paper «إذن صرف المزارع» mixes three finance truths that must not drift:

- a permanent custody float held by farm staff,
- cash expenses paid from that custody,
- post-paid operating expenses requested from the owner.

Before SPEC-0018, the process was hand-totaled, proof lived outside the app, and the custody top-up was computed
manually. The main risks were stale balances, missing approval trace, and double-counting a cash-paid expense in an
owner payment request.

## 2. Built Scope

SPEC-0018 ships the first auditable custody/payment-request slice:

- custody float accounts and append-only custody movements,
- payment routing columns on `expenses`,
- monthly payment request headers and lines,
- RPC-only write paths with RLS/permission checks,
- derived custody balance and payment-request totals,
- `/custody` module dashboard,
- `/custody/request/[requestId]` printable request 360 page,
- lifecycle actions through final owner approval.

No new migration is required after #468. #474 was frontend-only.

## 3. Money Rules

- **Current custody = Σ(amount_in) − Σ(amount_out)** from `custody_movements`.
- A `paid_from_custody` expense posts exactly one linked custody cash out-movement equal to the expense total.
- A `post_paid_unpaid` expense is eligible for a payment request and does not hit custody.
- **Custody top-up = MAX(0, target_float − current_custody)**.
- **Net request = post_paid_unpaid linked request lines + custody top-up**.
- `drawing` and `capex` expenses are excluded from custody/request math; only `operating` expenses can use
  custody/request routing.
- Routed expense amount/kind is immutable; corrections must be explicit reversals/new lines.

## 4. Tables

Implemented in `apps/farm-os/supabase/migrations/20260629150000_custody_and_expense_payment.sql` and
`20260629150100_payment_requests.sql`.

| Table | Purpose | Notes |
|---|---|---|
| `custody_accounts` | Custody float account per holder | `holder_label`, optional `holder_user_id`, `target_float`, `active`; finance-read RLS; writes via `fn_save_custody_account`. |
| `custody_movements` | Append-only custody cash ledger | exactly one of `amount_in`/`amount_out` must be positive; optional `expense_id`; direct DML revoked. |
| `payment_requests` | Monthly request header/lifecycle | per-org `request_no`, period, status, optional linked custody account, approver stamps. |
| `payment_request_lines` | Expenses included in a request | one request per expense; only operating `post_paid_unpaid` expenses accepted by RPC. |
| `expenses` extension | Payment routing | `payment_status`, `paid_by`, and `kind` are present in this apply path; routing fields are RPC-controlled. |

The receipt/media extension is not part of the shipped slice. Existing `attachments` remains available for node
media; finance-confidential receipt handling needs a later receipt/proof slice before real receipt images are
imported.

## 5. RPCs

Client write access is through SECURITY DEFINER RPCs only; direct table writes are revoked for custody/payment
tables.

| RPC | Purpose |
|---|---|
| `fn_save_custody_account` | Create/update a custody account. |
| `fn_record_custody_movement` | Post a custody movement; validates same org, one-sided amount, and exact routed expense cash-outs. |
| `fn_set_expense_payment_status` | Set payment routing; `paid_from_custody` posts the linked cash movement once. |
| `fn_custody_balance` | Derived account balance, finance-read gated. |
| `fn_create_payment_request` | Create a draft request with the next per-org request number. |
| `fn_add_expense_to_request` | Add an eligible operating post-paid expense to a draft request. |
| `fn_submit_payment_request` | `draft -> submitted`. |
| `fn_approve_request_operational` | `submitted -> approved_operational`. |
| `fn_approve_request_final` | `approved_operational -> approved_final`; owner-only. |
| `fn_payment_request_totals` | Derived unpaid/top-up/net totals. |

Not built in this slice: `fn_close_month`, `fn_import_from_sheet`, receipt attach RPCs, owner disbursement posting,
and `paid/closed` lifecycle transitions.

## 6. Roles and Permissions

Implemented permission posture:

| Capability | Owner | Accountant | Farm manager / other roles |
|---|---|---|---|
| Read custody accounts, movements, requests, totals | yes | yes | no |
| Create custody accounts / movements | yes | yes | no |
| Route expenses into custody/request states | yes | yes | no |
| Create/submit payment request | yes | yes | no |
| Operational approval | yes | yes | no |
| Final approval | yes | no | no |

Permission names: `finance.read`, `custody.write`, `request.prepare`, `request.approve.op`,
`request.approve.final`.

Farm-manager finance access was intentionally not shipped. It requires a separate owner-ratified scope decision and
tests before any broadening.

## 7. Frontend

Implemented in #474:

- `/custody`: finance dashboard with custody forms, current balances, target/top-up summary, recent movements, and
  recent payment requests.
- `/custody/request/[requestId]`: printable Arabic request 360 page with status, period, line summary, category
  summary, totals, lifecycle buttons, and signature blocks.
- `CustodyForms.tsx`: create custody account, record movement, create request, and add eligible expense lines to a
  draft request.
- `RequestLifecycle.tsx` + `lib/request-lifecycle.ts`: UI gating for submit, operational approve, and final approve.
- Nav/help entries: owner/accountant see `العهدة وطلبات الصرف`; farm manager does not.

All route reads throw on Supabase/RPC errors instead of fabricating financial zeroes.

## 8. Validation

Backend:

- Local pgTAP on the clean backend lane: **800/800**.
- PR #468 checks: app CI, pgTAP/db, aggregate typecheck/build/storybook, gitleaks, Vercel.
- Prod preflight found only `20260629150000` and `20260629150100` pending, and no remote object/column collision.
- Migrations applied to Farm prod project `veezkmytervjnpxcrbkw` with `supabase db push --yes`; ledger recorded both.

Frontend:

- Local Node 20 Vitest after #474 review: **234/234**.
- PR #474 checks: app typecheck/lint/test/build, pgTAP/db, aggregate typecheck/build/storybook, gitleaks, Vercel.
- Post-merge `main` checks after `2eb6025`: `ci`, `db-tests`, and `release` all passed.

## 9. Current Gaps / Later Slices

- Receipt/proof capture with finance-confidential attachment RLS.
- Month close / period locking.
- Owner payment/disbursement posting after final approval.
- Real Google Sheet/Excel import path and dry-run tooling.
- Farm-manager finance participation, if the owner explicitly ratifies it.
- Rich custody charts and missing-proof/duplicate-proof flags.
- Full accounting/P&L integration remains with draft #368 and Stage-M privacy/reconciliation gates.

## 10. Non-Negotiables

- Never fabricate finance totals; throw/report errors instead.
- Arabic RTL and field-safe Arabic messages.
- No double-counting between custody-paid and owner-requested expenses.
- Owner drawings stay separate from operating expenses.
- Finance-confidential data is owner/accountant-only in this slice.
- Writes go through gated RPCs and are audited server-side.
