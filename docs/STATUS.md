# STATUS — Farm OS single source of truth
*The ONLY doc that claims currency. Everything else (TRACKER, SESSION-BRIEF) is an append-only archive.*
*Updated: 2026-08-09 (release-candidate source, role-harness and queue-performance evidence refreshed; not released). Owner: Amr Ebeid.*

**Rule:** update this file whenever repo/prod state changes materially; keep it under ~100 lines. If this file and any other doc disagree, this file wins — then fix the other doc.

**2026-08-07/08 — accounting release stack + C-4 custody correction: INTEGRATED / INDEPENDENTLY APPROVED / NOT RELEASED.**
The canonical validation branch `validation/accounting-release-current-main-20260808` is based on exact current
`origin/main` `07b1224`, including the already-live
Owner public-site release. Twenty-one accounting
migrations remain pending: exact unpaid obligations `20260808040000`, reconciliation review concurrency
`20260808050000`, canonical ordered queue `20260808060000`, exact month close `20260808070000`, exact annual
cost-center history `20260808080000`, exact posted-sale revenue `20260808090000`, and standalone owner-funding
custody reversal `20260808100000`, atomic exact custody dashboard summary `20260808110000`, and exact signed
payment-request totals `20260808120000`, bounded exact daily receivables `20260808130000`, and exact
revenue/A-R report transport `20260808140000`, the exact atomic daily ledger snapshot
`20260808150000`, the exact atomic transactions snapshot `20260808160000`, and the exact atomic season
snapshot `20260808170000`, the exact atomic custody-report snapshot `20260808180000`, and the exact atomic
finance-dashboard snapshot `20260808190000`, the exact custody daily snapshot `20260808200000`, and the exact
expense daily snapshot `20260808210000`, the exact atomic expense-detail snapshot `20260808220000`, and the exact
atomic cost-center report snapshot `20260808230000`, and the exact atomic payment-request detail snapshot
`20260808240000`. The mainline
Owner source migration `20260807220000` is already live under hosted ID `20260808062443` and is not a pending
accounting release action. C-4 adds a movement 360 and an
append-only, linked custody/journal reversal; linked, consumed, stale, cross-org, pre-original-date and
locked-period cases fail closed. The old `/finance/pnl` and `/finance/pnl-trend` surfaces are now
owner/accountant-gated compatibility redirects into one trusted GL income-statement route with statement and
monthly/annual trend views. Valid legacy filters are preserved; repeated, impossible, partial-conflicting and
reversed ranges fail safely before any RPC. The reports hub and sidebar expose only the canonical statement,
and cost-center reporting shows a truthful zero when posted revenue is zero. Independent review's date-range
and alias-role findings were corrected; rereview returned APPROVE with no P1-P3 finding. The chain passes Docker-free pgTAP
**4,018/4,018**, including a 21-assertion three-backend C-4/period-close race, 9 atomic custody-summary,
26 exact payment-request, 11 exact custody-write, 29 exact receivables, 35 exact revenue-report and 30 exact
daily-ledger assertions, 59 exact transactions assertions, 70 exact season assertions, 49 exact custody-report
assertions, 44 exact finance-dashboard assertions, 29 exact custody-daily assertions, 30 exact expense-daily
assertions, 24 exact expense-detail assertions, 42 exact cost-center-report assertions and 44 exact payment-request
detail assertions; full Vitest **1,745 passed
+ 14 controlled skips** across 125 passing files, TypeScript, zero-warning full ESLint, `npm audit` with zero
vulnerabilities, the **63/63-page** production build and whitespace checks are green. The
concurrency migration is transactional and immediately replay-tested; aggregate money travels as exact decimal
text and is summed without binary floating-point. The local-only browser harness constrains Next server reads
and browser requests; its allowlisting wrapper strips privileged variables, requires a private single-use
30-second acknowledgement for Farm production reads, refuses Next `.env*` files, and runs a fresh build/server
under the scrubbed environment. Synthetic discovery refreshed on 2026-08-09 and still lists all **22** role tests.
Release-harness audit found that its exact RPC POST allowlist omitted two reads required by those tests:
`fn_cost_center_reports_snapshot` for both cost-center report modes and
`fn_reconciliation_acceptance_snapshot` for the acceptance page/CSV. Both are now explicitly allowed and pinned by
positive tests; no write RPC or broader URL/origin policy was admitted. Focused Vitest passes **205/205**, full
Vitest is now **1,745 + 14 controlled skips**, TypeScript and touched-file ESLint are clean, and independent
read-only/security review returned **APPROVE with no P0-P4 finding** after reconciling every 22-test workflow.
The credentialed suite now also fails on any browser page exception or console error across the primary page and
all context-created pages. Mandatory hooks close the context before assertion, missing guard state fails closed,
and a typed runtime validator permits only the generic `pageerror` / `console:error` categories so browser detail
cannot enter reports. Regression Vitest passes **22/22**, synthetic collection remains **22 tests**, and final
independent rereview returned **APPROVE with no P0-P4 finding**. Credentialed execution remains unrun.
The private canonical workbook, snapshot and exception-evidence suite plus the import convention guard pass
**102/102**; the generated package remains exactly 698 rows. The ephemeral 698-row queue benchmark returned 50
rows with **33.80 ms median / 37.91 ms p95** over 30 measured calls after warm-up. The expanded matrix now covers
the record/approvals/reports/insights hubs, scale delivery, every daily money-entry form, both cost-center modes,
reconciliation and month close, and real statement downloads that must return HTTP 200 with PDF attachment
headers, `%PDF-` start bytes, final non-whitespace `%%EOF`, and nontrivial size. Independent review's false-PDF
proof and WebSocket-log findings were corrected; final rereview returned APPROVE. The credentialed suite
remains unrun because all required role, batch and Supabase runtime inputs are absent. Independent
safety re-review returned **APPROVE** with no P1-P3 finding; its one historical-doc P4 was corrected. No duplicate
migration timestamp or rejected patch. The dependency lane resolves `nanoid` 3.3.17 and scoped `js-yaml`
4.3.1/3.15.1; current `npm audit` reports **0 vulnerabilities**, and independent dependency review approved it.
The season cockpit now uses one exact atomic snapshot. Physical deliveries remain visible, but booked revenue,
collections, A/R and center revenue require exactly one valid posted same-org two-line sale journal; invalid
revenue evidence is counted and labelled, and a truncated newest-400 delivery sample cannot export partial CSV.
Independent rereview returned **APPROVE** after journal-shape, sibling-journal, date and parser invariants were fixed.
The custody report pack now uses one exact atomic snapshot instead of four independent RPC calls. Full holder,
period movement/cash, current obligation and period funding totals remain separate from bounded 400-row detail;
unknown dates and amounts stay explicit and truncated tables cannot export partial CSV. Historical obligation
dates are rejected because mutable payment status is not a historical ledger. Report queries are period-bounded,
active cash-out and request-line uniqueness are proven, and report-affecting tenant/reversal drift fails closed.
Independent final review returned **APPROVE** after historical-status, duplication and query-performance findings
were corrected.
The finance operating dashboard now uses one role-aware atomic snapshot. Exact totals/counts remain separate from
bounded detail, decimal money stays exact, incomplete exports are disabled, unverified budget figures are withheld
inside PostgreSQL, private finance remains owner/accountant-only, current-user custody is identity-based, and
cross-org supplier/custody corruption plus inconsistent Cairo month bounds fail closed. The first independent
review's five findings were corrected; test 217 passes 44/44.
Focused independent rereview returned **APPROVE** with no severity finding.
The daily custody workspace now uses one finance-gated atomic snapshot instead of seven independent reads. Exact
full balances, targets, top-ups, unpaid totals and request/movement counts remain separate from bounded newest
detail. Signed historical balances remain visible, same-day movement ordering is deterministic, partial request
CSV is disabled, and missing or foreign account references fail closed. Test 218 passes 29/29; independent
rereview returned **APPROVE** after signed-balance, ordering and corruption-fixture findings were corrected.
The daily expense workspace now uses one role-aware atomic snapshot instead of four independent reads. Exact
filter counts and full summary remain separate from the newest 200 matching rows; incomplete or inconsistent
payloads fail before render/export, exact decimals preserve source scale, farm-manager chart-of-accounts and
drawing privacy match the prior RLS behavior, and supplier/account/cost-center corruption fails closed. The
all-row organization/date/ID index supports newest-first display. Test 219 passes 30/30; independent rereview
returned **APPROVE** after all five access, money, completeness, coverage and performance findings were corrected.
The expense 360 now reads one role-aware atomic snapshot for its core record, linked event, account, custody-payment
history and payment-request links. Exact decimal text is preserved through display and correction writes; runtime
numeric correction payloads fail closed, timestamp parsing is strict, role privacy remains unchanged, and foreign
tenant links fail inside PostgreSQL. Test 220 passes 24/24; final independent rereview returned **APPROVE**.
The payment-request 360 now reads one finance-gated atomic snapshot for the request, bounded line detail, linked
expenses, custody funding movement and posted journal evidence. Exact decimal text and full unpaid-line counts stay
separate from bounded detail; malformed status/time/money, cross-tenant links, incomplete samples and incorrect
movement or journal polarity fail closed. Test 222 passes 44/44; final independent rereview returned **APPROVE**.
The owner dashboard no longer waits for a separate second network wave to obtain pending-price and unpaid-expense
attention counts. Both exact head-only reads now run in its first parallel batch, are explicitly organization-scoped,
and fail closed instead of silently rendering zero on a read error. A source regression independently pins each
query's scope, count mode and business-status filter; focused Vitest passes 8/8 and independent rereview returned
**APPROVE**. Full Vitest is **1,745 + 14 controlled skips**, TypeScript, full ESLint and the 63/63-page build are green.
No accounting candidate commit, push, PR, hosted migration, merge, deployment, production query or business-row
change occurred. Accounting remains **~99.5%, not 100%** until all 698 held rows are human-decided, exceptions
are resolved, the real workbook dual run is completed, and dated accountant/Owner acceptance is recorded.
The canonical batch was created by an Owner, so acceptance also requires a different eligible Owner who created
neither the batch nor any row review; the database separation rule rejects approval otherwise.
The frozen-batch page now checks that rule before enabling approval, using a tenant-scoped bounded reviewer lookup;
creator and reviewer Owners see the exact blocked reason while the RPC remains authoritative. Independent review
returned **APPROVE** with no P1-P4 finding.
Every accounting release action remains explicitly Owner-gated and migrate-first in the order above.

