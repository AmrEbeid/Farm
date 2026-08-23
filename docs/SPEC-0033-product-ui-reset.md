# SPEC-0033 — Product-wide UI reset

*Status: execution plan. Created 2026-08-22 from the Owner's request to rebuild Farm OS navigation,
dashboards and 360 pages after the Marketing release. Builds on SPEC-0025 and SPEC-0030; it does not replace
their task-first product decisions.*

## 1. Outcome

Farm OS must feel like one calm Arabic operating tool, not a collection of modules. A user should always know:

1. what needs attention now;
2. what changed and why it matters;
3. the one next action they can take;
4. where the supporting record lives.

The reset preserves route URLs, role gates, RLS/RPC contracts, financial definitions, Marketing provenance,
real-data-only behavior and the existing Readex Pro/Tajawal identity. This is an Operate interface: speed,
scanability and correct action outrank decoration.

### Expenses workspace and expense 360 R4d — RELEASED

*Released by PR #1051 at `3d366ee49b10da95a77dc1fb9a1c218c5f79bab0`. Exact-merge CI
`32627663641`, db-tests `32627663631`, release `32627663624` and Production deployment `6045931084`
succeeded. Signed-out workspace and expense-detail routes redirect to `/login`; authenticated role and
real-record browser acceptance remain open because no production session was used. Migration N/A.*

`/expenses` keeps its released `fn_expense_daily_snapshot` contract: one active-organisation call, exact
register/filter counts and full-register monthly totals beside at most 200 latest matching rows. No table,
RPC, role, write or money definition changes in this slice. The seven-column register becomes compact stacked
rows at phone width. Every row names one next action in this order: missing date, missing account, missing cost
centre, missing payment route, then review. Exact decimal text remains decimal text through rendering.

The monthly state keeps non-drawing spend (operating plus CAPEX) separate from owner drawings. Farm Manager
continues to receive no drawing count, amount, filter or row. Search is server-rendered and URL-driven over the
already bounded rows; when the filter has more than 200 matches, the page explicitly says search is limited to
the displayed latest records and offers no misleading partial CSV export. Counts and monthly totals remain the
exact full-register values from PostgreSQL.

Opening `/expenses/[expenseId]` carries a validated `?from=` register state. The return path is restricted to
`/expenses`, rebuilt from the known `q` and `filter` fields, and preserved through tabs and the missing-date
server action; no caller-provided destination is echoed. The detail page retains its exact snapshot, role gate,
payment reversal/correction controls and server-rendered URL tabs unchanged.

Release evidence: focused tests 74/74; full Vitest 2,301 passed plus 17 controlled skips; TypeScript; full
ESLint; 70-page production build; client-boundary, service-role and Recharts guards; dependency audit with zero
vulnerabilities; 390px and 1,440px RTL visual checks with no horizontal overflow; independent review; empty
`packages/ui` diff. This was UI-only and required no migration.

### People directory and person 360 R4c — RELEASED

*Released by PR #1047 at `8d782ab7ef00215dbf7aa4b0d5e64dcc16d4fc9e`. Source migration
`20260823160000_exact_people_directory_and_person_snapshots.sql` is live on Farm as hosted migration
`20260823070135 exact_people_directory_and_person_snapshots`. Docker-free pgTAP **4,986/4,986** including
test `231` **154/154**, Vitest **2,283** passed, production build **70/70**, post-merge CI/db/release workflows
and exact-SHA Vercel production deployment are green. Live owner/accountant RPC smoke passed; authenticated
browser acceptance remains open because no production session was used.*

`/people` and `/people/[personId]` now read one active-organisation snapshot each instead of unbounded direct
table reads. The directory publishes exact organisation, search and filter totals separately from one
deterministic 20-row page. The person file publishes exact work, activity and direct-report totals separately
from four independently bounded samples. Open work is the nonterminal operation set over the de-duplicated
union of assignee and legacy responsible-person links, never a capped array length or the literal `planned`
status.

Both functions re-check the existing owner, farm-manager, agronomist and accountant route roles in PostgreSQL,
are `SECURITY INVOKER`, expose no contact PII, auth identity, payroll, wage or money key, and return SQL NULL for
both a missing person and a foreign-organisation person. Active-organisation relationship corruption fails
closed. Search is bounded before trimming and escapes LIKE metacharacters. The optional onboarding manager list
is published only in full up to 500 active people; above that it becomes NULL and disables only the form, never
the readable directory and never as a misleading partial roster.

The pages are server-rendered, Arabic RTL and phone-first. Tables and client-only grouping are replaced by
stacked rows, exact filter chips, GET search, canonical pagination and URL-driven 360 tabs. The visual pass at
390px and 1440px found no horizontal overflow; command targets are at least 44px. A hostile review found and the
candidate fixed the manager-list outage, uppercase UUID canonicalization and the real composite farm-event key.

### Payroll workspace and run 360 R4b — RELEASED

*Released by PR #1045 at `181e761ec35cd089ac669226e26a93ba9f61a847`. Source migration
`20260823150000_exact_payroll_workspace_and_run_snapshots.sql` is live on Farm as hosted migration
`20260823044312 exact_payroll_workspace_and_run_snapshots`. Signed-out production routing is verified;
authenticated Owner/Accountant workflow and real-data acceptance remain open because all four payroll source
tables are empty. Payroll is not 100%.*

**The read path this replaces.** `/people/payroll` and `/people/payroll/[runId]` both read
`payroll_runs`/`payroll_run_lines` directly via PostgREST (`lib/payroll-report.ts`'s
`loadPayrollRunHistory`/`loadPayrollRunDetail`), re-implementing their own bounded read, their own
auth re-check and their own line count with no reconciliation against the run's own frozen total.
Both routes now read exactly one PostgreSQL function each — `fn_payroll_workspace_snapshot` for the
run history, `fn_payroll_run_snapshot` for one run's frozen detail — and `lib/payroll-report.ts`'s
direct-table loaders are retired in the same change; the module keeps only its pure wage-mode/unit
label vocabulary and the `isUuid` re-export.

**A closed run with zero stored lines is corruption, never a valid zero run.**
`fn_close_payroll_run` itself refuses an empty crew before its first write (SPEC-0006 slice 3), and
the report this replaces already refused to render a run whose lines read back empty. A recorded
`payroll_runs` row with no `payroll_run_lines` behind it can therefore only mean the write path was
bypassed, so both snapshot functions fail the read closed (23514) when any selected run has zero
lines — in addition to the existing cross-org line-reference check and the `total_gross`/line-sum
reconciliation check both functions already carried from pass 1.

