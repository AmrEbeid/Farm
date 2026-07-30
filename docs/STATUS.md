# STATUS — Farm OS single source of truth
*The ONLY doc that claims currency. Everything else (TRACKER, SESSION-BRIEF) is an append-only archive.*
*Updated: 2026-07-30 (transaction-ledger exact counts released). Owner: Amr Ebeid.*

**Rule:** update this file whenever repo/prod state changes materially; keep it under ~100 lines. If this file and any other doc disagree, this file wins — then fix the other doc.

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
| 0 Security remediation | ~50% | #362 open: legacy repo history, spreadsheet creds, leaked-password toggle, demo-cred plan. **Gates all real data.** |
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
| W Public website (`/`) | ✅ **COMPLETE + LIVE** | ebeidfarm.business — bilingual AR/EN export site: hero, KPIs, blocks, **real** GlobalGAP/GACC/QCAP/CAPQ proofs, specs, contact, **editable photo gallery** (in-OS upload → `site-media` bucket), **buyer enquiry form → OS** (`/enquiries`, owner-only), logo/favicon/PWA icons, SEO/OG/JSON-LD/sitemap. All content editable in-OS at **`/website`** (`site.write`=owner). Migrations `20260701420000` (content) + `20260701430000` (enquiries) applied. **Buyer enquiry inbox** with owner read/archive management (`fn_set_enquiry_status`, migration `20260701450000`). Unit-tested + security-reviewed. PRs #636/#638–#642/#637/#645/#647/#650/#653/#656/#664. Follow-up: real farm photos. |
| UX Design system (`@amrebeid/ui`) | ✅ **REVAMPED + speed pass LIVE** | Stitch-directed token refresh of the whole OS — softer radii + refined layered shadows + cleaner surface (#665), primary-button depth + modern soft focus ring (#666), table zebra striping (#668), KPI bigger value + delta pill chips (#669). Owner dashboard redesign (#679), app-shell lazy-load speed pass (#681: authenticated layout chunk ~59 KB → ~14 KB), and inventory row coverage bar (#682) are live. Token-purity-clean; propagates to every screen via the two-tier tokens. |

## Top next actions (in order)

1. **Accounting acceptance:** use the live classification/state filters to review the staged 698-row batch, resolve exceptions, run dual-run totals and samples, then obtain signed accountant acceptance. Do not call Stage 7 100% before this evidence exists.
2. **Owner+accountant meeting**: ETA e-invoicing determination (obligation **plausible-not-proven** — the "EGP 250k threshold / deadline passed" claim is DISPUTED after cross-verification; see `MARKET-DELTA-2026-07-02.md` §1) + review/refine live COA, cost centers, reports, owner insights, offshoot valuation, accountant dashboard/custody signals, custody transfer, custody reports, revenue/A-R backend, and revenue/A-R reports (#654/#661/#659/#667/#670/#663/#672/#673/#674/#675/#676/#677) + ETA memo (#578).
3. **Owner: close Stage 0** (#362) — one afternoon; unlocks the remaining real-data path.
4. **Owner: 1-click** leaked-password Auth toggle (#229 iii).
5. **Owner decisions (cheap)**: wage model #388 · #157 budget-cap (4 one-line answers) · #199/#526 reservation semantics (one line).
6. **Build now:** remaining real-data runway. Close/period lock, trusted balance sheet, trusted P&L, budget-vs-actual, custody/revenue reports, custody report print/PDF polish, finance statement print/PDF polish, balance-sheet server PDF download, combined statement package PDF, payment-request proof packet, and report output coverage are live; **after 3 and source correction:** real palm-registry dry-run via SPEC-0020 → independent review → Owner-gated import → #157 real budget gate.
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