The schema-v2 release manifest binds the full **220-file** candidate boundary: 165 aggregate-hashed
app/docs/root files, 51 individually hashed migration/test/support artifacts, and four release controls (manifest plus three
hash-pinned, mode-`100644` programs). Git path discovery is NUL-safe; candidate bytes and modes are bound; symlinks,
non-canonical paths, hidden assume-unchanged/fsmonitor flags, repository-control environments, unexpected paths,
renames, deletions and unsupported modes fail closed. Separate strict and working-tree launchers pass literal
release modes, so Node argument/preload mutation cannot convert the committed gate into the local check. The local
check passes all 220 files; the strict command intentionally fails until the candidate is committed and clean,
then compares every bound byte and mode with `HEAD`. `origin/main` is explicitly a local cached ref and must be
fetched immediately before release. Independent review challenged newline paths, mode binding, Git anchoring,
hidden flags and a self-concealing preload; adversarial probes reproduced each gap, all were corrected, and final
narrow rereview returned **APPROVE** with no P1-P4 finding.
Six durable Vitest cases run the real guard in isolated temporary Git repositories and behaviorally prove the
working-tree path, concealed-preload rejection, exact path set, program byte/mode binding, assume-unchanged and
fsmonitor-clean rejection. They never depend on the release checkout's `origin/main` and clean only their own
`mkdtemp` roots. Independent test rereview returned **APPROVE** with no P1-P4 finding.
The canonical [accounting acceptance runbook](accounting%20reconciliation%20acceptance%20runbook.md) turns the
existing digest-bound report into an explicit role-separated process: review, freeze, Owner approval,
pre-execution dual run, separately authorized execution, final verification/signatures, restricted evidence
retention and fail-closed rollback. It does not decide any row or authorize any external action.
The canonical [accounting release execution runbook](accounting%20release%20execution%20runbook.md) now binds the
external handoff: exact-commit CI before migration, the twenty-one-version migrate-first order, forward-only database
recovery, read-only role acceptance, separate merge and production-deployment approvals, and explicit exclusion
of migration-history issue #903. Independent review returned **APPROVE** with no P1-P4 finding.
The renamed chain, including direct filters for all three named acceptance quality exceptions, was replayed
from scratch at **4,018/4,018**; full Vitest is **1,745 + 14 skipped**,
full ESLint, TypeScript and the **63/63-page** build pass. Final independent rereview returned **APPROVE** after
the Node main-module/symlink launch path was proven fail-closed. No test/build count is asserted by the manifest
itself, and no release action occurred.
The approved money-direction launcher is now integrated on current main: owner/accountant actions are grouped as
cash in, cash out, on-account, sales before collection, and separate farm operations; role-empty groups disappear.
The two expense cards preset custody or later without changing the live step-3 choice or posting action. All four
expense picker reads are active-organization scoped and fail closed. The cost-center shortcut explicitly presets
custody. The read-only acceptance suite now advances both preset URLs to step 3 and proves the actual payment
selector is `custody` or `later` as requested, without submitting; its installed request policy remains the
authoritative mutation guard. Two source-contract review rounds tightened the exact two-click and guard-invocation
proof, and final narrow rereview returned **APPROVE**. Synthetic discovery remains 22 tests. Focused tests pass 13/13 and the
full app, lint, TypeScript, 63/63-page build, whitespace and 220-file working-tree preflight are green.
Independent acceptance-filter review then found missing sale-link and real cross-organization fixtures plus two
catalog/spec inaccuracies. All were corrected; test 161 now passes 40/40, the manifest re-pins its exact bytes,
and final narrow rereview returned **APPROVE**.
The acceptance report now opens exact allowlisted queues from seven actionable figures: three named quality
exceptions, unreviewed, held, rejected, and amount-correction candidates. Links retain the visible count in
their accessible name and remain read-only/printable. Linked corrections, frozen rows without a payload hash,
and missing-evidence alarms remain unlinked because no exact queue predicate represents those populations.
Independent review returned APPROVE after accessibility, mapping, and negative-presence test hardening.
The review queue's six whole-batch KPI cards now open their exact all/unreviewed/included/held/rejected/frozen
populations on canonical page one, clearing unrelated classification and quality filters. Their accessible names
include label and count. Independent review's count-to-route regression gap was corrected; final rereview APPROVE.

