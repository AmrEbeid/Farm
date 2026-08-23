# SPEC-0018 — العهدة وطلبات الصرف (Custody & Payment Requests)

*Status: **Built on `main`; settlement/accounting extension live via PR #568 (`8ffc4ae`) on 2026-07-01**. Backend schema/RPCs were reviewed, applied to Farm prod, and merged via #468
(`27065f1`). Frontend routes/actions were refreshed against that live backend and merged via #474 (`2eb6025`).
Branch `feat/accounting-custody-standalone` adds the owner-requested cash-method settlement/accounting slice; its
production migration `20260701220000 accounting_cash_custody_settlement` is **applied and probed migrate-first**,
with PR checks + CodeRabbit green. Post-merge `main` checks are green and live protected-route probes pass.
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
- post-paid expenses requested from the owner.

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
- A `post_paid_unpaid` expense is eligible for a payment request and does not hit accounting until paid.
- A `paid_from_custody` expense may also be included in a draft request for reporting/replenishment, but it must
  already have a custody cash-out movement.
- **Custody top-up = MAX(0, target_float − current_custody)**.
- **Net request before funding = post_paid_unpaid linked request lines + custody top-up**.
- Owner approval snapshots the approved request amount. Owner transfer is then recorded as `payment_request_funding`
  and a custody `amount_in` movement before any payout is confirmed.
- A standing custody receipt from the owner (`استلام عهدة من المالك`, such as the farm-manager float) posts to the
  cash ledger as owner funding; internal custody handovers remain custody-account balance movements, not new funding.
- Confirming a request payout records a custody `amount_out`, marks the request line paid, and posts the accounting
  journal from the selected custody source.
- `operating`, `capex`, and `drawing` expenses may be represented in the request, but request totals keep them
  separated so owner drawings do not contaminate operating P&L.
- Routed expense amount/kind is immutable; corrections must be explicit reversals/new lines.

## 4. Tables

Implemented in `apps/farm-os/supabase/migrations/20260629150000_custody_and_expense_payment.sql` and
`20260629150100_payment_requests.sql`.

| Table | Purpose | Notes |
|---|---|---|
| `custody_accounts` | Custody float account per holder | `holder_label`, optional `holder_user_id`, `target_float`, `active`; finance-read RLS; writes via `fn_save_custody_account`. |
| `custody_movements` | Append-only custody cash ledger | exactly one of `amount_in`/`amount_out` must be positive; optional `expense_id`; settlement adds optional `payment_request_id` + `journal_entry_id`; holder-transfer adds optional `transfer_group_id`; direct DML revoked. |
| `payment_requests` | Monthly request header/lifecycle | per-org `request_no`, period, status, optional linked custody account, approver stamps; draft extension snapshots approved totals. |
| `payment_request_lines` | Expenses included in a request | one request per expense; draft extension stores settlement fields (`paid_at`, `paid_by`, custody source, movement, journal). |
| `expenses` extension | Payment routing | `payment_status`, `paid_by`, and `kind` are present in this apply path; routing fields are RPC-controlled. |
| `payment_request_fundings` | Owner transfers into custody for a request | draft extension; links request, custody account, custody movement, journal entry, amount, and date. |
| `accounts` / `journal_entries` / `journal_lines` | Cash-method accounting kernel | draft extension; owner/accountant read, no direct DML, journals created only by RPCs. |

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
| `fn_transfer_custody` | Transfer custody cash between two holders as one linked out/in pair; no journal/P&L effect. |
| `fn_set_expense_payment_status` | Set payment routing; `paid_from_custody` posts the linked cash movement once. |
| `fn_custody_balance` | Derived account balance, finance-read gated. |
| `fn_create_payment_request` | Create a draft request with the next per-org request number. |
| `fn_add_expense_to_request` | Add an eligible post-paid or already custody-paid expense to a draft request. |
| `fn_submit_payment_request` | `draft -> submitted`. |
| `fn_approve_request_operational` | `submitted -> approved_operational`. |
| `fn_approve_request_final` | `approved_operational -> approved_final`; owner-only. |
| `fn_payment_request_totals` | Derived unpaid/top-up/net totals. |
| `fn_accounting_trial_balance` | Draft extension: owner/accountant cash trial balance. |
| `fn_record_payment_request_funding` | Draft extension: record owner funding as custody first and post journal Dr custody / Cr owner funding. |
| `fn_confirm_request_expense_paid` | Draft extension: confirm a request line paid from a selected custody source and post the expense/drawing/capex journal. |
| `fn_close_payment_request` | Draft extension: close a funded request after all lines are paid. |