**Honesty.** The workspace publishes an exact run count and an exact all-runs gross total SEPARATELY
from one deterministically ordered limit/offset page (newest payroll period first, id as the
final tiebreak); the run 360 publishes an exact line count separately from a bounded page of its own
frozen lines. Every figure and displayed worker name is read from the immutable payroll line; the new
insert trigger freezes `people.name` into `person_name_snapshot` when each line is created. Values are
NEVER recomputed from a current wage rate — a rate edited after a close can never change what a past
run reports. Counts and decimals leave PostgreSQL as text, because a JS number cannot represent every
bigint and a binary double cannot represent every `numeric`.

**Ordering is a database contract, not a client re-check.** Frozen lines are ordered by person name in
SQL and proven in pgTAP; the TypeScript parser does not re-compare `person_name` with JavaScript `<`,
because PostgreSQL collation and JS UTF-16 code-unit ordering can disagree for Arabic names — a
client-side re-check would reject a correctly ordered page. `closed_at` is validated as a real
parseable timestamp (not merely nonempty text), and the "is this page the whole run?" reconciliation
compare stays in BigInt space end to end, never widening an exact count through `Number(BigInt(...))`.

**Not found means not found.** `fn_payroll_run_snapshot` returns SQL NULL for a run outside the active
organisation — the same answer as a run id that exists nowhere — so the 404 can never be read as "this
run exists, but not for you".

**No contact PII, no closer identity.** Only the stored close-time worker-name snapshot is published;
the read payload never joins today's `people.name`, and `payroll_runs.closed_by` is never published.

**The pages.** `/people/payroll` keeps its close form and the reporting-only boundary text
("لا يصرف أي مبلغ ولا يُنشئ أي قيد محاسبي") verbatim, adds a compact story line (never closed / has
history / the legal next action), and replaces its `<table>` history with stacked, mobile-first record
rows carrying canonical `?page=` pagination and a stale-beyond-last-page redirect
(`lib/payroll-workspace-context.ts`, mirroring `lib/inventory-list-context.ts`).
`/people/payroll/[runId]` becomes a real Entity 360 using the shared `Entity360Header`/`EntityTabs`
(overview + frozen wage lines, URL-driven `?tab=`), with its own bounded, canonically paginated line
list (`?lines=`) and a `?from=` return path that is parsed, restricted to the payroll workspace path
and REBUILT from validated parts before it is ever rendered as a link — the caller's bytes never reach
an href. `/people/payroll/readiness` keeps its existing zero-database-read design and permissions and
replaces its checklist `<table>` with the same stacked record-row convention; it fabricates no
completion percentage and infers no pay, as before.

**Deliberately not in this slice, and why:**

- **`fn_close_payroll_run` and its historical migration are untouched.** A new insert trigger freezes
  the current worker name on the line without changing the close algorithm.
- **No new dependency and no CSV export.** The two paginated payroll views intentionally have no print
  action: printing one bounded page beside a full-run total would look like a complete report. The
  readiness checklist remains printable because it is not paginated.

### Inventory list and item 360 R4a — RELEASED

*Released by PR #1043 at `091a3655d80bb3e29cfef4a8313b415b98418242`; Farm hosted migration
`20260823031608 exact_inventory_list_and_item_snapshots` is live. Signed-out production routing is verified.
Authenticated Storekeeper acceptance remains open because production has zero Storekeeper memberships.*

**The bug this exists to fix.** `/inventory` and `/inventory/[itemId]` both selected `inventory_items`
unbounded, embedded `inventory_bin` through PostgREST and then read `inventory_bin[0]` in JavaScript. An item
stored in two physical locations therefore published the FIRST bin's balance as if it were the whole stock —
on the list an owner uses to decide a purchase, and on the file a storekeeper would use to decide an issue.
An item with no bin row at all published «٠» when the truth was "no balance has ever been recorded". Both
pages are now one exact, bounded, active-organisation snapshot each, and every balance is the sum of EVERY
bin. `/inventory/[itemId]` additionally lists every physical location in full, so the aggregate can be
checked against the rows behind it rather than trusted.

**The role contract is decided in PostgreSQL, not in React.** Hiding a field in a component is not a
control: the bytes still reach the browser, the network tab, the RSC payload and any cache. The scope is
therefore resolved from the caller's real `organization_member` row and the money and identity keys are NOT
BUILT AT ALL for the store:

- `operational` (storekeeper) — no `unit_cost`, no `est_cost`, no valuation, no uncosted count, no supplier,
  no purchase `reason`, no `requested_by`/`approved_by`, and no purchase-request id, so a link to the
  money-bearing purchase-request page cannot even be constructed. The «بلا تكلفة» filter is refused with
  42501 for this scope, because offering it would be useless AND would confirm to that role that cost data
  exists.
- `finance` (every other member role) — preserves EXACTLY the money and preferred-supplier capability those
  roles have today, because the enforced policy for `/inventory*` is still `requireMembership()`. Narrowing
  it further (taking cost away from a supervisor, say) would be a policy change and is deliberately not
  smuggled into a UI slice.

The TypeScript parsers enforce BOTH directions rather than trusting either: every object rejects unexpected
keys at every nesting level, the operational payload is additionally walked key-by-key against a
forbidden-name set, and the finance payload must actually CARRY its money keys — so a regression that stops
sending cost to an owner fails the parse too. The result types are a discriminated union on `scope`, so the
operational branch has no `unitCost`/`valuation` property for a component to render even by accident.

**Honesty.** An item with no bin row is `unknown` with JSON-null balances, never zero. An item with no
POSITIVE `coalesce(reorder_point, min_stock)` is `no_threshold` — neither below reorder nor confirmed ok. A
null `unit_cost` is unknown cost, never zero: valuation excludes those items and publishes the size of both
gaps (unknown cost, unknown stock) beside the total, so the figure can never read as the value of the whole
store. `below_reorder` is a POINT-IN-TIME reading of the recorded threshold against the all-bin balance and
is never called coverage — it knows nothing about planned demand or scheduled receipts, so it can be quiet
for an item `fn_stock_coverage` would call short, and the per-item coverage page remains the only place a
coverage verdict is stated. Running the engine once per listed row would also be an N+1 of the heaviest RPC
in the system.