The revenue/A-R report now uses a finance-gated exact wrapper around the established report query. Every known
money and quantity field crosses PostgREST as JSON text, strict parsing fails closed, tables preserve significant
decimal scale, and a chart degrades as a whole with an explicit precision message if any displayed decimal cannot
round-trip safely through the chart library. The first independent review found two P2 findings (mixed unsafe
chart-row omission and two-decimal report-cell rounding) plus one P3 SQL coverage gap. All three were corrected;
the focused 7-test contract and 35-assertion database contract pass, and independent rereview returned APPROVE.

The daily `/accounting` ledger now comes from one atomic, finance-gated organization snapshot instead of four
reads over two waves. Posted trial balances and KPI subtree rollups preserve exact decimal text; archived
ancestors remain available for historical rollups; cross-tenant/account mismatches, malformed payloads and
incomplete recent-line detail fail closed. The latest 20 entries and their lines are explicitly display-only,
while the complete trial balance retains CSV export. Test 213 passes 30/30 and independent rereview returned
APPROVE with no P1-P4 finding. This migration remains local and release-gated.

The unified `/transactions` ledger now comes from one atomic finance-gated snapshot instead of split source,
count and party reads. Exact full counts remain separate from 400-row newest-first samples per source; money and
quantity stay decimal text; cancelled and historically reversed rows remain excluded while null-status expenses
and live pending prices remain visible. Party joins are tenant-scoped and missing/foreign references raise inside
PostgreSQL before a payload is returned. Full-type row keys prevent collection/custody UUID collisions. Test 214
passes 59/59, including 401-row boundaries for all four sources. This migration remains local and release-gated.

The latest local app pass also removes false completeness from bounded finance and supplier views. Null expense
amounts remain explicit, exact counts fail closed, latest rows are deterministic, finance data remains
owner/accountant-only, and capped expense/purchase tables no longer expose partial CSV files as complete exports.
Supplier finance and purchase badges use exact counts; bounded movement/workload labels say they are displayed
rows. Finance dashboard reads now run in one parallel wave. Custody account metadata and balances come from one
organization-scoped, `finance.read`-gated database snapshot instead of a per-account RPC fan-out; target and
closing money stays exact decimal text through parsing, arithmetic, sorting, export and Arabic EGP rendering.
Independent review's snapshot, JSON precision and exact-sort findings were corrected; final rereview returned
APPROVE with no P1-P3 finding. The unified `/approvals` inbox now loads its role-conditional sign-offs,
purchase requests and payment requests in one parallel network wave instead of up to five serial reads; material
names use the existing relational embed, every query is explicitly organization-scoped, and all read errors fail
closed. The role, payment-stage and purchase-request self-approval gates are unchanged. Claude review was attempted
but unavailable because the local CLI is logged out, so no Claude approval is claimed for this app-only slice.
The bounded `/transactions` ledger also now resolves suppliers, buyers and custody holders inside its existing
source-query wave instead of waiting for three dependent lookups. Embedded rows are explicitly filtered to the
active organization; a missing or cross-org relationship fails closed, and exact parent counts are unchanged.
Independent review's multi-organization isolation finding was corrected; final rereview returned APPROVE.
`/expenses/[expenseId]` now loads its expense, event, ledger account, custody-payment history and payment-request
link from one role-aware atomic snapshot. Exact correction money remains decimal text; malformed timestamps,
runtime numeric payloads and missing or cross-organization relationships fail closed. Test 220 passes 24/24 and
final independent money/access rereview returned APPROVE. The owner/accountant custody movement 360 now reads its movement and active-org
custody account in one inner relationship query instead of two serial reads. Movement amounts are requested as
text and rendered from exact decimal strings with every significant fractional digit; malformed money fails
closed. Behavioral tests exercise every correction-eligibility gate. Independent review's precision and test-depth
findings were corrected; final rereview returned APPROVE. The signed payment-request page now requires every RPC
and direct-row amount as exact text, computes category totals without JavaScript floating point, and passes owner
funding to the numeric RPC as a validated canonical decimal string. All tenant-owned request, line, funding,
expense, custody-account, people and chart-of-accounts reads are explicitly active-organization scoped; malformed
money fails closed. Migration `20260808120000` also makes the security-definer totals function fail closed on
cross-organization custody, line, expense, funding or movement links. Its SQL consumers remain compatible through
`->>` numeric casts. Independent rereview returned APPROVE with no P1-P3 finding. Custody account targets,
standalone owner-funding receipts, holder transfers and the quick-entry custody wizard now keep numeric input as
validated decimal strings through the client and server action; non-string runtime payloads fail closed. Database
round trips prove exact targets, movements, journals, transfers and balances. Independent rereview returned
APPROVE with no P1-P3 finding. Sale pricing and customer collection now load one bounded, active-organization
database snapshot per screen instead of independent sales, buyer and unbounded collection reads. Quantities,
unit prices, totals, collections and remaining balances stay as exact decimal text through display and writes;
collection dates use the Cairo farm calendar day rather than the server UTC day;
malformed, cross-organization, over-collected, non-posted and denied-role cases fail closed. Migration
`20260808130000` also returns exact write totals as JSON strings and rejects a positive price whose rounded
sale total would be zero before changing the sale or journal. Independent review found that zero-rounding
post-write mismatch; the database and preview guards corrected it, and rereview returned APPROVE with no
remaining P1-P3 finding. Current app evidence is **1,601 passed + 14 controlled skips** across 117 discovered files, full ESLint,
TypeScript, **63/63-page** build and whitespace checks.