Not built in this slice: `fn_close_month`, `fn_import_from_sheet`, receipt attach RPCs, bank reconciliation,
month close, tax, or real-data import.

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
- Draft branch extension: request settlement tab records owner funding, confirms payout from selected custody
  source, lists funding rows, and closes the request when all lines are paid.
- `CustodyForms.tsx`: create custody account, record movement, transfer custody between holders, create request,
  add eligible expense lines to a draft request, and perform funding/payment/close actions.
- `RequestLifecycle.tsx` + `lib/request-lifecycle.ts`: UI gating for submit, operational approve, and final approve.
- Nav/help entries: owner/accountant see `العهدة وطلبات الصرف`; farm manager does not. Draft branch also adds
  `/accounting` to the Finance module for owner/accountant only.

All route reads throw on Supabase/RPC errors instead of fabricating financial zeroes.

### Exact daily workspace (2026-08-08, local release candidate)

`/custody` now calls `fn_custody_daily_snapshot` once instead of composing seven independent reads. The
finance-gated statement returns exact full account balances, targets, top-up needs, unpaid obligations and
request/movement counts, with at most 200 newest requests and 15 newest movements for display. Signed closing
balances remain visible, monetary values cross JSON as decimal text, same-day movements use creation time before
the UUID tie-breaker, and a truncated request list cannot export a misleading partial CSV. Missing or cross-org
request/movement account links raise before any payload is returned. Migration `20260822141600`, database test
218 and strict parser tests are release-gated; no write/posting path changed.

### Daily workspace reset R4f (2026-08-23, released)

R4f keeps the exact `fn_custody_daily_snapshot` call, Owner/Accountant boundary, decimal-text money and all
posting RPCs unchanged. The workspace now leads with the known owner request, current custody cash, draft plus
awaiting work, and unknown-amount warning; then shows active/inactive holder balances, request work and recent
movements as compact RTL/mobile rows. Inactive cash remains in total custody truth, but inactive targets do not
inflate top-up and inactive accounts are excluded from write selectors. Request search is URL-driven over the
bounded sample, and truncated results cannot imply a full search or export.

Direct owner funding now requires its actual transaction date and forwards it to the existing
`fn_record_custody_movement(p_occurred_at)` input from both entry surfaces. Movement 360 exposes its already-read
expense/request links, journal/transfer state and reversal reason. This is an app/UI release: no schema, migration,
permission, snapshot, journal or posting definition changes.

Released through PR #1055 at `926e04932377aebe3d63cb1f58a0915365907874`; exact-merge CI
`32630919330`, db-tests `32630919336`, release `32630919360` and Production deployment `6046477323`
passed. Local evidence: focused 62/62, Vitest 2,327 plus 17 skips, pgTAP 4,986/4,986, TypeScript, full ESLint,
70-page build, guards, desktop/phone QA and independent final APPROVE. Migration N/A. Authenticated
Owner/Accountant and real-record acceptance remain open.

### Payment Request 360 reset R4g (2026-08-23, released)

R4g keeps the existing one-call `fn_payment_request_detail_snapshot` boundary, Owner/Accountant route gate,
exact decimal totals, lifecycle controls, settlement actions, available-expense bound and complete print package.
The page leads with the request's one next action, reduces the screen summary to decision facts, and removes the
duplicated on-screen signature package. The print-only package still contains request facts, approvals/signature
blanks, category totals, every request line and every recorded funding regardless of the open tab.