**Bounds.** The list is paginated server-side and publishes its exact organisation, search, filter and state
totals SEPARATELY from the bounded page, so a truncated page can never be mistaken for the whole book. Its
order is a deterministic total order — exceptions first, then Arabic name, then id — which is what makes
limit/offset paging correct rather than merely plausible. The item 360 bounds its movement and purchase
samples INDEPENDENTLY and publishes each exact total beside its sample; it returns every physical location
in full and fails loudly above 200 rather than truncating an item's own stock silently. Search text is
refused above a raw ceiling BEFORE it is trimmed, and its LIKE metacharacters are escaped, so a typed `%`
searches for a per-cent sign instead of matching everything. Counts and decimals leave PostgreSQL as text,
because a JS number cannot represent every bigint and a binary double cannot represent every `numeric`.

**Not found means not found.** An item outside the active organisation returns SQL NULL — deliberately the
same answer as an id that exists nowhere — so the 404 can never be read as "this id exists, but not for you".

**The pages.** Both are server-rendered with no client component and no JavaScript requirement: search is a
plain GET form, every filter and page control is a link, and the whole state lives in the URL, so the list
can be bookmarked, shared and back-buttoned. Opening a row carries that state in a `?from=` parameter which
is parsed, restricted to the inventory list path and REBUILT from validated parts before it is ever rendered
— the caller's bytes never reach an href, and the list URL is canonicalised with one redirect so the same
page is never reachable under two spellings. Neither page uses a table: a nine-column table cannot reflow
into 390px without a horizontal scrollbar, so each item is one block that stacks on a phone and widens on a
desk. The item 360 keeps the shared `Entity360Header` but replaces the client tab switcher with one column
of short labelled sections, because tabs hide bounded content behind a tap that needs JavaScript on exactly
the roles that are meant to be mobile-and-offline-tolerant.

**Navigation.** `/inventory` is restored to the Storekeeper's navigation, because the route no longer
publishes money to that role. `/inventory/[itemId]/coverage` is NOT restored: it still renders the engine's
money-bearing surface, and its own server-side redirect stays exactly as it was.
The existing `/inventory/movements` link remains available, but its server query is now role-shaped too:
Storekeeper requests do not select or render `suppliers.name`; other members retain the existing supplier
audit column.

**Deliberately not in this slice, and why:**

- **CSV export and print on the list.** The old page exported the whole client-side list — including the
  first-bin balances that were wrong. With server-side paging, an export of one bounded page filed under
  «inventory» would read as the whole book. An honest full-book export needs its own bounded server route
  and belongs to a separate slice. The bulk item IMPORT panel is kept unchanged for the finance scope and
  is not rendered for the store scope — a UX boundary, not a control: the `inventory-items` template
  carries no cost and no supplier name (`fromRow` blanks the ref column), the storekeeper's
  `inventory.write` permission is unchanged, and `app/api/import` plus `fn_save_inventory_item` remain the
  enforcement.
- **A coverage verdict on the list.** Deliberately absent, as above.

Residual gaps recorded, not fixed by this slice:

- **`inventory_bin.ordered` is pinned to zero.** `inventory_bin_ordered_zero_until_writer` (migration
  `20260629140248`) forces `ordered = 0` because nothing writes an on-order balance yet. The 360 publishes
  the column honestly as the zero the schema currently guarantees; it is not evidence that nothing is on
  order. Closing this needs an on-order writer, which is its own change.
- **The item-name and location fields carry no non-emptiness constraint**, so a corrupt empty value would
  fail the strict parse and blank the page rather than render a nameless row. This matches the storekeeper
  home's existing posture and is not newly introduced here.
- **The wider Purchase Requests and Suppliers workspaces remain broad-read surfaces.** R4a does not link a
  Storekeeper item row to a money-bearing purchase-request detail and does not redesign those workspaces;
  their product-wide role/read policy remains a later workspace decision.

Release evidence: full Vitest **2,155 passed + 17 controlled skips**, app TypeScript and full ESLint clean,
production build **70/70 static pages**, full Docker-free pgTAP **4,751/4,751** including R4a test `229`
**143/143**, service-role/Recharts/client-server guards green, `git diff --check` clean and `packages/ui`
unchanged. An independent hostile review returned **APPROVE** after corrections for mixed unquantified purchase
requests, caller-bound parser scope/arguments, finance-only supplier corruption and Storekeeper movement supplier
exposure. Deterministic operational fixtures at **390px** and **1,440px** showed zero horizontal overflow and no
sub-44px command controls. Hosted postflight proved both functions are `SECURITY INVOKER`, `STABLE`, empty-search-
path and authenticated-only, with list md5 `6801b4b2620ec86ca32b3a20a2d641cc` and item md5
`a6204baa3972925cff75bc87600ad3e4`; business counts were unchanged and no advisor named either function.
Exact-merge CI, db-tests, release and Vercel succeeded. Public home/login return 200; signed-out list, item,
movements and coverage return 307 to `/login`. Authenticated production role acceptance remains open because
the current Farm production data has no Storekeeper membership.

### Storekeeper home R3f released

*Released by PR #1041 at `4f3eaeca40a0fc43636c36e4165c2aafa4a14165`; hosted migration
`20260823015536 exact_storekeeper_home_snapshot` is live on Farm.*

The Storekeeper branch of `/inventory/dashboard` now uses one storekeeper-only, active-organisation
snapshot, and the legacy multi-table inventory dashboard — every item, every purchase request, every
supplier, plus two doughnut charts and a filterable work table — no longer runs for this role. Owner,
farm manager, accountant and agri_engineer keep that dashboard unchanged. The route requires
membership exactly once and branches before any Supabase client is created, so the storekeeper's page
issues one RPC and nothing else.

Four KPIs tell the store day: requests ready to receive, requests past their needed-by date, items
under their recorded reorder threshold, and today's recorded issues. All four are exact counts of
RECORDED rows, labelled المسجل; none of them claims the store has been counted or that the shelf
matches the book. Open receipts reconcile strictly twice — receivable plus blocked equals the open
total, and overdue plus due-today plus upcoming plus undated equals it too — and the parser rejects
either drift.