**2026-08-07/08 — Owner public-site comments: MIGRATED / MERGED / DEPLOYED / LIVE-VERIFIED.**
The public site now carries the Owner's About copy, 120 feddans / 5,000 Barhi palms / 7 blocks, contact identity
«مزرعة عبيد للتمور», `ebeidfarm@gmail.com`, and East Asian markets. The primary number appears once as WhatsApp;
only the distinct secondary number remains callable. Hosted migration `20260808062443 owner_public_site_comments`
applied migrate-first and exact postflight passed. PR #1006 merged as `a11a7e0`; exact-merge CI, db-tests and
release passed with deployment `5806268580`. Documentation PR #1007 merged as current main `07b1224` with
deployment `5806327642`. Live Chrome at 390px and 1,440px verified both languages, contact-link counts, no
farm-area table, no overflow and no browser errors.

**2026-08-05 — public-home mobile repair: MERGED / DEPLOYED / LIVE-VERIFIED.**
PR #1000 merged at `fc9e10f402248ea65f44580610c4c61477defb8a`; exact production deployment
`dpl_6a3JjaGkx4uaP1uXeTS6gEW2ZZtE` is READY on `ebeidfarm.business`. Mobile now has no horizontal overflow,
a 57px header, a contained five-link menu that closes after selection, compact sections and a one-column
enquiry form; desktop navigation remains visible at 1,440px. Live Chrome at 360/390/1,440 found viewport and
document widths equal, working Arabic-to-English switching, and zero console/page errors; Vercel found no `/`
runtime error clusters. The production Arabic hero is 818px at 360 and 767px at 390, so the stats start at
y=851 and y=800. Review fixed the initially omitted mobile nav and CodeRabbit's deprecated clipping fallback.
All exact-head CI gates, 1,364 Vitest assertions, TypeScript, lint and build passed. No migration existed; no
SQL, Supabase object, business data, authentication or financial state changed. Security remediation remains
the next planned module; any further first-fold hero reduction is a separate UX choice.

**2026-07-30 — transaction-ledger exact counts and bounded display: MERGED / DEPLOYED / SIGNED-OUT SMOKED.**
PR #993 merged at `393523d09cb413c7e2e46fe437c76778b70fdf08`; production deployment
`5677632065` completed successfully. `/transactions` had derived its filter counts from capped source arrays,
reporting 563 rows instead of the exact 10,364 current rows and omitting 9,801 expenses from the All count.
The page now uses exact active-organization count metadata for 10,201 expenses, 162 sales, 0 collections and
1 custody movement while displaying at most the latest 400 rows from each type. It discloses that bound and
the displayed-row search scope, disables CSV for any truncated selection, counts pending prices exactly,
excludes cancelled/reversed positive money, orders null dates deterministically, fails closed on every source
or lookup error, and resolves only referenced party IDs. Independent review: APPROVE after the All-view
wording and lookup-cap findings were corrected. Evidence: focused Vitest 37/37; full Vitest 1,361 passed +
13 controlled skips; TypeScript, ESLint, 63-page build, pgTAP 3,158/3,158 and exact-main CI/release/db-tests
green. Both login aliases return 200 and signed-out `/transactions` redirects to login. No migration,
dependency, schema, RPC or business-row change. Accounting remains ~99.5%; the 698 human decisions,
exceptions, real workbook dual run and dated accountant/Owner acceptance remain.

**2026-07-30 — recent-journal exact amounts: MERGED / DEPLOYED / SIGNED-OUT SMOKED.**
PR #991 merged at `9ee71d6a62439705dfec568707fb3115c2c09489`; production deployment
`5677028615` completed successfully. `/accounting` previously paired its latest 20 journal entries with an
unrelated latest-80 global line sample, causing every displayed recent amount to appear as zero. The page now
loads lines only for the displayed entry IDs and active organization, uses deterministic null-last ordering,
fails closed at its explicit 500-row bound, renders missing line data as unknown, and labels the detail table
as the displayed-entry subset. Production aggregate proof found 20 entries, 40 exact matching lines, no
line-less entry and EGP 201,132 debit; the entry-scoped query completed in about 6.4 ms. Independent review:
APPROVE after a page-source regression guard and comment correction. Evidence: focused Vitest 7/7; full
Vitest 1,324 passed + 13 controlled skips; TypeScript, ESLint, 63-page build, pgTAP 3,158/3,158 and exact-main
CI/release/db-tests green. Both login aliases return 200 and signed-out `/accounting` redirects to login.
No migration, dependency, schema or business-row change. Accounting remains ~99.5%; the 698 decisions,
exceptions, real dual run and dated accountant/Owner acceptance remain.

**2026-07-30 — expense-register exact summary: MIGRATED / MERGED / DEPLOYED / SIGNED-OUT SMOKED.**
PR #989 merged at `087c0be2e7007ac1dec6e3333da2e5b8fc576c41`; production deployment
`5676508008` completed successfully. The old `/expenses` page received only 1,000 of 10,201 production
rows, understating the all-row count by 9,201 and the operating/drawing chips by 8,009/681 while rendering
an unnecessarily large table. The new authenticated-only, org-scoped `fn_expense_register_summary`
computes exact register counts and monthly money; capex and historical-treasury remain included,
cancelled/historical-reversed money is excluded, unknown amounts remain explicit, and drawings stay hidden
from farm managers. The active-org list is limited to the latest 200 deterministic rows with an honest
disclosure; truncated search is labelled and partial CSV export is disabled. Production verification proved
owner/farm-manager role behavior, hardened grants and unchanged 10,201 expense rows. Independent review:
APPROVE after two correction rounds. Evidence: pgTAP 3,158/3,158; Vitest 1,317 passed + 13 controlled skips;
TypeScript, ESLint, build and exact-main CI/release/db-tests green. Both login aliases return 200 and signed-out
`/expenses` redirects to login. Accounting remains ~99.5%; the 698 decisions, exceptions, real dual run and
dated accountant/Owner acceptance remain.

**2026-07-30 — cost-center exact totals: MIGRATED / MERGED / DEPLOYED / SIGNED-OUT SMOKED.**
PR #987 merged at `fc6b7f97af1a504b766217fa47d859fc7cb09097`; production deployment
`FKzRYqjsH4VJZXe6Bx9iHLBxNBZV` completed successfully. The cost-center 360 had presented sums of its
latest 200 detail rows as complete totals. Read-only production evidence found 16 affected centers,
up to 1,140 expense rows, with approximately EGP 10.27m omitted across the capped views. The page now
uses the exact, org-scoped, `finance.read`-gated `fn_cost_center_direct_summary`; cancelled and
historical-reversed expenses are excluded, historical-treasury rows retain their current contract, sale
revenue requires a still-posted journal, and unknown expense amounts are disclosed rather than zeroed.
Detail tables remain bounded and now disclose truncation with null-last deterministic ordering. Production
migration and authenticated owner-context aggregate verification succeeded; no tenant or financial row
changed. Independent review: APPROVE after one correction round. Evidence: pgTAP 3,132/3,132; Vitest
1,305 passed + 13 controlled skips; TypeScript, ESLint, build 64/64 and exact-main CI/release/db-tests green.
Both production login aliases return 200 and a signed-out cost-center route redirects to login. Accounting
remains ~99.5%; the 698 decisions, exceptions, real dual run and dated accountant/Owner acceptance remain.