Request expenses render as compact RTL rows with truthful links to the expense, custody movement and journal
reference already present in the snapshot; the complete print package carries payer, movement and journal
identifiers. Funding history is also a compact row list. Settlement follows the real sequence: owner funding
into custody, confirmation of each expense payment from custody, then close. Funding and payment dates are now
required in the UI and fail closed in the server action rather than falling through to an RPC date default.
Migration `20260823170000 payment request completion guards.sql` adds transaction-safe, actor-independent trigger
guards that lock the request row and prevent confirming a request line or closing a request while an approved
funding balance remains. The same migration preserves the one-call detail boundary while adding funding movement
and journal evidence to every snapshot funding row. Existing posting RPC bodies, permission contracts, money
definitions and production business rows remain unchanged.

Local validation: focused 13/13, Vitest 2,329 plus 17 skips, pgTAP 5,010/5,010 including the 22-check settlement
guard test and 46-check detail-snapshot test, replay-safe migration application, TypeScript, full ESLint, 70-page build, repository guards,
Impeccable detector and bounded desktop/phone visual QA. Three independent change-request rounds were closed;
the exact final diff received independent `APPROVE`. Hosted migration
`20260823101732 payment_request_completion_guards` preserved every preflight business count and financial sum.
PR #1057 merged at `9d3c3a495641fe439719ed70dc173143eb988b2c`; exact-main CI `32633375622`, db-tests
`32633375636`, release `32633375593` and Production deployment `6046885964` passed. Public signed-out routes
were verified. Authenticated Owner/Accountant and real-record acceptance remain open.

## 8. Validation

Backend:

- Draft branch local pgTAP after the settlement/accounting extension: **894/894**.
- Local pgTAP on the clean backend lane: **800/800**.
- PR #468 checks: app CI, pgTAP/db, aggregate typecheck/build/storybook, gitleaks, Vercel.
- Prod preflight found only `20260629150000` and `20260629150100` pending, and no remote object/column collision.
- Migrations applied to Farm prod project `veezkmytervjnpxcrbkw` with `supabase db push --yes`; ledger recorded both.

Frontend:

- Draft branch validation after the settlement/accounting extension: app Vitest **251/251**, ESLint clean, Next
  production build green, `git diff --check` clean.
- Local Node 20 Vitest after #474 review: **234/234**.
- PR #474 checks: app typecheck/lint/test/build, pgTAP/db, aggregate typecheck/build/storybook, gitleaks, Vercel.
- Post-merge `main` checks after `2eb6025`: `ci`, `db-tests`, and `release` all passed.

## 9. Current Gaps / Later Slices

*See also [`SPEC-0018-EXT-custody-transfer-and-revenue.md`](SPEC-0018-EXT-custody-transfer-and-revenue.md) —
a 2026-07-01 planning-only extension detailing the holder-to-holder custody transfer gap, the payment-request
PDF/report set, and the revenue/sales-with-pending-price design that reconciles with (and extends) this spec and
SPEC-0004.*

- Receipt/proof capture with finance-confidential attachment RLS.
- Month close / period locking.
- Bank reconciliation / proof matching.
- Real Google Sheet/Excel import path and dry-run tooling.
- Farm-manager finance participation, if the owner explicitly ratifies it.
- Dedicated custody/payment reports are implemented by `20260701490000_custody_reports`; remaining polish is
  PDF export, richer charts, and missing-proof/duplicate-proof flags.
- Full accounting/P&L integration remains with draft #368 and Stage-M privacy/reconciliation gates.

## 10. Non-Negotiables

- Never fabricate finance totals; throw/report errors instead.
- Arabic RTL and field-safe Arabic messages.
- No double-counting between custody-paid and owner-requested expenses.
- Owner drawings stay separate from operating expenses.
- Finance-confidential data is owner/accountant-only in this slice.
- Writes go through gated RPCs and are audited server-side.