Receivability mirrors the CURRENT shipped receipt path rather than inventing gates. `fn_post_receipt`
as last re-emitted by `20260701210000` and `fn_post_movement` as last re-emitted by `20260701180000`
were read directly. That leaves exactly one stored blocker: a line with no quantity, which makes the
RPC raise 22023 for the WHOLE request because its body is a single transaction. A purchase-request
line unit that differs from the item's tracked unit *looks* like a second blocker and is deliberately
not treated as one: since `20260701210000` the RPC passes NULL as the movement unit precisely so
`fn_post_movement` defaults to the item's own unit, so the mismatch can never fire. The snapshot
publishes `item_unit` — the unit the receipt is actually recorded in — beside the order-line unit
instead. Over-receipt and concurrent claims depend on typed input and live state, so they are not
preflighted and the page states the server may still refuse the receipt. The pgTAP fixture proves
both directions by really calling the RPC: the mismatched-unit request receives, while requests with
mixed or only unquantified lines stay visible as blocked work and are refused atomically.

**No completed stock-take is claimed or counted, and this is the point of the slice.**
`fn_record_stock_take` writes no provenance row of its own, and when the physical count matches the
book its variance is zero and it posts nothing at all. A perfectly matching count is therefore
indistinguishable from never having counted, and an adjustment row is indistinguishable from an
ordinary hand-posted correction. Any "stock-takes done" number would be fabricated in the most
dangerous direction — it would read as "the store has been verified". So الجرد appears on this
surface only as an available legal action. That action renders one row per item and physical location
and sends the exact location to `fn_record_stock_take`; it never adds several bins together and writes
the result into `main`. Adjustment / loss / expiry rows are exposed strictly as bounded recorded
MOVEMENT evidence over a published seven-day window, never labelled a stock-take. The missing
stock-take provenance is recorded as a residual gap below, not fixed here.

Current stock is an honest point-in-time reading, not the coverage engine: the sum of EVERY bin of an
item (`on_hand - reserved`, all locations) against a POSITIVE `coalesce(reorder_point, min_stock)`.
An item with no bin row at all stays in its own explicit unknown bucket and is never folded into
zero; an item with no positive recorded threshold is in neither bucket. At R3f the inventory list, item
and coverage pages were all server-gated away from Storekeeper and were not linked from this home,
because all three published money to every member. R4a below is the role-safe list/360 replacement for
the first two; the coverage page stays gated.

The page is Arabic-RTL phone-first: attention and the two primary actions come before the numbers, at
most four KPIs, no charts, no card wall, no oversized header, no money anywhere, and every control at
least 44px. Direct actions are the role-safe routes only — `/m/receive`, `/inventory/stock-take` and
`/inventory/movements`. A receipt row never drills into the
purchase-request detail route, which renders an estimated spend figure and a per-line money column to
any member. The record launcher stays receive-only for this role and both storekeeper receive
back-links stay legal. The reports hub no longer advertises the `/plans/dashboard` card to
Storekeeper or Supervisor — the route's own `requireRole` denies both, so it was a dead card that also
advertised a money-bearing page to roles that must never see it.

An active-organisation child whose request, item or movement parent belongs elsewhere fails closed;
reverse foreign-child relationships cannot enter the active-org snapshot and remain prohibited by the
database cross-org write invariants. No person and no counterparty identity appears anywhere in the contract. Exact recorded counts
and driver rows stay visible whatever the inventory authority says, while every completeness or
all-clear claim stays gated on verified authority.

Residual gaps recorded, not fixed by this slice:
- **Stock-take provenance is missing.** There is no stored row recording that a physical count
  happened, who made it, when, or over which items — so a completed stock-take can never be counted,
  reported or audited. Closing it needs a new audited table plus a change to `fn_record_stock_take`;
  that is an inventory-integrity migration in its own right and is deliberately not bundled here.
Authenticated Storekeeper browser acceptance at 390px remains unclaimed because production has zero
Storekeeper memberships. Migration, merge, exact-SHA deployment and signed-out route verification are complete.

### Supervisor home R3e released

The Supervisor branch of `/m` now uses one supervisor-only, active-organisation snapshot, and the
legacy unbounded field feed no longer runs for this role. `/m` stays the Supervisor's primary field
home; owner, farm manager and agri_engineer keep the existing field workflow unchanged, including the
Agronomist `?scope=agronomy` drill-down and the owner/manager-only harvest-day button.

Assigned work is based ONLY on the caller's real `people.user_id` link inside the organisation —
`responsible_person_id` or `plan_operation_assignees` — on active plans only. There is no all-team
fallback: an account with no linked person row returns an explicit unlinked state, and an account
linked to more than one person row returns an explicit ambiguous state. Both return NULL counts and
NULL drivers rather than zeros, because a zero would read to a field supervisor as "you are all
clear" when the truth is that their record could not be identified.

Four KPIs tell the day: work due today, overdue work, work blocked from being recorded now, and
undated assigned work. All four are exact counts of RECORDED rows assigned to this caller, labelled
المسجل; they never claim the farm is fully covered. Multi-day work is due today across its inclusive
`planned_at..ends_on` span and becomes overdue only after its effective end; undated assigned work
stays in its own bucket instead of being dropped or counted as due. Today's work reconciles strictly:
ready plus blocked equals due today plus overdue, and the parser rejects any drift.

Actionability mirrors the stored execution path rather than inventing gates. `fn_execute_operation`
and `fn_post_movement` were read directly, and «سجّل التنفيذ» is offered only when every stored
condition holds: the status is not terminal; a dose-bearing operation has both sign-off halves
recorded; the target type is recognised and a typed target resolves to a same-organisation row; and
no material unit contradicts its item's tracked unit. Anything else is shown as a named recorded
blocker, never as an executable shortcut. Stock sufficiency is deliberately not preflighted — the
issued quantity is entered at execution time — so the page states that the server may still refuse
the record. A new database trigger rejects every transition to `done` for fertilisation or spraying
while either sign-off half is missing, including a direct `fn_execute_operation` call; the direct
execution page independently withholds its form.