**2026-07-30 — finance-dashboard budget truthfulness: MERGED / DEPLOYED / SIGNED-OUT SMOKED.**
PR #985 merged at `22428eac6bb2a7bf4666819e8f4c160b6e7e7bbc`; production deployment
`9jXcmKy6NBeYuhLuRwtVH4kjTSYD` completed successfully. The active-org budget query is explicit, and the
existing parallel query wave now also reads budget authority. Unless that authority is `verified`, the
dashboard renders no budget money KPIs, charts, pressure table, print content or CSV control; it shows the
standard source warning instead. If verified later, these foundation-maintained figures are labelled
**snapshot**, with an explicit not-live-control warning and a link to posted-ledger budget-vs-actual.
Read-only production preflight confirms `budgets=blocked` and `finance_ledger=partial`, so no unsupported
budget figure is exposed. Local evidence: focused Vitest 3/3; full Vitest 1,301 passed + 13 controlled skips
across 92 files; TypeScript and touched-file ESLint clean; build 64/64; independent money-surface review
APPROVE after one correction round. Exact-merge CI, release and pgTAP are green; `/login` is 200 and signed-out
`/finance/dashboard` redirects to login. No migration, schema, RPC, dependency, authority row, financial row
or budget value changed. Issue #905 was also closed as superseded after read-only production proof found the
private `1010` helper + trigger present, 0 eligible organizations missing `1010`, and 0 non-single `1010`
organizations. Accounting remains ~99.5%; the 698 row decisions, exceptions, real dual run and signatures
remain human work.

**2026-07-30 — read-only accounting role-acceptance harness: MERGED / DEPLOYED / SIGNED-OUT SMOKED.**
A separate Playwright configuration now covers owner and accountant access to the reconciliation list,
pinned batch, GET-only evidence-quality filter, acceptance report and CSV, plus the non-finance redirect.
It uses explicit environment credentials only, blocks service workers, and aborts every non-GET/HEAD/OPTIONS
request after login; it imports no service-role/admin/database client and cannot stage, decide, freeze, approve,
execute or roll back a row. Remote execution requires an explicit acknowledgement and the exact
`https://ebeidfarm.business` allowlist. Local evidence: focused Vitest 8/8; full Vitest 1,300 passed + 13
controlled skips across 92 files; TypeScript and touched-file ESLint clean; build 64/64; missing configuration
fails before browser launch. The authenticated suite was **not run** because this worktree has no role
credentials. Independent safety review: APPROVE after three rounds. No migration, dependency, app workflow or
data changed. Stage 7 remains ~99.5%: all 698 rows are
still unreviewed/hold, 0 frozen; the human dual run, exception decisions and signed accountant/Owner acceptance
remain required. PR #983 merged at `3962e8caea3cff062e00c46085a2146d069f3729`; exact production deployment
`dpl_DmWDiUSzmoid9cX5txnqX4PdMx1J` is READY. Main CI, release and pgTAP are green; `/login` is 200, signed-out
reconciliation routes redirect to login, and the release has no 5xx runtime logs. The credentialed suite remains
unrun.

**2026-07-30 — review-state and evidence-quality fixes: MERGED / DEPLOYED / LIVE-VERIFIED.**
PR #979 merged at `93806f838af6102ed8b09e9dd8830fb5bf11e2ff`; deployment
`Fcy2Dq2PviGUD2kVmaegqiN92fyZ` is READY. Cancelling or closing a row form now discards every abandoned
field, and reopening is gated until the post-save refresh commits. PR #981 merged at
`7566402c1ca8757cb4e609ee9e35d3f0d949a932`; deployment `5XWz8F9CE29VcyTq4bWLbRaHySm2` is READY.
The queue can now route directly to invalid-source-date and missing-source-amount exceptions. Aggregate-only
production evidence: 698 unreviewed/hold rows, 0 frozen, 15 correction rows, 2 missing-source-amount rows
(both `production_snapshot`), and 0 invalid-date rows in the staged queue. Neither release carried a migration
or changed a business row. These controls support the human acceptance gate; they do not complete it.

**2026-07-30 — acceptance amount-correction totals: MERGED / DEPLOYED / LIVE-VERIFIED.**
PR #977 merged at `002d04cfcad74f7bdc6088c4111d6d68a6bcee88`; exact production deployment
`dpl_7G5oxX4nd7JswTUnsPiBAjShVAcf` is READY.
The acceptance report counted an included amount-correction row's full source amount as a posting, but
execution reverses the record the row names and posts a replacement only for a positive amount, so ordinary
posting totals were
overstated by every reversed amount. Healthy correction rows carry both correction evidence and the
dataset-matched `corrects_*_id` link; the report treats either signal as a correction so malformed rows fail
closed into an integrity group instead of entering ordinary totals or receiving a normal execution claim.
Valid correction rows now form their own phase-aware destination and
are excluded from `plannedPostingTotal` and from every period/sheet
`postingAmount`; their gross replacement amount is reported separately as `correctionReplacementTotal`
with an unconditional caveat that zero is reversal-only, the net ledger effect is new minus old, and it is
not computed anywhere in
this report, and is not a P&L figure. `execution_result='reversed'` is now read as the expected result for
an executed correction instead of "unsettled". The ordinary headline now uses the same reported-destination
basis as the destination and control tables. No migration,
RPC, schema, grant, gate, decision, write, CSV schema, or digest recipe/version changed
(`farm-os.reconciliation-acceptance.v1` stands); correction destination cells intentionally change and are
already digested, so a row moving
between addition and correction changes the package digest without a format change. Local evidence: focused
acceptance Vitest 157/157; full Vitest 1,277 + 13 controlled skips across 91 files; TypeScript clean;
ESLint clean on the three touched files; build 64/64 static pages; `git diff --check` clean. pgTAP was NOT
run — no SQL byte changed. Independent review: APPROVE after three correction rounds. Phase 2
(net-effect computation) stays gated on human selection/linkage plus accountant policy. Exact-head checks and
exact-merge main CI, release, and db-tests are green. Public `/login` is 200, the signed-out acceptance route
redirects to `/login`, and the post-release runtime-error window is empty. No migration or business row changed.

