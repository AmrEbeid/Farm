# Accounting standalone market research

Date: 2026-07-01
Scope: accounting systems available in the market and the Farm OS custody/payment-request accounting direction.

## Sources checked

- QuickBooks Online accounting feature page: https://quickbooks.intuit.com/accounting/
- Xero online accounting software page: https://www.xero.com/us/accounting-software/
- Zoho Books product page: https://www.zoho.com/books/
- Odoo Accounting app page: https://www.odoo.com/app/accounting

## Market pattern

The mature accounting products converge on the same core capabilities:

- Source documents and transactions: invoices, bills, expenses, receipts, purchase orders, and payment records.
- A ledger/reporting core: profit and loss, balance sheet or trial-balance style reporting, cash flow, and detailed drill-down.
- Bank/cash control: bank feeds, bank reconciliation, matched/categorized transactions, and payment status.
- Approval and permissions: multiple users, accountant access, role permissions, and auditability.
- Automation: recurring transactions, categorization, reminders, workflows, and anomaly/reconciliation support.
- Integrations: payroll, payments, inventory, projects, documents, Excel/export, and app marketplaces.

The important product lesson for Farm OS is not to copy a generic accounting SaaS screen-by-screen. Farm OS has a
different control problem: the owner funds custody, the farm manager/accountant pay small expenses in cash, and the
accountant must issue a clean printable payment request with all cash/debt details. So the first standalone
accounting layer should be cash-method, source-linked, Arabic-first, and integrated with custody, expenses,
purchase requests, inventory, and budgets.

## What Farm OS should copy now

1. Source-linked ledger

Every accounting entry should point back to the operational source: expense, custody movement, payment request,
purchase request, or sale. This copies the drill-down behavior of mature systems without requiring a full
statutory close module.

2. Cash-first settlement

For the farm workflow, the accounting event is not "expense entered"; it is "cash moved". Unpaid expenses stay in
the payment request. Once the owner transfers funds, the money enters custody. Once the accountant confirms payout
from the chosen custody source, the journal posts.

3. Clear role gates

Owner and accountant see accounting/custody. Farm manager can be added later only if the owner ratifies a precise
read/write scope. This matches market systems where accounting access is permissioned and accountant collaboration
is explicit.

4. Reports before statutory complexity

The useful first reports are cash trial balance, recent journals, custody balances, funding received, request cash
out, unpaid operating, capex, and drawings. Full tax, depreciation, bank feeds, formal financial statements, and
real-data reconciliation remain later gates.

5. Export and audit readiness

Even before bank reconciliation exists, the system should maintain immutable journal rows, no direct DML, RLS,
audit logs, and printable request output. This makes future Excel/accountant handoff possible.

## Implemented in the draft branch

Branch `feat/accounting-custody-standalone` implements the recommended first slice:

- Minimal chart/ledger: `accounts`, `journal_entries`, `journal_lines`.
- Standing owner custody receipts post to the cash ledger, so the 30K farm-manager float is visible in accounting.
- Owner funding: `payment_request_fundings` links owner transfer to request, custody movement, and journal.
- Request settlement: `payment_request_lines` stores paid timestamp, payer label, custody source, movement, journal.
- RPCs: trial balance, record owner funding, confirm request expense paid, and close payment request.
- UI: `/accounting`, expanded `/custody`, and a settlement tab on `/custody/request/[requestId]`.
- Controls: owner/accountant only, direct DML revoked, RLS + pgTAP coverage.

## Deliberately not implemented yet

- Bank feeds and bank reconciliation.
- Sales ledger and receivables.
- Supplier AP aging.
- Tax/VAT/e-invoicing.
- Depreciation, bearer-plant accounting, IAS/IFRS adjustments.
- Balance sheet close.
- Payroll.
- Real Ebeid Excel import or dual-run reconciliation.

These are not rejected; they are staged after review because they either require real financial data, accountant
ratification, statutory rules, or external integrations.