The snapshot is bounded (driver lists and the materials and crew nested inside a row are each
independently limited), current-Cairo-date-only and carries no finance value of any kind: no
`est_cost`, no `unit_cost`, no rate, wage, pay, budget or expense figure. Direct actions are the
existing legal routes only — execution when legal, `/record/activity` and `/people/attendance`.
Blocked, unscheduled and upcoming rows carry no drill-down link because blocked work escalates to the
farm manager or agronomist instead. The planning list, dashboard and detail render financial values;
they are now removed from Supervisor/Storekeeper navigation and protected by server role gates so a
pasted URL cannot expose them. Cross-organisation operation-plan, assignee-operation, assignee-person,
material-operation, material-item, responsible-person, sign-off-person and plan-scope links all fail
closed; a cross-organisation operation target is instead reported as that one operation's blocker,
which is exactly what `fn_execute_operation` does with it. `PendingExecutions` offline recovery is
preserved on the Supervisor home. Exact recorded counts and driver rows stay visible whatever the
operations authority says, while every completeness or all-clear claim stays gated on verified
authority.

Hosted migrations `20260823004153 exact_supervisor_home_snapshot` and
`20260823004159 enforce_dose_signoff_on_execution`, PR #1039, merge SHA `53970c2`, exact-SHA Vercel success
and signed-out production routing are evidenced. Authenticated Supervisor browser acceptance at 390px remains
open because production has no Supervisor membership or linked person; no account or business data was created
to manufacture that evidence.

### Agronomist home R3d released

The Agronomist branch of `/dashboard/manager` now uses one agri-engineer-only, active-organisation snapshot,
and the legacy unbounded multi-table dashboard that served this role is removed. It leads with dose/spray
sign-offs waiting on this engineer, agronomy work active today, overdue agronomy work and active pheromone
traps needing follow-up. All four numbers are exact counts of RECORDED rows for the active organisation and
are labelled المسجل: they never claim the farm is fully covered. Scope is active plans only and the agronomy
operation set (fertilization, spraying, irrigation, pollination, inspection, pest scouting); multi-day work is
due today across its inclusive span and overdue only after its effective end. Trap follow-up reuses the shipped
`lib/pest-scouting.ts` thresholds exactly — check older than 10 days or lure older than 90 days, both falling
back to `installed_at`, active traps only. Blocked plan checks include weather, stock and budget and are
labelled as the last recorded check because `plan_checks` carries no timestamp. Dose content stays an editable
template pending named sign-off, and a recorded APC reference is shown as recorded-or-missing, never as proof
of a valid registration. The snapshot is bounded (drivers and the materials nested inside a sign-off row are
each independently limited), current-Cairo-date-only and contains no finance value. The existing sign-off
action stays in **راجع**. The approvals inbox now includes either missing sign-off half; Agronomist drill-downs
open an active-plan, agronomy-only team view with the same inclusive multi-day/Cairo-date rules; and trap
thresholds use Cairo calendar days in SQL and TypeScript. Hosted migration, merge, production deployment and
signed-out routing are evidenced. Authenticated role smoke remains open because production has no
agri_engineer membership.

The same release also fixes the R3c Manager usability defect: production reports `operations` and `inventory`
as partial, which rendered the whole Manager home as dashes and hid real overdue work. Exact recorded counts
and driver rows are now always shown and labelled المسجل with a partial-source warning, while every
completeness or all-clear claim stays gated on verified authority. Neither the RPC nor any count changed.

### Manager home R3c released

The Farm Manager branch of `/dashboard/manager` now uses one manager-only, active-organisation snapshot while
the Agronomist keeps the existing route until its own role slice. It leads with work active today, overdue
operations, blocking plan checks, team assignment and point-in-time stock threshold signals. Multi-day work is
active today across its inclusive start/end span; overdue starts only after its effective end date; unscheduled
work remains explicit. Missing stock-bin state remains unknown rather than zero across the Manager and inventory
dashboards, every location contributes to current availability, and an incomplete dose sign-off pair remains
advisory. KPIs fail closed unless the operations or inventory source is verified. The snapshot is bounded,
current-Cairo-date-only and contains no finance values. Hosted migration, merge, deployment and signed-out route
behavior are evidenced. Authenticated role acceptance remains open because production has no Farm Manager membership.

### Accountant home R3b released

The Accountant branch of `/finance/dashboard` now uses one accountant-only active-org snapshot. It leads with
ledger gaps, pending pricing, staged reconciliation batches the accountant can actually work, and open
receivables. Counts stay visible, while every amount and the month comparison fail closed until
`finance_ledger` is verified. Future-dated journal, custody and unpaid-expense activity is excluded from the
current as-of state; operating expenses, CAPEX, drawings and unknown amounts remain separate. Reconciliation
rows waiting on Owner approval or execution are not misrepresented as Accountant actions. The migration, merge
and deployment are released; authenticated role browser acceptance remains open.

## 2. Verified baseline

Current main at the start of this program is `59df05d`.

- 101 authenticated application pages, 22 dynamic detail/action pages and 10 dashboard routes.
- 17/22 dynamic pages use `Entity360Header`; 11 use URL-driven `EntityTabs`.
- Owner navigation exposes 14 groups / 66 pages. Accountant exposes 14 / 57. Farm manager exposes 11 / 35.
- Desktop uses an empty design-system sidebar plus a second fixed `ModuleSidebar` rendered inside
  `<main>`; app CSS hides the first and positions the second. Mobile has a separate hard-coded tab model.
- The fixed mobile tab bar has no matching content inset, so the final approximately 56px of a phone page can
  sit behind it. Breadcrumbs use unfiltered modules and appear even on depth-1 routes.
- Page headings are implemented route-by-route (`text-xl`, `text-2xl`, custom margins), so hierarchy and
  vertical rhythm drift.
- Ten dashboards repeat large KPI grids. StoryLine/drill-down patterns exist, but coverage and next-action
  behavior are inconsistent.
- No open pull request existed when the program started.

## 3. Users and home stories

Run every journey at 390px and 1440px with a real membership for the named role. Use an approved disposable
record when a step writes data; otherwise keep the step read-only. An allowed outcome must complete without a
role bounce and show only that organisation's real records. A denied outcome must be absent from navigation
and must still fail closed when its URL is entered directly; hiding a control alone is not a pass.

### Owner

Lead with decisions and exceptions, then money and operating health. Never make the Owner inspect every module.
The home answers: what needs my decision, what changed, where is risk, and what should happen next.

Acceptance script:

1. Sign in as **المالك** and open **الرئيسية**. **Allowed:** the Owner home leads with real decisions,
   exceptions, money and operating health, and every visible number drills to its source. **Denied:** an unknown
   or partial value is not rendered as zero and no invented farm count is shown.