**2026-07-30 — accounting acceptance control totals: MERGED / DEPLOYED / LIVE-VERIFIED.**
PR #975 merged at `bf0895ef3bf61cef11cda12f1b6d90a0a1edf033`; exact production deployment
`dpl_A7fXs2LWRVZEzzyYgS99tFPwK6rR` is READY.
The read-only acceptance packet now partitions the same bounded snapshot by validated calendar month/year
and recorded workbook sheet, with unknown amounts and every invalid/missing source group explicit. Both
tables close on the unchanged batch source total; fiscal mapping and dual-run selection remain accountant
decisions. The one snapshot read, decisions, gates, CSV bytes, digest/version, and database are unchanged.
Independent review: APPROVE after print-fit and Arabic/Persian numeral-order fixes. Focused Vitest 144/144;
full Vitest 1,264 + 13 controlled skips; build 64/64; pgTAP 3,118/3,118; exact-head checks green.
Exact-merge main CI, release, and db-tests are green. Public `/login` is 200, the signed-out acceptance route
redirects to `/login`, and the post-release runtime-error window is empty. Authenticated real-route print
remains unexercised; Chrome A4 replica and print-contract tests are green. No migration or business row changed.

**2026-07-30 — balance-sheet organization integrity: MERGED / MIGRATED / LIVE-VERIFIED.**
PR #973 merged at `4a051030c7b246b3126c04a4a609e857c1ad6e20`; exact production deployment
`dpl_GVgRWZCojujLYzF1qgK4GDT7jDms` is READY. The balance-sheet RPC now fails closed when posted journal
entry, line, and account organizations disagree. Production migration
`20260730083902 accounting_balance_sheet_account_integrity` is applied. Postflight confirms all three
guards, unchanged `STABLE` / `SECURITY DEFINER` / empty
`search_path` metadata, authenticated-only execution, and zero account-org or entry-line mismatches across
20,730 posted lines. Focused pgTAP is 10/10; full Docker-free pgTAP is 3,118/3,118; independent review is
APPROVE; exact-head and exact-merge app, design-system, db-tests, release, gitleaks, and Vercel checks are
green. Public `/login` is 200 and the post-release runtime-error window is empty. No business row changed.
All five #719 items are closed; accounting acceptance remains human-gated.

**2026-07-30 — explicit journal entry dates: MIGRATED / HOSTED-VERIFIED.**
Farm production migration `20260730075952 accounting_journal_entry_date_required` removes the internal
journal helper's silent `current_date` fallback and rejects a null accounting date before posting or retry
lookup. Every active caller already supplies a resolved business date. Valid-date idempotency remains before
the period-lock check. Postflight confirms the exact 14-argument function is `SECURITY DEFINER`, volatile,
`search_path = ''`, contains no current-date fallback, and grants no execute privilege to public, anon, or
authenticated. Full Docker-free pgTAP: 3,108/3,108. Independent review: APPROVE. Exact-head GitHub app,
design-system, build, guard, gitleaks, and db-tests checks are green; the first run was delayed and an
intermediate run was correctly canceled by the final docs commit. No business row changed. See
`accounting journal entry date audit 2026 07 30.md`.

**2026-07-30 — palm source reconciliation: LOCAL / FAIL-CLOSED / NO DATA CHANGE.**
The hash-pinned oracle proves the 2026 workbook's Barhi rows total 4,638, not its stated 4,539; male
rows total 370; and 28 units depend on an unmatched Shafaa shape. It also reports duplicate sector 3,
malformed dates, and 2021 heading/range conflicts around explicit numbering 1–759. The old 4,380/299/28
baseline and later workbook are both non-authoritative. The oracle emits no import payload. Exact gate:
a corrected Owner+farm-manager-approved unit registry or fresh signed field count. No migration or
production data changed. See `palm registry source reconciliation 2026 07 30.md`.

**2026-07-27 — full data audit + report authority gates: MIGRATED / MERGED / DEPLOYED / LIVE-VERIFIED.**
Farm production migration `20260727145912 data_authority_status` applied before PR #931 merged at `7ce98f5`;
deployment `dpl_DUtDwchLmRVfU9He4MjXMvoeNNJk` is READY. Seven org-scoped authority states now fail closed:
ledger/inventory/operations partial; palms unverified; offshoots/budgets/payroll blocked. Palm, offshoot,
operations, and budget reports suppress unsupported totals/exports; budget-vs-actual shows posted-GL actuals
only, explicitly labeled partial, until both ledger and budget sources are verified. Verification is owner-only
and requires source label, record count, and evidence notes. Live owner-session checks passed with no runtime
errors. Financial rows remain 10,201 expenses / 162 sales / 10,365 journals. This protects report truthfulness;
it does not fill the missing records. See `data coverage audit 2026 07 27.md`.

**2026-07-27 — staged reconciliation review filters + read performance: MERGED / DEPLOYED / LIVE-VERIFIED.**
PR #927 merged at `2d325fd`; production deployment `dpl_HZhU5r8gfFXYorbq4AzNzjgA47fV` is READY.
The 698-row batch now has allowlisted server-side classification and decision-state filters, exact filtered
pagination, preserved filter links, and a distinct empty-filter state. Whole-batch KPIs and freeze/approve/
execute/rollback gates remain unfiltered and unchanged. Live owner-session checks returned all 698 rows,
15 amount-correction rows when filtered, and 0 included amount-correction rows with the full-batch 698 KPI
and disabled freeze gate still visible. Runtime errors: none. No migration existed and no decision, financial
row, action link, execution claim, freeze, approval, or execution changed. The acceptance gate remains human.
PR #929 then merged at `0155c8e`; production deployment `dpl_5bUiqwDEy9r4p6rHG4FBSbxMz9Ev` is READY.
It overlaps the same bounded independent server reads without changing query scope or output. Live owner-session
timings were 4.2s navigation and 2.8s immediate reload, with 698 rows and every release gate unchanged.

**2026-07-27 — canonical reconciliation staging: MERGED / DEPLOYED / STAGED / VERIFIED.**
PR #925 merged at `d976bba` and Vercel production deployment `dpl_B2rhqKSC3n4QX9z3JqnC7DquBKwb` is READY.
The owner-session app path staged deterministic batch `80a1051d-5bcf-504c-93cd-07206b4c59ef`: 698 evidence
items and 698 batch rows, all `unreviewed` / `hold` / not frozen. Workbook, protected snapshot, and exception
evidence hashes match the pins; execution ledger and action links remain 0/0. Financial counts and totals are
unchanged: 10,201 expenses (EGP 20,527,757.01), 162 sales (EGP 25,835,533.40), 10,365 journals, 20,730 lines.
No expense, sale, journal, custody, or payment row was posted or changed. Remaining accounting acceptance gate:
owner/accountant row decisions, dual-run, exception resolution, and signed accountant acceptance.

