# Connected Work Graph and 360 Control Pages

Date: 2026-07-01

## Problem

The farm structure is live, but the 360 pages are still mostly identity files. Sector, hawsha, line, and palm pages show structure, media, and some activity, but they do not present the full operating picture: plans, planned operations, assignees, due tasks, execution history, expenses, payment requests, custody source, accounting impact, and printable reports.

This creates the exact problem the owner raised: a palm, hawsha, or sub-farm file cannot be used as the control room for that entity, and the field and accountant dashboards do not show the work each role needs to act on.

## Market pattern

Current accounting and farm systems converge on the same design:

- Odoo analytic accounting tracks costs and revenues by analytic dimensions such as projects or services.
  Source: https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/analytic_accounting.html
- QuickBooks Projects groups transactions, estimates, and expenses in one project dashboard with project reports.
  Source: https://quickbooks.intuit.com/learn-support/en-us/help-article/manage-projects/set-create-projects-quickbooks-online/L9GAdLMyT_US_en_US
- Xero tracking categories support reporting by departments, cost centres, or locations.
  Source: https://central.xero.com/s/article/Set-up-tracking-categories
- Farmbrite presents farm accounting around income, expenses, transactions, and financial reports.
  Source: https://help.farmbrite.com/help/accounting
- Traction Ag links accounting and field operations with per-field costs, field records, bills, invoices, prepays, inventory, and field activities.
  Source: https://www.tractionag.com/pricing-and-plans
- AGRIVI positions farm finance as budget versus actual reporting tied to operational data.
  Source: https://www.agrivi.com/products/360-farm-enterprise/
- Xero and Figured show the integration pattern for farm budgeting, forecasting, and financial management.
  Source: https://www.xero.com/us/small-businesses/farming/

The product lesson for Farm OS is: do not make accounting, field work, and structure separate islands. Every operational record must carry an entity dimension and every entity page must report its work, money, and status.

## Existing assets

Already available in the repo:

- Structure: farms, sectors, hawshat, lines, palms.
- Activity spine: farm_event, event_locations, event_assets, event_followups.
- Planning spine: plans, plan_operations, plan_material_requirements, plan_labor_requirements, plan_checks.
- Assignment spine: plan_operation_assignees plus legacy plan_operations.responsible_person_id.
- Finance spine: expenses with farm, sector, hawsha, event, plan links.
- Custody and payment requests: custody_accounts, custody_movements, payment_requests, payment_request_lines.
- Cash accounting: accounts, journal_entries, journal_lines, trial balance RPC.

Main gap: the UI and reports do not compose these records into one work graph, and some paths still use the legacy single responsible person instead of the assignee join table.

## Target model

Create a shared work-context layer keyed by entity:

- Entity keys: farm, sector, hawsha, line, palm.
- Ancestor chain: palm -> line -> hawsha -> sector -> farm.
- Descendant expansion: sector includes its hawshat, lines, and palms; hawsha includes lines and palms; line includes palms.
- Plan matching:
  - direct plans where plans.scope_type/scope_id matches the entity;
  - descendant plans for rollups;
  - operations where plan_operations.target_type/target_id matches the entity or descendants.
- Activity matching:
  - direct and rolled-up farm_event through event_locations and event_assets.
- Task matching:
  - plan_operation_assignees as the canonical task assignment;
  - legacy responsible_person_id only as fallback and migration compatibility.
- Finance matching:
  - expenses linked by sector_id, hawsha_id, plan_id, event_id;
  - custody movements linked through expense_id;
  - payment request lines linked through expense_id;
  - journal lines linked through expense_id or payment_request_id.

## Product requirements

1. Entity 360 pages

Every sector, hawsha, line, and palm page must show:

- identity and structure;
- plans and active plan operations;
- task assignees and leads;
- activity and executed operations;
- expenses and custody/payment/accounting links where visible to owner/accountant;
- a printable report view or print action.

2. Rollups

An operation or event on a palm must roll up to line, hawsha, sector, farm, and the field dashboard. A hawsha operation must roll up to its sector and farm. A sector operation stays sector/farm scoped.

3. Assignment

Active planned work must have one or more assignees. The app must stop showing dashboards based only on responsible_person_id and should use plan_operation_assignees first.

4. Person dashboards

Each person dashboard must show their own assigned plan operations, due or overdue work, assigned events/follow-ups, and completed activity.

5. Accountant dashboard

The accountant finance dashboard must show:

- custody balances by holder;
- accountant custody if a holder is linked to the current user;
- due and near-due payment requests;
- unpaid post-paid expenses;
- owner-funded or pending funding flows;
- accounting summary and links to trial balance, custody, payment requests, and expense records.

6. Reports

Each linked entity page must support printable reporting with:

- structure summary;
- open plans and tasks;
- completed activity;
- expense/custody/accounting summary when the role can see finance;
- unresolved risks and missing links.

## Implementation slices

Slice 1: No schema change

- Add a shared work-context query helper.
- Upgrade sector, hawsha, line, and palm 360 pages with Plans, Tasks, Finance, and Report tabs.
- Rewire people dashboard and person 360 to plan_operation_assignees.
- Extend finance dashboard with custody, payment request, unpaid expense, and accounting attention blocks.
- Add print controls for entity reports.

Slice 2: Planned operation rollup migration

- Re-emit fn_execute_operation so it resolves target_type and target_id into the full ancestor chain, matching fn_record_event.
- Link executed palm operations through event_assets.
- Add pgTAP coverage for sector, hawsha, line, and palm target execution rollups.

Slice 3: Assignment hardening

- Enforce one or more assignees at action/RPC boundary for new active operations.
- Keep legacy responsible_person_id as lead/back-compat, but make dashboards use the join table.
- Add data-quality report for old operations without assignees.

Slice 4: Palm and line scoped planning

- Extend plan creation and operation authoring to allow line and palm scope where operationally needed.
- Keep farm/sector/hawsha as the default planning levels to avoid over-fragmenting routine work.

## Non-goals

- Do not invent farm counts, expenses, or custody balances.
- Do not present agronomy rates as prescriptions.
- Do not apply production migrations without the migration gate.
- Do not replace the cash-method accounting kernel already shipped.

## Open review points

- The Arabic label "sub farm" maps to the current sector/sub-farm level unless the owner defines a separate level later.
- "Almidan" maps to the `/m` field dashboard plus farm map/croquis visibility.
- The first production-safe slice should be UI and query composition only; the function migration should follow with tests and review.