2. Inspect the primary navigation on desktop and phone. **Allowed:** no more than five role-valid destinations
   are visible, including **الرئيسية**، **سجّل**، **راجع**، **المعاملات** and **التقارير**. **Denied:** duplicate
   dashboard, report or insight launchers do not appear in the primary spine.
3. Open **راجع**. **Allowed:** pending dose/spray sign-offs, purchase requests not created by this user and the
   legal payment-request stage appear with one next action. **Denied:** a purchase request created by this user
   and any payment stage the Owner may not perform are absent, and a direct action attempt is rejected by the
   existing server/RPC gate.
4. Open **سجّل** and select an existing Owner action such as **دفعت مصروفًا من العهدة**. **Allowed:** the flow
   opens with the existing accounting contract and a successfully saved disposable record appears in
   **المعاملات**. **Denied:** an action outside the existing Owner role contract is not added merely because its
   underlying workspace can be browsed.
5. From **المعاملات**, open the saved row and then its report/source evidence. **Allowed:** amount, status,
   ledger/source links and evidence agree. **Denied:** **مسحوبات المالك** are never included in operating
   expenses or operating profit.
6. Open **التقارير** and drill from an Owner finance answer to its real records. **Allowed:** finance, farm and
   operating reports permitted to the Owner remain reachable. **Denied:** no decorative KPI or dead-end card
   replaces the underlying records, and separation-of-duties controls cannot be bypassed from a deep link.

### Accountant

Lead with unposted/unpriced/unreconciled work, custody and receivables, then period truth. Every amount drills
to the ledger, source record and evidence. Owner drawings remain separate from operating expense.

Acceptance script:

1. Sign in as **محاسب** and open **الرئيسية**. **Allowed:** the home leads with unposted, unpriced and
   unreconciled work, custody, receivables and period truth. **Denied:** field execution or unrestricted farm
   administration is not presented as the accountant's next work.
2. Inspect desktop and phone navigation. **Allowed:** the primary spine contains no more than five destinations
   and includes **الرئيسية**، **سجّل**، **راجع**، **المعاملات** and **التقارير**. **Denied:** Owner-only
   **الإعدادات** and field-only destinations do not enter the primary spine.
3. In **سجّل**, choose **دفعت مصروفًا من العهدة**, save an approved disposable expense, and open it from
   **المعاملات**. **Allowed:** the source, posting state, custody effect and evidence remain traceable end to
   end. **Denied:** a write outside the existing owner/accountant accounting actions is not offered.
4. Open **راجع**. **Allowed:** only the payment-request stage legal for the accountant is shown. **Denied:**
   purchase-request approval and dose/spray sign-off are absent, and their direct action endpoints reject the
   accountant.
5. Open **التقارير** and answer one custody or period question, then drill to the ledger/source record.
   **Allowed:** exact amounts and honest unknowns survive the drill-down. **Denied:** **مسحوبات المالك** do not
   merge into operating expense, and unavailable values do not become zero.
6. Enter `/settings` and `/m/execute/{opId}` directly with a valid existing operation ID. **Allowed:** neither
   route exposes protected content. **Denied:** the accountant cannot gain Owner settings access or execute a
   field operation through a bookmark, while existing owner/accountant payroll access remains unchanged.

### Farm manager

Lead with today's work, blockers, stock constraints, overdue operations and team assignment. Do not foreground
absolute finance values that the role does not need to act.

Acceptance script:

1. Sign in as **مدير المزرعة** and open **الرئيسية**. **Allowed:** today's work, blockers, stock constraints,
   overdue operations and team assignment lead the page. **Denied:** absolute finance values are not
   foregrounded and no Owner decision is presented as the manager's action.
2. Inspect desktop and phone navigation. **Allowed:** no more than five role-valid destinations are visible,
   with **الميدان** as the field destination. **Denied:** **راجع** and **المعاملات** are absent because this
   role has no current legal action there.
3. Open **سجّل** and choose **أخطّط الأسبوع/الشهر** or **سجّلت نشاطًا غير مخطط**. **Allowed:** the existing
   manager-authorised flow opens and an approved disposable record can be saved. **Denied:** money-in,
   expense, pricing and collection cards are absent.
4. Open **الميدان**, select an assigned operation and record its legal next step. **Allowed:** the operation
   remains linked to its plan and scope. **Denied:** a dose-bearing operation that lacks the required named
   sign-off cannot be treated as approved or authoritative.
5. Open the inventory workspace and use **استلام المخزون** or **الجرد** with approved disposable data.
   **Allowed:** the existing owner/manager/storekeeper RPC gate accepts the valid action. **Denied:** the UI
   cannot bypass stock validation or organisation scope.
6. Open **التقارير**, then try `/transactions`, `/people/payroll` and `/settings` directly. **Allowed:** only
   manager-valid operating reports open. **Denied:** the ledger, payroll and Owner settings expose no protected
   data and fail through the existing route/server gates.

### Agronomist

Lead with checks/sign-offs, crop risks and field follow-up. Agronomy remains an editable template pending named
sign-off and current Egyptian registration, never a prescription.

Acceptance script:

1. Sign in as **مهندس زراعي** and open **الرئيسية**. **Allowed:** checks/sign-offs, crop risks and field
   follow-up lead the page. **Denied:** absolute finance values and accounting work are not presented.
2. Inspect desktop and phone navigation. **Allowed:** no more than five role-valid destinations are visible,
   including **راجع** and **الميدان**. **Denied:** **المعاملات** and finance-only primary destinations are
   absent.
3. Open **راجع**. **Allowed:** unsigned dose/spray operations appear with their plan, material context and the
   existing sign-off action. **Denied:** purchase-request and payment-request approvals that are not legal for
   this role are absent and reject direct action attempts.
4. Open a dose/spray item. **Allowed:** the agronomy content remains labelled advisory until named agronomist
   sign-off and, for chemical content, current Egyptian registration are both valid. **Denied:** the interface
   never presents an unsigned, expired or unregistered template as a prescription.
5. From **سجّل**, choose **نفّذت عملية** or **سجّلت نشاطًا غير مخطط**, then return through **الميدان**.
   **Allowed:** the existing agronomist-authorised field flow completes and retains plan/scope context.
   **Denied:** expense, collection, pricing, receipt and attendance cards are absent.