**2026-07-07/08 — the finance half of Stage M landed.** The loaded 7-year history (10,201 expenses / 162 sales, 2019–2026) is account-linked and posted to the double-entry GL, with a 2017–2018 opening balance; the BS/IS/TB pages render the balanced production ledger. A 2026-07-27 corpus reconciliation found 660 source expense rows and 19 source sales not represented in production; the 698-row review batch remains entirely unreviewed/hold. Therefore the ledger is internally sound but its source coverage is **partial**, not complete. On top: the «الرؤى» 7-chapter insight arc (#868), a palm-tree-sales revenue reclass (#869/#870, applied), and an **accounting-kernel correctness pass** (#871, applied `20260708100000`): revenue posts on the sale's economic date, a reversed sale can't be collected, trial balance is posted-only. **Still gating full real-data operation: Stage 0 security (#362), owner/accountant reconciliation decisions, and a corrected palm-registry source.**

## Where we are (honest stage status)

| Stage | Status | Evidence / blocker |
|---|---|---|
| 0 Security remediation | ~75% | App-side demo credential removed; npm audit is 0; leaked-password protection is enabled; all 12 synthetic identities are gone; and PR #1002 removed the last 2 anonymous SECURITY DEFINER helper grants. #362 remains open only for three external historical-source controls: legacy project keys, old-repository history, and workbook/Google credential cleanup. Their sources are not identified, so cleanup is **UNVERIFIED**, not complete. |
| 1 SaaS foundation (RLS/RBAC/audit) | ✅ Done | 58/58 tenant tables FORCE RLS; `authorize()` **19-perm** union pinned by tests/97 (added `site.write` 2026-07-03; S-10 reused existing `budget.write`). |
| 2 Farm structure + registry | 90% code / **0% verified real data** | Production palms are synthetic. The source oracle proves 4,638 Barhi rows vs stated 4,539, plus 370 male and structural/2021 numbering conflicts. Neither source is approved; no import payload is emitted. |
| 3 Activity/event model | ✅ ~95% | Event spine + rollups + connected work graph (#582). |
| 4 Planning workspace | ✅ ~97% | Templates #552, relative scheduling #572, assignees, 16-arg multi RPC, assigned-work dashboard queue + linked 360 plan/task views (#673), and DB/RPC positive plan-requirement backstop live (#848 / prod `20260706180856`). |
| 5 Inventory + coverage engine | ✅ ~95% | Masked-shortage-free (independent review 2026-07-01). Open: #199/#526 reservation semantics (safe over-order direction). |
| 6 Budget + approvals | 70% | PR workflow live; **budget gate is display-only** (#157) — approval never reads budget_lines. |
| 7 Accounting | ~99.5% / workflow complete, operating acceptance pending | Full workflow is live; the pinned 698-row batch is staged untouched and its read-only triage filters are live (PRs #925/#927). Remaining for dependable daily-use acceptance: owner/accountant row decisions, dual-run, exception resolution, and signed acceptance. |
| 8 People/payroll | 50% | Onboarding/attendance/labor live; payroll gated on wage model #388. |
| 9 Weather | 70% | Gates + thresholds live; forecast service NOT configured in prod. |
| 10 Care Academy | 20% | #366 draft; gated on agronomist + pesticide-registration sign-off (no agronomist engaged). |
| 11 AI عبدالجليل | 5% | Policy lib only. Correctly last. |
| M Real-data migration | ◐ Finance loaded / reconciliation pending / registry blocked | The 2019-2026 GL is balanced and live, but 660 source expenses and 19 source sales remain unmatched in the held 698-row review batch. Palm registry remains blocked on a corrected source or field count; Stage 0 security and COA sign-off also remain open. |

**2026-07-27 full corpus and report audit:** 2,221 source paths are indexed in the Farm Records Knowledge System (1,249 unique hashes; extraction/OCR 95.28%). Production reports were authenticated-smoked across 56 report/insight routes and loaded without application errors. Data adequacy is not equivalent to route health: palms, offshoots, budgets, payroll, inventory history, and operations history remain synthetic, absent, blocked, or partial. See `data coverage audit 2026 07 27.md`.
| P Production deploy controls | ⚠️ Bypassed | Prod deploys continuously without Stage-P controls (no staging, no monitoring, no rollback drill) — see review R-items. |
| W Public website (`/`) | ✅ **COMPLETE + LIVE** | ebeidfarm.business — bilingual AR/EN export site: hero, KPIs, **real** GlobalGAP/GACC/QCAP/CAPQ proofs, specs, contact, **editable photo gallery** (in-OS upload → `site-media` bucket), **buyer enquiry form → OS** (`/enquiries`, owner-only), logo/favicon/PWA icons, SEO/OG/JSON-LD/sitemap. The public production-block/farm-areas table was removed in PR #996; its records remain owner-managed in Farm OS. All content editable in-OS at **`/website`** (`site.write`=owner). Migrations `20260701420000` (content) + `20260701430000` (enquiries) applied. **Buyer enquiry inbox** with owner read/archive management (`fn_set_enquiry_status`, migration `20260701450000`). Unit-tested + security-reviewed. PRs #636/#638–#642/#637/#645/#647/#650/#653/#656/#664/#996. Follow-up: real farm photos. |
| UX Design system (`@amrebeid/ui`) | ✅ **REVAMPED + speed pass LIVE** | Stitch-directed token refresh of the whole OS — softer radii + refined layered shadows + cleaner surface (#665), primary-button depth + modern soft focus ring (#666), table zebra striping (#668), KPI bigger value + delta pill chips (#669). Owner dashboard redesign (#679), app-shell lazy-load speed pass (#681: authenticated layout chunk ~59 KB → ~14 KB), and inventory row coverage bar (#682) are live. Token-purity-clean; propagates to every screen via the two-tier tokens. |

## Top next actions (in order)

1. **Accounting acceptance:** use the live classification/state filters to review the staged 698-row batch, resolve exceptions, run dual-run totals and samples, then obtain signed accountant acceptance. Do not call Stage 7 100% before this evidence exists.
2. **Owner+accountant meeting**: ETA e-invoicing determination (obligation **plausible-not-proven** — the "EGP 250k threshold / deadline passed" claim is DISPUTED after cross-verification; see `MARKET-DELTA-2026-07-02.md` §1) + review/refine live COA, cost centers, reports, owner insights, offshoot valuation, accountant dashboard/custody signals, custody transfer, custody reports, revenue/A-R backend, and revenue/A-R reports (#654/#661/#659/#667/#670/#663/#672/#673/#674/#675/#676/#677) + ETA memo (#578).
3. **Owner: close Stage 0** (#362) — one afternoon; unlocks the remaining real-data path.
4. **Owner decisions (cheap)**: wage model #388 · #157 budget-cap (4 one-line answers) · #199/#526 reservation semantics (one line).
5. **Build now:** remaining real-data runway. Close/period lock, trusted balance sheet, trusted P&L, budget-vs-actual, custody/revenue reports, custody report print/PDF polish, finance statement print/PDF polish, balance-sheet server PDF download, combined statement package PDF, payment-request proof packet, and report output coverage are live; **after 3 and source correction:** real palm-registry dry-run via SPEC-0020 → independent review → Owner-gated import → #157 real budget gate.
7. **Money-integrity — ✅ DONE.** `fn_reverse_journal_entry` (#793), `audit_read` completeness pin (#792, test 131), custody cash-out balance floor + journal-completeness guards (#791), and the accounting-kernel correctness pass (#871: revenue-on-sale-date, reversed-sale collection block, posted-only trial balance) are all shipped/applied. Optional LOW hardening left (defense-in-depth, not correctness): custody `movement_type` CHECK + a journal-linkage constraint trigger; an auto-discovering audit-entity guard.
8. **Page-speed follow-up if still slow:** consolidate owner/dashboard multi-query loaders into read RPCs, keep heavy search/help/chart tools async, and add route-specific skeletons for the slowest finance/farm pages after live timing feedback.
9. **Field-readiness follow-ups**: field/DevTools smoke-test the shipped ExecuteForm offline outbox (#625), add PWA brand icons when the real logo asset exists, choose the signed-URL-safe image path for MediaGallery, and batch the deferred DS rebuild. Already shipped: OperationBuilder fabricated-zero fix (#607), DB/RPC positive plan-requirement backstop (repo `20260706175357`, prod `20260706180856`), shared retry/finally submit handling across the 8 forms (#608), bounded `/m` feed (#610), storekeeper `/m/receive` (#614), field-level errors (#613/#627), and decimal mobile keyboards (#611). Full list: `REVIEW-360-2026-07-01.md` §Frontend.

## Feature freeze

Until Stage M lands and the farm runs one real week on real data: **no new modules, no new plan-op columns/params, no new research-lane builds.** New ideas go to `PRODUCT-IDEAS-BACKLOG-2026-07.md`, not to code.

*Exception (2026-07-03, Owner-directed):* the **public marketing website + its OS-editable content model** shipped — it's the front door / brand surface for buyers, not a farm-data module (no plan-op/registry/finance surface). Deliberate, logged, not scope creep.

## Owner decision queue (ranked; hub = issue #505 + OWNER-DECISIONS.md)

| # | Decision | Gates | Cost to decide |
|---|---|---|---|
| 1 | ETA obligation (accountant) | Slice C / legal exposure | 1 meeting |
| 2 | Live chart-of-accounts refinement/sign-off (#654/#661) | All real finance | same meeting |
| 3 | Stage-0 residuals (#362) | All real data | 1 afternoon |
| 4 | Wage model (#388) | Payroll + labor cost | 1 paragraph |
| 5 | Budget-cap policy (#157) | Real budget gate | 4 one-liners |
| 6 | Registry-import authorization | Stage 2 real data | 1 approval (post-#362) |
| 7 | Reservation semantics (#199/#526) | Engine cleanup (safe today) | 1 line |
| 8 | Finance statement/proof package review | Server-generated PDF package and accountant proof workflow | 1 review |
| 9 | Agronomist engagement (start the search) | Stage 10 + dose sign-offs | external lead time |

## Strategy anchors (post-research, 2026-07-02)

- **Wedge (restated):** coverage-vs-plan forecasting **+ budget-gated approvals + Egypt statutory depth**, Arabic-first at tree level. (Not "only Arabic tree registry" — Mazoon Soft exists; see MARKET-DELTA.)
- **Season 1 build theme (with real data):** the **season-cycle engine** (SPEC-0021) + **WhatsApp field layer** (SPEC-0022) + pollination module + per-tree economics.
- **Partner, don't build:** ETA submission (Daftra/Wafeq), carbon MRV (Zr3i data export), input financing (AgriCash/Mozare3).
- **Operations lane (2026-07-02 focused 360 — ops daily-use grade C−):** `OPS-PLAN-2026-07.md` — Lane 0 unblockers (hawsha scope picker, reschedule/cancel, duplicate-op, dedup fix, backdating, week grid, template CRUD+prod seed) can run in parallel with the Stage-M track; the per-palm task ledger + QR-badge crew model + auto spray records are the Season-1 leapfrog. First console shipped: `/purchase-requests` open-orders view with the engine-mirrored stale-PO badge (#594).
- **Store/finance lanes (2026-07-02 wave-3):** `SPEC-0023-stock-take-jard.md` (the anti-leakage keystone — buildable now) + `INVENTORY-360-2026-07-02.md` (storekeeper D+/buyer C−/owner D) + `FINANCE-ACCOUNTANT-360-2026-07-02.md` (workday improving — account-classified requests, cost centers, custody transfer/reporting, revenue/A-R reports, close/period lock, trusted statements, budget-vs-actual, payment-request proof packet, custody report print/PDF polish, finance statement print/PDF polish, balance-sheet server PDF download, combined statement package PDF, and owner insight output coverage are live; remaining finance lane = Excel dual-run and historical reconciliation).
- **Wrapper (2026-07-02):** hardening runbook (`RUNBOOK-ops-hardening-2026-07.md` — restore drill BEFORE Stage-M) · onboarding playbook (`ONBOARDING-PLAYBOOK-farm2-2026-07.md`) · support/billing (`SUPPORT-AND-BILLING-MODEL-2026-07.md`) · usability kit (`USABILITY-WATCH-KIT-2026-07.md` — run before Lane 1) · naming (`BRAND-NAMING-2026-07.md` — غلة/Ghalla recommended, TM search first) · **legal (`LEGAL-WRAPPER-2026-07.md` — 🔴 PDPL grace ends ~1 Nov 2026; lawyer review + do-now list)**.
- **Intercropping (Owner fact, #595):** different seasonal crops (incl. بنجر) between palms in some hawshat — `hawsha_crops` (with season dimension) rides the Stage-M import; shared costs shown as «مشترك» until D2; beet harvest vs pollination labor contention noted for SPEC-0021.

## Pointers

Plan/governance: `MASTER-PLAN.md` (historical §4 status superseded by the table above) · review: `REVIEW-360-2026-07-01.md` · ops: `OPS-PLAN-2026-07.md` + `OPS-360-REVIEW-2026-07-02.md` · store: `SPEC-0023-stock-take-jard.md` + `INVENTORY-360-2026-07-02.md` · finance: `FINANCE-ACCOUNTANT-360-2026-07-02.md` · strategy: `BOOM-PLAN-2026-07.md` · research delta: `MARKET-DELTA-2026-07-02.md` · ideas: `PRODUCT-IDEAS-BACKLOG-2026-07.md` · wrapper: `RUNBOOK-ops-hardening-2026-07.md` / `ONBOARDING-PLAYBOOK-farm2-2026-07.md` / `SUPPORT-AND-BILLING-MODEL-2026-07.md` / `USABILITY-WATCH-KIT-2026-07.md` / `BRAND-NAMING-2026-07.md` / `LEGAL-WRAPPER-2026-07.md` · deploy state: `DEPLOY-STATUS.md` · archive log: `PROJECT-TRACKER.md` / `SESSION-BRIEF.md`.