6. Open **التقارير**, then enter `/transactions`, `/people/payroll` and `/settings` directly. **Allowed:** only
   agronomy/farm/plan/weather answers permitted to the role open. **Denied:** financial, payroll and Owner
   settings data remain inaccessible through navigation and deep links.

### Supervisor

Lead with assigned work and fast recording. Phone-first, plain Arabic, large controls and no accounting terms.

Acceptance script:

1. Sign in as **مشرف ميداني** on a 390px viewport. **Allowed:** **الرئيسية** resolves to **الميدان** and leads
   with assigned work in plain Arabic using controls at least 44px. **Denied:** accounting terms, amounts and
   Owner decisions are not shown.
2. Inspect phone and desktop navigation. **Allowed:** both surfaces derive the same role-valid spine of no more
   than five destinations. **Denied:** **راجع**، **المعاملات** and **المخزون** are not offered as primary
   destinations.
3. Open an assigned operation from **الميدان** and record its legal next step. **Allowed:** the action completes
   without horizontal overflow or a route bounce and returns to the field context. **Denied:** a blocked,
   cross-organisation or unsigned dose-bearing operation cannot be forced through the UI.
4. Open **سجّل** and choose **سجّلت نشاطًا غير مخطط** or **سجّلت حضور عمالة**. **Allowed:** only the existing
   supervisor-authorised fields and actions appear. **Denied:** money, plan creation, receipt and stock-take
   cards are absent.
5. Open **التقارير**. **Allowed:** farm, plan and weather answers permitted to the supervisor remain reachable.
   **Denied:** finance, custody, payroll and people-compensation reports do not appear.
6. Enter `/transactions`, `/m/receive`, `/inventory/stock-take` and `/settings` directly. **Allowed:** no
   protected record is rendered. **Denied:** a bookmark cannot grant ledger, receipt, stock-count or Owner
   settings capability.

### Storekeeper

Lead with receive, issue, stock-take and shortage work. No mobile route may bounce to a role-forbidden page.

Acceptance script:

1. Sign in as **أمين مخزن** on a 390px viewport. **Allowed:** **الرئيسية** resolves to the inventory home and
   leads with receipts, issues, stock-take and shortages. **Denied:** the role is never redirected to `/m`,
   which is forbidden to the storekeeper.
2. Inspect phone and desktop navigation. **Allowed:** both use the same role-filtered model, expose no more than
   five primary destinations and use **المخزون** as the operational destination. **Denied:** **راجع** and
   **المعاملات** are absent.
3. Open **سجّل** and choose **استلمت بضاعة**. **Allowed:** `/m/receive` opens, an approved disposable receipt can
   be posted, and every back/next link returns to an allowed inventory route. **Denied:** no link bounces to
   `/m`, and money or field-execution cards are absent.
4. Open **الجرد**, submit an approved disposable physical count and inspect the resulting movement/variance.
   **Allowed:** the existing owner/manager/storekeeper stock gate and organisation scope hold. **Denied:** an
   invalid quantity or cross-organisation item cannot be recorded.
5. Open an inventory item and follow its movement and shortage context. **Allowed:** precise stock evidence and
   its legal next action remain reachable. **Denied:** missing stock is not silently displayed as zero when the
   source is unknown or partial.
6. Open **التقارير**, then enter `/m`, `/transactions`, `/people/payroll` and `/settings` directly. **Allowed:**
   inventory, farm, plan and weather answers permitted to the storekeeper open. **Denied:** field execution,
   finance, payroll and Owner settings expose no protected content through deep links.

## 4. Target information architecture

Desktop and mobile derive from one role-gated navigation model.

### Primary spine

At most five direct destinations:

- **الرئيسية** — role home;
- **سجّل** — action launcher;
- **راجع** — only for roles with a legal review/approval action;
- **المعاملات** for finance roles or **الميدان / المخزون** for field/store roles;
- **التقارير** — canonical answer and insight hub.

### Workspaces

All other routes remain available as secondary workspaces, collapsed by default except the active one:

- المزرعة;
- العمليات;
- المخزون والمشتريات;
- المال;
- الفريق;
- التسويق;
- الطقس;
- الإعدادات.

Search/command palette remains the expert fast path. Deep links and bookmarks do not change. Duplicate
dashboard/report/insight launchers are removed from navigation only after their canonical destination is clear.

## 5. Shared page anatomy

Every standard page uses the same compact structure:

1. breadcrumb on deep routes only;
2. compact page header: identity, state and one primary action;
3. one live-data situation sentence;
4. exceptions / next actions;
5. decision-useful summary or comparison;
6. detail table, timeline or form;
7. related records and next suggested destination.

Headers do not exceed two text lines on mobile. Header actions collapse into a menu when they cannot fit.
Unknown values remain `—` / «غير معروف» and never become zero.

## 6. Dashboard contract

Dashboards tell one story in this order:

1. **يحتاج انتباهك** — actionable exceptions, ordered by urgency;
2. **ما تغيّر** — comparison against a valid prior period or target;
3. **الحالة الآن** — no more than four primary measures;
4. **لماذا** — the drivers behind the change;
5. **التفاصيل** — ranked table and drill-down links.

No chart exists merely to decorate a KPI. Use:

- a line only for four or more real time points;
- a target/progress view only where an approved target exists;
- bars for ranked comparison;
- a table when precise comparison matters more than shape.

Every chart has an Arabic takeaway, visible values, an accessible data alternative and a route to the underlying
records. Empty, loading, permission and partial-data states are first-class.

## 7. List and 360 contract

### Lists

- saved role-relevant default view;
- search, bounded filters and exact count;
- row-level status and next action;
- mobile reflow with no horizontal page overflow;
- row opens the 360 page without losing filter context.

### 360 pages

- compact shared identity header;
- semantic status, ownership and freshness;
- overview, activity, related work, documents and finance tabs only when the entity supports them;
- one legal next action inline;
- timeline and source/evidence links;
- sticky mobile action bar for frequent field actions;
- related 360 pages preserve context through URLs.

The five dynamic pages missing the shared header are migrated. Existing tabbed pages retain server-rendered
panels and the server-safe tab ID helpers.

## 8. Design-system direction

- Preserve the calm light visual identity, current Arabic fonts and role/status tokens.
- Replace emoji navigation controls with Lucide icons and accessible labels.
- Use compact 8px-or-less cards only for repeated records or framed tools; do not nest cards.
- Use whitespace and type weight for hierarchy rather than oversized headings.
- Keep controls at least 44px for phone field use; desk density may be tighter without reducing hit targets.
- Use semantic green, amber, red and blue as status accents, not a one-hue page theme.
- Motion is subtle and functional, respects reduced motion, and never hides server-rendered content.

## 9. Performance and accessibility budgets

- Route change must show immediate pending feedback; no silent multi-second wait.
- Keep the shell/navigation bundle free of chart code.
- Dashboard data access is part of this reset, not an assumed healthy baseline. Eight dashboard routes still
  aggregate unbounded table reads in application code. Owner home reads all live palm statuses; inventory home
  reads all items, purchase requests and suppliers. R3 must replace unbounded landing-page reads with bounded
  or exact aggregate contracts before performance can be accepted.
- Lighthouse authenticated target: performance >= 80, accessibility >= 95, best practices >= 95.
- Core Web Vitals target: LCP <= 2.5s, CLS <= 0.1, INP <= 200ms on a representative production-like run.
- Keyboard, focus visibility, landmarks, headings, reduced motion, Arabic bidi and 200% zoom must pass.
- Validate 390px, 768px, 1024px and 1440px; no horizontal document overflow. The current repository has no
  authenticated Lighthouse/axe/mobile Playwright harness: R0/R1 use focused automated tests plus authenticated
  Owner-run browser evidence; a dedicated QA-harness slice must make these budgets repeatable before R5.

## 10. Release sequence

### R0 — Mobile clearance and breadcrumb compactness

Reserve bottom-tab space including the safe area. Make breadcrumbs pure, role-aware and visible only on deep
routes. App-only, no design-system or route/data change.

### R1a — Design-system shell

Add one real sidebar slot, repair overlay/sidebar stacking, use a Lucide menu icon and compact the topbar.
Packages/UI only, with rebuilt tracked distribution.

### R1b — App shell adoption

Move the app navigation into the real sidebar slot, remove the fixed-sidebar workaround, derive desktop/mobile
primary navigation from one model, and add shared compact page/360 headers. No route, query, role or data change.

### R2 — Navigation consolidation

Reduce the role spine to at most five destinations, split the 16-item finance list, fold the 9-item insights arc
under its canonical hub, and remove duplicate launchers while preserving deep routes.

### R3 — Role homes

Owner and accountant first, then manager/agronomist/supervisor/storekeeper. Apply the attention/change/state/
driver/detail story. Replace unbounded dashboard reads in the same release that owns each page. Use only
existing, verified data.

R3 owner/accountant slice contract:

- `/dashboard` routes the owner to `/dashboard/owner` and the accountant to `/finance/dashboard`;
- `/dashboard/owner` is owner-only and obtains all state through one exact, bounded, active-org RPC;
- the owner home renders one attention queue, at most four state measures, an honest unavailable prior-period
  comparison, bounded driver rows and direct detail links; domain figures fail closed unless the source authority
  is verified, all three owner approval queues are covered, and drawings never enter operating expense;
- the accountant finance home starts with actionable finance queues and four daily measures from its existing
  atomic snapshot; the deeper unposted/unpriced/reconciliation/receivables/period comparison contract remains a
  later R3 snapshot extension and is not claimed complete by this slice;
- manager, agronomist, supervisor and storekeeper are released; all six R3 role homes are live.

### R4 — Lists, workspaces and 360 pages

Start with the five dynamic pages missing the shared 360 header and the six raw-table pages, then migrate
Finance, Marketing, Farm, Operations, Inventory and People by workspace. Marketing exact-source drafts remain
separate from operational records.

R4a inventory slice contract (RELEASED — see the R4a section above for the full record):

- `/inventory` and `/inventory/[itemId]` each obtain all state through ONE exact, bounded, active-organisation
  RPC; neither route reads a table directly and neither embeds `inventory_bin`;
- every balance sums EVERY bin of the item, an item with no bin row stays explicitly unknown rather than zero,
  and the threshold reading is never called coverage;
- the storekeeper payload is BUILT without money, valuation, supplier, purchase free text, person and
  purchase-request-id keys, and the operational filter set excludes «بلا تكلفة»; every other member role keeps
  its current finance capability unchanged;
- exact totals are published separately from a deterministically ordered limit/offset page, and each 360
  sample is bounded independently beside its own exact total;
- the return-to-list context is validated and rebuilt rather than echoed;
- `/inventory` is restored to Storekeeper navigation while `/inventory/[itemId]/coverage` stays hidden and
  server-gated; `/inventory/movements` now omits supplier identity from the Storekeeper query and rendering;
- the surfaces are compact Arabic-RTL and phone-first with no horizontal overflow and no client component.

### R5 — Product-wide closure

No-dead-end audit, loading/error/empty coverage, mobile/RTL/keyboard/axe/Lighthouse checks, authenticated role
acceptance, documentation and production verification.

Each release is independently reviewed, committed, pushed, merged and deployed. A release with a migration
follows migrate-first; UI-only releases must not create migrations.

## 11. R0 write scope and gates

Exact R0 write scope:

- `apps/farm-os/app/globals.css`;
- `apps/farm-os/components/AppChrome.tsx`;
- `apps/farm-os/components/MobileTabBar.tsx`;
- `apps/farm-os/components/AutoBreadcrumbs.tsx`;
- `apps/farm-os/lib/breadcrumbs.ts` and focused tests;
- `docs/SPEC-0033-product-ui-reset.md` for the approved program contract and release gates.

Required gates: focused breadcrumb tests; app TypeScript; touched ESLint; full Vitest; Farm production build;
Recharts, client-boundary and service-role guards; `git diff --check`; empty `packages/ui` diff. Authenticated
Owner-run evidence at 390px confirms final content clears the bottom bar, depth-1 pages have no breadcrumb, and
deep 360 routes retain valid role-visible trails.

## 12. Completion

Before R2, the six role journeys in §3 must be expanded into explicit 5–8-step acceptance scripts with allowed
and denied outcomes; otherwise completion is not falsifiable.

The reset is 100% only when all six roles pass the agreed role journey on desktop and mobile, every authenticated
route has the shared shell and a coherent page anatomy, all 22 dynamic pages satisfy the 360 contract, dashboard
drill-downs reach real records, accessibility/performance budgets pass, and the exact production deployment is
verified. A polished shell alone is not completion.
