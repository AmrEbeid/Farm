# Project Tracker — Farm OS      Last updated: 2026-07-01 by Claude (autonomous session, for Owner: Amr Ebeid)

> **2026-07-01 — DRAFT branch built: standalone cash-method accounting + custody settlement (`feat/accounting-custody-standalone`).**
> Responding to the Owner's updated custody workflow, this branch adds the first standalone accounting kernel tied to
> custody/payment requests: `accounts`, `journal_entries`, `journal_lines`, `payment_request_fundings`, settlement
> fields on request lines, standing owner-custody funding journals, owner-funding-as-custody RPC,
> payout-confirmation RPC, close-request RPC, `/accounting`, and a settlement tab on `/custody/request/[requestId]`.
> Market scan recorded in
> [`accounting standalone market research.md`](accounting%20standalone%20market%20research.md). Validation is green:
> pgTAP **894/894**, app Vitest **251/251**, ESLint, production build, and `git diff --check`. **Not merged, not
> pushed, not prod-applied.** Because this is money/RLS logic, next gate is independent review before any merge or
> migration, then explicit Owner approval for prod apply.

> **2026-07-01 — AUTONOMOUS SESSION COMPLETE: 26 PRs merged, 10 prod migrations, all green on `main` (`b05811e`).**
> Owner-directed continuous autonomous work with self-merge/self-migrate authority (this session only), holding the
> integrity rails (no fabricated data, no secrets, CI-green-before-merge, migrate-first, verify-agent-findings).
> **Adversarially audited every real-code subsystem** and fixed every decision-free defect. Headline: **#509 fixed a
> real reproduced ENGINE masked shortage** (fn_stock_coverage dropped in_progress op demand — the cardinal sin the
> #239 oracle had missed; define-check-first, verbatim-safe re-emit). Also shipped: security/audit (anon-DML #485,
> org-settings/plan/event audit #492/#495/#497), perf (#486), finance drawings-vs-opex #501 + CSV Excel-SUM
> #502/#507 + custody backstop #508, payment claim-first #511, a11y table-names + colour-status #489/#490/#491/#499,
> ImportPanel #487, bulk-import hardening #514/#515, structure CRUD integrity #517. **Verified SAFE (no fix
> needed):** multi-tenant isolation, money pipeline, write-path concurrency, append-only integrity, the canonical
> palm registry (4,380/299/28), bundle hygiene. **Owner decisions pending** (see #505 hub): reservation-model
> redesign (#512 masked shortage, pinned by tests/105 + #199), unit-model (#216, masks both sides), pricing
> (#157/#89), wage (#388), expert gates (#366/#368), leaked-password Auth toggle (#229iii), the 7 #215 + 6 #216
> decisions. **Environment-blocked:** #500 (DS dist can't rebuild — esbuild postinstall disabled). Issue **#505** is
> the single hub for the full shipped list + decision queue.

> **2026-06-30 — AUTONOMOUS SESSION (Owner set "keep working, review→merge→migrate on your recommendation").**
> Repo hygiene: removed 42 stale `" 2"` Finder-duplicate files from the working tree (verified each was identical
> or an older copy of its tracked original; left the 2 inside `.claude/worktrees/`). Then closed the **#317**
> residual: a live prod grant probe showed `anon` still held `INSERT,UPDATE` on `attachments` +
> `plan_operation_assignees` (the `20260629135038` grant-hygiene migration had swept only TRUNCATE/DELETE).
> Authored migration `20260630090000` (idempotent anon INSERT/UPDATE revoke) + an anon-no-DML invariant in
> `tests/97`; local pgTAP **826/826**; **applied to Farm prod migrate-first** (ledger `20260630090000`, re-probe
> shows anon DML = none); **PR #485** open, merging on green. Issue board verified: **#188** (orphaned reservation)
> and **#229 (i)+(ii)** (anon-exec RPCs, FK covering indexes) are already resolved on `main`; **#229 (iii)**
> leaked-password is an Owner dashboard toggle; **#199** ENGINE-RESV-1 stays open as an owner-gated engine-semantics
> decision (must not auto-decide — masked-shortage risk). **Cycle 2:** performance-advisor remediation **PR #486**
> — migration `20260630100000` wraps the `pr_update` RLS GUC read as an InitPlan subselect (`auth_rls_initplan`
> WARN) and re-runs the `0096` catalog FK-covering sweep (covered `plan_operation_assignees.org_id` +
> `residue_test_results.org_id`); local pgTAP 826/826, applied to prod migrate-first (0 uncovered FKs). The ~80
> `unused_index` INFO findings were deliberately left (pilot DB).

> **2026-06-30 — SAFE STOP at Owner request; #215 control-panel research paused; repo green.** Local `main`
> is at `e567115` (`docs: record unknown cost display fix`) and GitHub `ci`, `db-tests`, and `release` are green
> for that head. No migration, prod apply, production data change, or draft PR merge was performed after #484.
> Open PR queue remains draft/held only: **#368** accounting and **#366** academy. Started the safe research lane
> for **#215** ("Control Panel — self-serve setup / config-as-data"): reviewed the issue, existing market research,
> `SPEC-0012`, `SPEC-0013`, current `/settings` + `/settings/dashboard`, and `fn_update_org_settings`. Current
> finding: Farm OS has owner-only org settings and a settings dashboard, but the broader self-serve control panel
> remains unbuilt and should stay scoped as a docs/spec lane first. Resume by completing current-source research
> and updating #215 / `SPEC-0013` with a narrow plan that separates tenant setup config from platform support/admin
> controls, keeps role/permission edits review-gated, audits every config change, and keeps real-data import behind
> Stage M privacy review.

> **2026-06-30 — follow-up financial display honesty merged via #484; migration N/A.** Reviewed and merged app-only
> #484 after #483: remaining tracked UI/report paths that displayed unknown planned/estimated costs as `0 ج.م` now
> use nullable money helpers. Plan detail, planning dashboard, manager/mobile operation lists, purchase-request
> detail, and PVA report show unknown cost as unknown; PVA suppresses the cost-variance chart when planned costs are
> incomplete instead of plotting fabricated zero planned values. No `supabase/` files changed, so migration/prod DB
> apply is N/A. #484 PR checks were green and post-merge `main` at `d603b1f` has **ci**, **db-tests**, and
> **release** green. #89/#157 remain open for the real Stage-7 pricing source, maintained budget ledger, and hard
> budget enforcement. Current open queue remains draft-only: **#368/#366**.

> **2026-06-30 — 360 runtime tab fix + budget unknown-cost advisory fix merged; migration N/A.**
> Reconciled the concurrent post-Entity-360 fixes now on `main`: **#481** fixed a live RSC runtime failure where
> tabbed 360 Server Components were importing/calling client-only `tabId`/`tabPanelId` helpers, causing the segment
> error boundary on tabbed detail pages; it added server-safe `apps/farm-os/lib/tab-ids.ts` and switched the tabbed
> 360 pages to it. **#482** added the CI guard `check-client-fn-in-server.mjs` so this client-helper/server-call
> class is caught before merge. **#483** fixed the #157/#89 sub-gap where planned fertilization operations with
> unknown `est_cost` were treated as zero in advisory budget checks; unknown cost now records/renders warn plus
> owner/accountant review rather than a false green, while full budget enforcement and real pricing remain Stage-7-gated.
> No `supabase/` files changed in #481/#482/#483, so migration/prod DB apply is N/A. Post-merge `main` at
> `2e91a04` has **ci**, **db-tests**, and **release** green. Current open queue remains draft-only: **#368/#366**.

> **2026-06-30 — Entity-360 detail-page rollout completed via #479/#480; migration N/A.** Reviewed the
> post-#400 UI-only 360 lanes. #479 applied the entity header/tabs pattern to farm structure, budget, expense,
> custody request, and palm detail pages; post-merge review found finance tabs still owner/accountant-only,
> custody add-line still draft-gated, structure edit/archive still owner/farm_manager-only, and palm map
> click-through restored through `PalmMap`. #480 applied identity headers/status pills to the remaining report/action
> `[id]` pages (`inventory/[itemId]/coverage`, `reports/[planId]/pva`, `m/execute/[opId]`,
> `budget/[planId]/check`) with existing queries, charts, role gates, and action forms preserved. CodeRabbit was
> rate-limited on #480, so the gate was manual; #480 was squash-merged at `818ecba`. No `supabase/` files changed
> in either PR, so migration/prod DB apply is N/A. Post-merge `main` **ci**, **db-tests**, and **release** are green.
> Current open queue is draft-only: **#368/#366**.

> **2026-06-30 — SPEC-0016 export compliance reviewed, prod-applied, and merged via #400.** Rebased
> **#400** onto current `main`, patched `computeExportReadiness()` so incomplete validity evidence fails closed
> (missing GACC valid-from or incomplete seasonal accreditation window cannot pass), and kept the Stage-M privacy
> gate explicit: no real certificate data or PII import. Validation: focused Vitest **11/11**, full local pgTAP
> **825/825**, `git diff --check` clean; #400 remote checks green (app typecheck/lint/test/build, pgTAP/db,
> aggregate typecheck/build/storybook, gitleaks, CodeRabbit, Vercel; Supabase Preview skipped). Pre-migration
> review: remote ledger showed exactly one local-only migration, `20260622000092`; `supabase db push --dry-run
> --include-all` listed exactly `20260622000092_export_compliance.sql`. Applied to Farm prod with
> `supabase db push --include-all --yes`; post-apply ledger records `20260622000092`. #400 was marked ready and
> squash-merged at `55fafbc`; post-merge `main` **ci**, **db-tests**, and **release** are green. Concurrent UI-only
> entity-360 PRs **#477/#478** also merged with green checks; post-merge scan found no obvious gate/action drift.
> **Superseded by the #479/#480 entry above:** Entity-360 rollout is now complete across the remaining detail pages.
> Current open queue is draft-only: **#368/#366**.

> **2026-06-30 — #476 chart numeral pass reviewed and merged; migration N/A.** Reviewed non-draft
> **#476** after SPEC-0018 docs landed. Scope was UI-only: internal `formatChartNumber()` helper in
> `@amrebeid/ui`, Bar/Line/Doughnut chart axis + tooltip + screen-reader table fallback formatting, focused tests,
> and rebuilt committed `dist/` chart artifacts. Supabase Preview was skipped because there were no `supabase/`
> changes; no migration/prod DB action was needed. CodeRabbit did not perform a real review due its rate limit, so
> this was manually reviewed against the PR diff and GitHub checks. #476 was squash-merged at `fdca0e0`; post-merge
> `main` **db-tests** and **release** are green, with `ci` confirming package typecheck/token/test/build/storybook
> and app typecheck/lint/test/build. **Superseded by the #400 entry above:** export compliance is now
> reviewed/applied/merged; current open queue is **#368/#366**.

> **2026-06-30 — SPEC-0018 frontend reviewed, refreshed, merged; custody module live on `main`.** Original draft
> **#441** was stale against current `main` (no merge base; unrelated tree churn), so a clean replacement
> **#474** was rebuilt from current `main` after the #468 backend was live. Review fixes in the clean lane:
> removed unrelated dashboard label drift, kept all custody reads/actions on the user-session Supabase client,
> restricted routes/actions to owner/accountant, added stricter action validation for custody amounts and request
> dates, and wired the missing draft request line picker so `post_paid_unpaid` operating expenses can be added via
> the existing RPC-only path. Validation: local Node 20 Vitest **234/234** and `git diff --check` clean; #474 remote
> checks green (app typecheck/lint/test/build, pgTAP/db, aggregate typecheck/build/storybook, gitleaks, Vercel;
> Supabase Preview skipped). #474 was squash-merged at `2eb6025`; post-merge `main` **ci**, **db-tests**, and
> **release** are green. #441 is closed as superseded. Current `main` also includes dashboard follow-up PRs
> **#471/#472/#473/#475** and the tracked SPEC-0018 implementation spec from **#421**. Current open queue is
> draft-only: **#368/#366** after the later #400 export lane shipped.

> **2026-06-30 — SPEC-0018 backend reviewed, prod-applied, and merged via clean #468.** Original draft
> **#438** was not mergeable against current `main` locally (no merge base; unrelated tree churn), so a clean
> replacement **#468** was rebuilt from current `main` with only the intended custody/payment backend files.
> Review fixes before apply: preserved the #466 `fn_bin_rebuild` internal invariant in
> `22_security_invariants_test`, added SPEC-0018 RPCs to the authenticated allowlist, and hardened the money path so
> expense-linked custody cash out-movements must be routed through `fn_set_expense_payment_status` and equal the
> linked expense total. Validation: local `git diff --check` clean; full local pgTAP **800/800**; #468 remote checks
> green (app CI, pgTAP/db, aggregate typecheck/build/storybook, gitleaks, Vercel; Supabase Preview skipped).
> Pre-migration gate: prod ledger showed all prior migrations through `20260629141650`; dry-run listed exactly
> `20260629150000_custody_and_expense_payment` and `20260629150100_payment_requests`; remote public-schema dump
> showed no existing SPEC-0018 tables/functions/payment-routing columns. Applied both migrations to Farm prod
> `veezkmytervjnpxcrbkw` with `supabase db push --yes`; post-apply ledger recorded both versions. A later no-op
> dry-run attempt failed on the Supabase CLI temporary login role and pooler circuit breaker, so no further DB
> connection attempts were made. #468 was squash-merged at `27065f1`, and post-merge `main` CI, db-tests, and release
> are green. #438 is closed as superseded. Current `main` also includes concurrent dashboard PRs **#467/#469**.
> **Superseded by the #474 entry above:** SPEC-0018 frontend is now refreshed/reviewed/merged; #441 is closed.

> **2026-06-30 — repo/prod migration alignment merged; superseded DB drafts closed.** After the prod hardening
> apply, `main` was missing the four repo-versioned migration files that were already in the Farm prod ledger. Opened
> **#466** from current `main` to add the exact applied migrations and pgTAP coverage:
> `20260622000098_fn_bin_rebuild_internal`, `20260629135038_grant_hygiene_default_privileges`,
> `20260629140248_inventory_transfer_ordered_guard`, and
> `20260629141650_responsibility_assignments_write_gate`. Local pgTAP on the branch passed **726/726**; #466 CI was
> green (app, pgTAP/db, aggregate typecheck/build/storybook, gitleaks, Vercel), then #466 was squash-merged to
> `main` at `55a38d6`. Post-merge `main` CI, db-tests, and release are green. Closed superseded draft PRs
> **#436/#439/#442/#444** with trace comments and left their branches intact. Closed resolved audit issues
> **#430**, **#431**, and **#314** with evidence. **#317/#229 remain open** for the platform-owned
> `supabase_admin` default table ACL residual and leaked-password-protection/Auth dashboard verification. During
> this window, upstream **#464** and **#465** also merged before #466; their changes are now part of current `main`
> and were covered by the post-merge CI. **Superseded by the #468/#474 entries above:** SPEC-0018 backend and
> frontend are now reviewed/applied-or-merged as appropriate.

> **2026-06-30 — reviewed DB hardening bundle applied to Farm prod; draft PRs not merged.** Local `main`
> was current at `origin/main` (`b7a95eb`) before the apply. Reviewed and probed the narrow DB hardening set:
> **#436** `fn_bin_rebuild` internalization, **#439** grant/default-privilege hygiene, **#442** latent inventory
> transfer/ordered guard, and **#444** responsibility-assignment write gate. Prod pre-probes were clean for
> constraint/data risk (`inventory_movements.type='transfer'` = 0, `inventory_bin.ordered <> 0` = 0,
> `plan_material_requirements.qty is null` = 0) and showed the expected grant drift. Patched #439 to
> `ecaeace` after prod showed a `supabase_admin` default-ACL grantor that the migration role cannot administer;
> local pgTAP on #439 passed **689/689** and the exact combined bundle passed **726/726**. Applied with Supabase
> CLI `db push --include-all` after a dry-run showed exactly four repo-versioned migrations:
> `20260622000098_fn_bin_rebuild_internal`, `20260629135038_grant_hygiene_default_privileges`,
> `20260629140248_inventory_transfer_ordered_guard`, and
> `20260629141650_responsibility_assignments_write_gate`. Post-apply verification: prod migration ledger now
> includes all four repo versions; `authenticated`/`anon` cannot execute `fn_bin_rebuild`, `fn_post_movement`,
> `fn_set_active_org`, or `fn_update_org_settings` outside the intended grants; no public table grants
> `TRUNCATE` to client roles and no public table grants client `DELETE` except authenticated `plan_checks`;
> inventory guard constraints exist as `NOT VALID`; `fn_post_movement` no longer accepts `transfer`; and
> `responsibility_assignments.tenant_all` has `responsibility.write` plus the same-org person guard. **Residual:**
> platform-owned `supabase_admin` table default ACL still grants future table privileges to client roles and needs
> a Supabase/platform-owner remediation path; current-table grants and the `postgres` default ACL are fixed.
> No draft PR merge was performed. #438 custody/payment, #400 export, #368 accounting, and #366 academy remain
> held for their separate review/migration gates.

> **2026-06-30 — SPEC-0018 audit/authz follow-up; #438/#400/#444/#436 patched, #462 reviewed post-merge.** Local `main`
> was fast-forwarded to `origin/main` (`5db895b`) before this docs update. Reviewed draft backend **#438** and found
> a cross-PR `audit_read` regression: the payment-request migration preserved payroll and custody/payment audit
> gates but would drop #368's `sale/expense -> budget.write` audit restrictions if both migration sets were applied.
> Patched #438 remotely at `eccc76e` so `audit_log.audit_read` preserves the full confidentiality union
> (`people_compensation -> payroll.read`, `sale/expense -> budget.write`, custody/payment entities ->
> `finance.read`) and added pgTAP coverage for restricted audit mirrors. Local pgTAP passed **757/757**; GitHub
> checks are green. Also patched the known stale older `authorize()` re-emits: **#400** at `8c1973c` and **#444**
> at `304ba09`, with tests now pinning SPEC-0018 owner/accountant custody/request semantics. Local pgTAP passed
> **681/681** on #400 and **707/707** on #444; both GitHub check sets are green. Refreshed **#436** onto current
> `main` without force-pushing at `cb8df8e`; the PR diff is now the three DB files only, no app caller uses direct
> `rpc("fn_bin_rebuild")`, local pgTAP passed **687/687**, and GitHub checks are green. All four PRs remain
> draft/held. New **#462** was found already merged by another actor while review was in progress; post-merge review
> found no code findings and local pgTAP passed **688/688**. No merge, migration, prod apply, deploy, or production
> data change was performed from this session. Remaining gates: final pre-migration review is still required before
> any custody/payment apply; any later/older `authorize()` re-emit must carry the same final union before applying
> after #438; and before applying #462's `0099`, run the prod NULL-row probe on
> `plan_material_requirements.qty`. Next recommended lane: pre-migration review/probe pass for #439/#442, then an
> ordered migration-bundle plan only after all required read-only probes are clean.

> **2026-06-29 — SAFE STOP: current project status, remaining work, and timeline.** Local `main` was
> fast-forwarded to current `origin/main` (`ab6def2`) before stopping. Production Supabase remains at migration
> `0096`; no migration, prod apply, draft-PR merge, or production data change was performed in this stop/report
> pass. Current estimate: live MVP/pilot operating core is **~90-92% done**; pre-real-data pilot readiness is
> **~80-85% done**; full commercial product vision is **~55-60% done**; finance/accounting maturity is
> **~35-45% done**; advanced payroll/academy/AI stages are **~20-35% done**. Live strengths: core RLS/RPC
> foundation, inventory/PR/receipt/coverage loop, farm structure/files, planning/operations, budgets/expenses,
> people/weather/settings, module dashboards, CSV/MasterTable/import framework, and Help Drawer/docs health.
> Remaining critical path: (1) review/order/apply held DB hardening drafts #436/#439/#442/#444; (2) finish SPEC-0018
> custody backend #438 and dependent frontend #441 after independent money/RLS/audit review; (3) resolve
> accounting/P&L #368 with real Excel reconciliation + privacy review; (4) close product correctness gaps #157,
> #89, #188/#199; (5) Stage 0 residual cleanup/leaked-password-protection verification; (6) payroll, academy,
> AI, and Stage-M real-data migration. Timeline, assuming active Owner review and no external-signoff delay:
> **1-2 days** for small DB hardening reviews/apply planning, **3-5 days** to unblock a safe custody first slice,
> **1-2 weeks** for finance/accounting foundation after ratification/reconciliation path, **2-4 weeks** for
> real-data readiness, and **4-8 weeks** for broader commercial maturity. All open PRs are currently draft/held;
> no merge-ready PR lane should be treated as approved without a fresh review + pre-migration gate. Current open
> PR queue is all draft/held: clean #444, #442, #441, #439, #438, #421, #400; dirty/stale #436, #368, #366.
> Recent held reviews are recorded on #438/#444/#442/#439; their pre-migration caveats remain active. Recommended
> next resume lane: refresh/review dirty #436 (`fn_bin_rebuild` internal) before any migration bundle planning.

> **2026-06-29 — #439 grant/default-privilege review posted; still held.** Reviewed draft PR **#439**
> at `e2ca96f`: it removes client-role `TRUNCATE`/broad `DELETE` on current public tables, preserves only
> authenticated `plan_checks` DELETE, and revokes future public-table defaults to `anon`/`authenticated` for the
> prod-observed `postgres` grantor. Local validation repeated: `git diff --check` clean; full pgTAP **689/689**.
> No local code findings. **Held:** no merge, prod migration, or production data change until pre-migration review.
> Before apply, run a read-only prod `pg_default_acl` probe; if any grantor besides `postgres` grants future table
> privileges to client roles, add matching `ALTER DEFAULT PRIVILEGES FOR ROLE <grantor>` revokes first.

> **2026-06-29 — #442 inventory transfer/ordered guard reviewed; still held.** Reviewed draft PR **#442**
> at `9b9cac3`: it blocks new `transfer` ledger rows at the RPC and table-constraint layers, pins
> `inventory_bin.ordered = 0`, and preserves `fn_post_movement` internal-only EXECUTE posture. Local validation
> repeated: `git diff --check` clean; full pgTAP **691/691**. No local code findings. **Held:** no merge,
> prod migration, or production data change until pre-migration review. Before apply, run read-only prod probes
> for existing `inventory_movements.type = 'transfer'` and `inventory_bin.ordered <> 0`; `NOT VALID` avoids the
> initial validation scan but future updates to nonconforming rows still obey the constraints.

> **2026-06-29 — #444 responsibility-write gate reviewed; still held.** Reviewed draft PR **#444** at
> `67146ea`: the migration narrows `responsibility_assignments` writes to `responsibility.write`
> (owner/farm_manager) while preserving org-member reads and the #306 same-org `people` guard. Local validation
> repeated: `git diff --check` clean; full pgTAP **697/697**. No local code findings. **Held:** no merge,
> prod migration, or production data change until pre-migration review. Apply-order caveat: if batched with
> #438, apply #444's `20260629141650` before #438's later timestamped custody migrations; if #444 ever applies
> after #438, it must first preserve #438's final `authorize()` permission union.

> **2026-06-29 — #438 custody backend reroute guard pushed; still held.** Follow-up patch on draft
> backend PR **#438** at `1288a23` prevents a custody-paid expense from being silently rerouted to another
> `payment_status` after a cash out-movement exists; operators must post an explicit reversal before rerouting.
> The same patch corrected stale migration comments. Local validation: `git diff --check` clean; full pgTAP
> **736/736**. **Held:** no merge, prod migration, or production data change until independent money/RLS/audit
> review and a separate pre-migration review. #441 remains the dependent frontend slice and still waits behind
> the #438 migrate-first path.

> **2026-06-29 — #441 custody frontend aligned with hardened #438; still held.** Patched draft frontend PR
> **#441** at `fa17350`: custody account creation now uses `fn_save_custody_account`, custody dashboard/detail
> routes are owner/accountant-only until an owner-ratified farm-manager finance-read scope exists, query/RPC failures
> now throw to the route error boundary instead of rendering fabricated zero/empty financial totals, and the lifecycle
> UI no longer advertises farm-manager custody actions while broad finance read is withheld. Local validation:
> focused nav/page-help **17/17**, full Vitest **230/230**, `tsc --noEmit`, touched-file ESLint, production build,
> and `git diff --check` all passed. **Held:** no merge until #438 is independently reviewed, prod-applied
> migrate-first, and merged; no migration, prod apply, or production data change was performed.

> **2026-06-29 — #438 custody backend hardened; still held for independent review and migration gate.** Patched
> draft backend PR **#438** at `8fb7f69`, then follow-up `1288a23`: renamed its collided `0098`/`0099` draft
> migrations to timestamped
> migrations, added `finance.read` plus preserved `responsibility.write` in the `authorize()` re-emit, restored
> RPC-only custody account writes with `fn_save_custody_account`, finance-gated custody/payment table reads and
> read RPCs to owner/accountant, mirrored those gates onto `audit_log.audit_read`, carried the `expenses.kind`
> drawing split in this apply path, excluded/rejected non-operating expenses from payment-request math, and rejects
> rerouting a custody-paid expense without an explicit reversal. Local validation: `git diff --check` clean; full
> pgTAP **736/736**. **Held:** no merge, prod migration, or production
> data change until independent money/RLS/audit review and pre-migration review. **Downstream:** #441 is now patched
> to align with the new RPC/read contract, but remains held behind the #438 migrate-first path.

> **2026-06-29 — #441 custody frontend reviewed; CI drift fix pushed; still held behind #438.** Reviewed draft
> frontend PR **#441** for the SPEC-0018 custody/payment UI. Pushed a narrow fix (`e08562f`) adding route-specific
> help for `/custody/request/[requestId]`, which restored local page-help coverage (**7/7**) and full app tests
> (**230/230**). A later #441 patch (`fa17350`, see top entry) aligned the frontend with #438's RPC-only and
> finance-read contract. **Held:** no merge until #438 is reviewed, applied migrate-first, and merged.

> **2026-06-29 — #314 responsibility-assignment write gate drafted; held for migration gate.** Draft PR
> **#444** adds `responsibility.write` to `authorize(perm, org)` for owner/farm_manager and re-emits
> `responsibility_assignments` RLS so org-member reads remain broad while direct REST insert/update requires the
> new permission. The migration preserves the same-org `people` guard from #306. Local pgTAP passed **697/697** and
> the issue handoff was posted; a later review pass found no local code findings and made the #438 apply-order
> caveat explicit. **Held:** no merge, migration, prod apply, or production data change until separate
> pre-migration review. Migration-order warning: in-flight draft migrations **#366/#400/#438** re-emit
> `authorize()` and must preserve `responsibility.write` if they are rebased/applied after #444.

> **2026-06-29 — #431 inventory transfer/ordered guard drafted; held for migration gate.** Drafted a defensive
> migration for the latent inventory cleanup: new `transfer` movements are rejected until an atomic destination-bin
> model exists, and `inventory_bin.ordered` is pinned at zero until a real purchase-order writer owns it. Re-emitted
> `fn_post_movement` without re-opening authenticated EXECUTE, preserving the internal-only AUTHZ-3 posture. Added
> pgTAP coverage for transfer rejection, direct table constraint protection, `ordered=0`, and projected semantics.
> Local pgTAP passed **691/691**; a later review pass found no local code findings and added the required pre-apply
> probe for existing transfer/ordered rows. **Held:** no merge, migration, prod apply, or production data change
> until a separate pre-migration review.

> **2026-06-29 — #439 grant-default drift fix drafted/green/held; #438 custody backend pre-patch review recorded.**
> Draft PR **#439** closes the remaining #317/#229 DB grant hygiene slice: current public tables lose
> client-role `TRUNCATE`, public tables lose client-role `DELETE` except authenticated `plan_checks`, and future
> public tables created by the prod-observed `postgres` grantor no longer inherit table privileges for
> `anon`/`authenticated`. Local pgTAP passed **689/689** and GitHub checks are green; a later review pass found no
> local code findings and added the default-ACL grantor probe requirement. **Held** for a separate pre-migration
> review. Also completed the pre-patch review of draft **#438** and found the blockers later
> addressed by the 2026-06-29 #438 hardening entry at the top of this tracker. No merge, migration, prod apply, or
> production data change.

> **2026-06-29 — module dashboards/360 batch locally committed and merged with current `origin/main`.** Built and
> reviewed the grouped module navigator, dashboard-first module entries, and read-only 360 pages for Inventory,
> Farm, Planning, Finance, People, Weather/Risk, Settings/Admin, Supplier, Budget, Expense, Item, Plan, and PR
> surfaces. Final standards/spec review fixes are included: settings role fallback is Arabic-safe; planning's
> due-operations KPI links to the due queue; Farm Barhi total is no longer a fake filter; Finance separates displayed
> operating expenses from owner drawings using existing expense text until a schema discriminator exists. Owner then
> authorized review/merge/migrate. Local commit `30fdd26` was created, then local `main` was merged with current
> `origin/main` (remote already contains migrations `0090`/`0093`/`0094`/`0095`/`0096` and the import/MasterTable/
> CSV/palm-file work). Merge conflicts were resolved by keeping upstream `PalmFile`/landing/import/export work and
> layering the module-dashboard nav/help/docs changes on top. **Validation after merge:** `npx eslint .` clean;
> `npx tsc --noEmit` clean after installing the merged dependency set; `npx vitest run` **225/225**; `npm run build`
> green with only the existing Next `middleware` deprecation warning; `git diff --check` clean. No new Supabase
> migration was authored by this batch; no direct Supabase migration/prod mutation has been run from this local
> merge. `docs/SPEC-0018-custody-and-payment-requests.md` was later tracked via #421 after the module shipped.
> **Live follow-through:** Owner set goal to keep working until dashboards are live. The batch was merged with two
> additional remote updates, revalidated (`eslint`, `tsc`, Vitest **230/230**, production build), and pushed to
> `origin/main` at `ca24906`. GitHub recorded a successful Vercel **Production** deployment (`5240158021`,
> `farm-gvyv0g2ut-amrabdelglill-7962s-projects.vercel.app`). Live probes on `https://ebeidfarm.business` confirm
> `/farm/dashboard`, `/inventory/dashboard`, `/plans/dashboard`, `/finance/dashboard`, `/people/dashboard`,
> `/weather/dashboard`, and `/settings/dashboard` all match their deployed routes and redirect unauthenticated users
> to `/login`.

> **2026-06-29 — issue hygiene pass: #383 closed; #317/#229/#188 kept open with current evidence.** Verified
> audit issues against `main` and production evidence. Closed **#383** as fixed/applied: PR #402 is merged,
> migration `0095` is present on `main`, its pgTAP coverage exists, and the production migration ledger includes
> `20260622000095 org_switcher_preapply_hardening`. Left **#317** open after a read-only prod grant probe still
> showed broad grant hygiene gaps (`TRUNCATE` on 38 public tables for both anon/authenticated, plus limited
> `DELETE` grants). Left **#229** open as the umbrella for remaining prod-config/advisor cleanup: FK indexes are
> fixed by `0096`, but default-privilege/grant hygiene and leaked-password protection remain. Left **#188** open
> because #396 merged the reserve-aware app-layer dedup fix, but the issue still tracks the migration-gated
> fully atomic PR-line+reserve RPC follow-up. No DDL, migration, or production data change was performed.

> **2026-06-29 — #362 Stage 0 issue corrected; Supabase rotation no longer open.** Retitled and edited
> **#362** so it no longer asks for Farm Supabase DB password + `service_role` key rotation. That checklist item is
> now marked complete per Owner confirmation. #362 remains open only for the remaining Owner/external cleanup:
> legacy Supabase project keys, old repo history, spreadsheet/Google password, leaked-password protection, and demo
> login cleanup before real data.

> **2026-06-29 — stale UI/display audit issues closed; residual split.** Re-checked current `main` and closed
> **#282** and **#206** as resolved/superseded. The high/medium findings they tracked are now fixed: landing KPI
> fabrication removed, palm health/status and `pollination` labels localized, dates/numbers routed through
> `fmtDate`/`num`/`pct`, offline form hangs handled with try/catch/finally, and dead-end role affordances gated.
> Opened narrow residual **#426** for the one remaining LOW data-quality decision: cleared ExecuteForm qty/labor
> fields submit as zero because `Number("") === 0`. No code, DDL, migration, or production data change was performed.

> **2026-06-29 — #426 fixed in #428; explicit zero preserved.** Opened **#428** to close the narrow ExecuteForm
> residual: blank/invalid/negative actual quantity or labor inputs now fail client-side with an Arabic error before
> `fn_execute_operation` is called, so clearing a field no longer silently submits `0`. An explicit typed `0` remains
> valid because zero-material or zero-labor executions may be intentional and need a separate product decision before
> DB semantics change. Local validation in an isolated temp copy: focused Vitest **3/3**, full Vitest **215/215**,
> focused eslint, `tsc --noEmit`, and production build (existing Next/Supabase warning only). No migration or DDL.

> **2026-06-29 — #398 richer-operation design closed as delivered.** Re-checked **#398** against current `main`
> and closed it as delivered by merged **#399** (`02b5da3`). The schema slice is present (`plan_operations.ends_on`,
> `plan_operation_assignees` with RLS/FORCE RLS/audit/cross-org checks), the atomic RPC slice is present
> (`fn_add_plan_operation_multi` for N materials + N labor + N assignees + multi-day), pgTAP coverage is present,
> and `OperationBuilder` now supports repeatable material/labor rows, start/end dates, employee checkboxes, and a
> lead selector. Deploy status says prod includes `0090` and `0093`; no DDL, migration, or production data change
> was run during this closeout.

> **2026-06-29 — #161 consolidated LOW bucket closed after splitting live remainders.** Re-verified **#161**
> against current `main`: L2/L5 are fixed, L1 demo-login cleanup is already tracked in **#362**, L3/L4 were split
> to **#431** (transfer destination semantics + dead `inventory_bin.ordered`), and L6 was split to **#430**
> (`fn_bin_rebuild` authenticated EXECUTE decision). Closed #161 to remove the stale grab-bag while preserving the
> surviving LOW inventory/RPC cleanup issues. No code, DDL, migration, prod apply, or production data change.

> **2026-06-29 — #235 pre-pilot bug-hunt bucket closed; one residual split.** Re-verified **#235** against
> current `main` and closed it because the original high-risk findings are fixed or tracked in focused lanes.
> Created **#433** for the one untracked residual: `approvePurchaseRequest` zero-row failure copy conflates stale
> version/status/authz. Remaining live work stays in focused issues/PRs: **#89** price source, **#157** budget gate,
> **#188/#199** engine/RPC follow-ups, **#229/#317** prod grant/advisor hygiene, and **#314** responsibility
> assignment RBAC. No code, DDL, migration, prod apply, or production data change.

> **2026-06-29 — #433 approval-failure copy implemented; no enforcement change.** Added a small app-layer
> classifier so `approvePurchaseRequest` distinguishes stale version, wrong status, self-approval, missing owner
> permission, and missing/unreadable request after a zero-row approval update. Enforcement remains in RLS/DB
> triggers; this only improves Arabic diagnostic copy. Local validation: focused Vitest **5/5**, full Vitest
> **220/220**, focused eslint, `tsc --noEmit`, and production build (existing Next/Supabase warning only).

> **2026-06-29 — #430 fn_bin_rebuild internalization drafted in #436; held for migration gate.** Draft PR
> **#436** prepares migration `0098` to revoke `authenticated` EXECUTE on `fn_bin_rebuild(uuid,text)`, remove it
> from the authenticated SECURITY DEFINER allowlist, and pin the negative grant in pgTAP. No app/client caller uses
> direct `rpc("fn_bin_rebuild")`; internal `fn_post_movement`/definer callers continue to work. Local pgTAP passed
> **687/687**; GitHub checks on the draft are green. **Held:** no merge, migration, prod apply, or production data
> change until migration review/apply.

> **2026-06-29 — #421 SPEC-0018 custody/payment-request draft reviewed and hardened; later superseded.** Reviewed
> draft **#421** (`docs/spec-0018-custody-payment-requests`) for the finance-control module. Patched the spec to
> remove precise real finance/worker figures, remove non-existent roles, keep custody/payment/receipt reads
> finance-role gated, avoid inventing a broad `expense.write` permission, mark #368 `expenses.kind`/`0088` as a
> prerequisite or same-apply-path dependency, and require an explicit `attachments` extension for expense receipts
> (`entity_type='expense'`, resolver/storage validation, finance-confidential RLS). Branch head `2fa6694`; GitHub
> checks green; focused re-review found no findings. **Later update:** after #468/#474 shipped, #421 was refreshed
> into an implementation spec and merged; no migration or prod apply was attached to the docs PR.

> **2026-06-29 — #368 accounting P&L summary moved DB-side; code blocker closed, gates still open.** Patched
> held draft **#368 accounting** so `/accounting` no longer computes financial totals from capped PostgREST row
> reads. Migration `0088` now includes `fn_accounting_pnl_summary`, a `SECURITY DEFINER` DB aggregate gated by
> `budget.write`; the page uses that RPC for totals and keeps the 200-row queries only for recent-detail previews.
> Added pgTAP coverage for the aggregate, supervisor denial, drawings/capex separation, and category totals; typed
> the RPC and expense-kind action guard. Branch head `0625150`; local validation passed pgTAP **709/709**, `tsc`,
> focused eslint, P&L unit test **5/5**, production build; GitHub checks green. Session reviewer check found no obvious
> blocker, but the durable merge gate still requires a fresh visible final review before merge/migrate. **Still held:** no merge/migration/prod apply; #368 still needs the
> real 7-year Excel reconciliation + privacy review and explicit `0088` gap-fill plus `0097` apply planning.

> **2026-06-29 — #400 export draft wording refreshed; still held.** Updated held draft **#400 export** so the
> SPEC and PR body no longer claim "design only": they now correctly say slice 1 schema/RLS/audit plus pure
> readiness code are implemented on the draft branch, but not merged or applied to prod. Also refreshed the `0092`
> migration comment to say `authorize()` re-emits the final known permission union including #366 `academy.write`.
> Branch head `dbcfeb8`; GitHub checks green; focused independent check found no wording blockers. **Still held:**
> no production action is approved, and #400 needs a fresh pre-migration review of exact apply order before any
> merge/migrate.

> **2026-06-29 — #366 patched to preserve `export.write`; migration-order trap reduced, gates still open.**
> Applied a narrow fix to held draft **#366 academy** so migration `0091` re-emits `public.authorize()` with the
> final known permission union, including `export.write`. Test `89_academy_content_test.sql` now asserts
> `export.write` remains available to owner/farm_manager and unavailable to supervisor. Branch head `86dfa6e`;
> GitHub checks green; focused independent check found no blockers. This means if export `0092` is applied before
> a later `0091` gap-fill, `0091` no longer silently drops export write permission. **Still held:** #366 remains
> draft pending agronomist/pesticide-registration sign-off, and #400 still needs a fresh pre-migration review of
> exact apply order before any merge/migrate.

> **2026-06-29 — low-risk draft-branch fixes applied to #366/#368; both still HELD.** After the draft-lane
> reviews, applied the non-migration follow-ups that reduce future operator confusion without clearing expert gates.
> **#366 academy** now fails visibly if the `academy_content` query errors instead of rendering an empty academy,
> and stale migration comments now say `0091`; branch head `ca915dc`, GitHub checks green, focused independent
> check found no blockers. **#368 accounting** now fails visibly on `expenses`/`sales` query errors instead of showing
> misleading zero/partial P&L, and `/expenses` nav visibility now matches the `0097` owner/accountant read gate;
> branch head `a4d1c7f`, GitHub checks green, focused independent check found no blockers. Both PRs remain **draft**:
> #366 still needs agronomist/pesticide-registration sign-off, and #368 still needs 7-year Excel reconciliation +
> privacy review plus explicit `0088`/`0097` apply planning.

> **2026-06-29 — remaining draft migration PRs independently reviewed; all HELD.** Parallel agents reviewed
> **#366 academy (`0091`)**, **#368 accounting (`0088` + `0097`)**, and **#400 export (`0092`)** against current
> remote `main` and prod ledger `0096`. Recommendation is unchanged but now sharper: keep all three draft and do
> **not** migrate. #366 is RLS/security-clean but still needs agronomist + Egyptian pesticide-registration sign-off;
> low-risk follow-ups are stale "0089" comments and surfacing `/academy` query errors instead of rendering empty
> content if schema is absent. #368 is RLS/privacy-clean after the sales/expenses read gates, but still needs
> 7-year Excel reconciliation + privacy review, and prod's ledger requires an explicit `0088` gap-fill then `0097`
> path; low-risk follow-ups are fail-fast `/accounting` query errors and aligning `/expenses` nav visibility with
> `0097`. #400 is schema/RLS-clean, but migration ordering is unsafe if `0092` is applied before #366's current
> `0091`, because `0091` re-emits `public.authorize()` without `export.write` and would silently drop export write
> permission. Safe choices: apply #366 `0091` before #400 `0092`, patch #366 `0091` to include the final permission
> union, or add a post-`0096` repair migration that pins the final union after both features. No merge or migration
> was performed from this review.

> **2026-06-29 — autonomous loop started; PR #400 reviewed/fixed/held; PR #412 reviewed/fixed/merged.** Owner instructed
> the agent to keep working without waiting, while preserving plan-first, docs-updated, review-before-merge, and
> review-before-migrate gates. Created
> [`2026-06-29-autonomous-farm-pr-review-loop.md`](superpowers/plans/2026-06-29-autonomous-farm-pr-review-loop.md).
> Reviewed draft PR **#400** (SPEC-0016 export compliance, migration `0092`): pushed commit `2e2183d` to fail closed
> on impossible compliance values, add DB CHECK constraints, and align the spec with the actual slice-1 schema.
> Validation: local pgTAP **670/670**, app `tsc`, focused eslint, Vitest **175/175**, production build; GitHub app/build
> + pgTAP + gitleaks + Vercel all green. **Decision:** keep #400 draft; do **not** merge/migrate `0092` until the
> lower-number in-flight migration lane (`0091` / #366, and related queued work) is reconciled and a fresh
> pre-migration review confirms exact prod apply order.
> Reviewed draft PR **#412** (import reference resolution). Found a dry-run validation bug: JavaScript date parsing
> accepted impossible dates such as `2026-02-31`, letting bad import rows reach the gated commit path. Prepared local
> commit `21467ad`; because local `git push` stalls in `send-pack`, published the same file contents through GitHub's
> Contents API, ending first at PR head `15fcbdd`. Then rebuilt the branch on current `main` to remove already-merged
> stacked #410 history and fixed the independent review blockers at head `08e925a`: ref lookups now require live
> structure parents (`archived=false`) and row numbers remain the original spreadsheet rows through validation,
> ref resolution, dedupe, and RPC failure reporting. Validation: focused import tests **41/41**, full Vitest
> **212/212**, `tsc`, focused eslint, production build; GitHub CI green; independent re-review approved. **Merged
> to `main` as `d7b832d`**. No migration or production apply was involved.

> **2026-06-28 (newest) — Owner "push": 8 review-clean PRs MERGED; migration PRs HELD (prod still `0089`).**
> All 18 open PRs independently reviewed (actor≠reviewer). **Merged to `main` (CI re-verified green):** SPEC-0017
> frontend stack **#405**/**#406** (CSV export)/**#407** (palm-360)/**#409** (MasterTable, rebased onto main after
> #406); **#395** (oracle test), **#396** (reserve-dedup), **#390** (session record), **#392** (SPEC-0004 plan).
> **No migrations applied — prod stays `0089`** (FE/app-quality ships via Vercel auto-deploy; no schema change).
> **Held:** migration PRs need migrate-FIRST (prod apply = Owner's act; Farm Supabase unreachable from the session).
> Apply-ready bundle at scratchpad `farm-prod-apply-0094-0095-0096.sql` → apply `0094`(🔴 C2)/`0095`/`0096`, then
> merge **#401**/**#402**/**#404**. Blocked on own issues: **#399** (dedup drop), **#403** (`sex` literal), **#400**
> (coupled to #366), **#391** (app-wide font decision). Expert-gated: **#368** (`0088` BROKEN — renumber ≥`0097`;
> accounting reconciliation+privacy) / **#366** (agronomist+pesticide sign-off). Still Owner: enable
> `custom_access_token_hook` + leaked-password protection; reconcile the uncommitted `main`-worktree state docs.
> **2026-06-29 Owner correction:** Supabase DB password + service-role key rotation is complete; do not list it as an
> open gate again unless the Owner reopens it.

> **2026-06-27 — parallel app-quality session: 9 PRs merged + both gated-stage CRITICALs fixed.** A second session ran the app-quality lane (NON-migration / NON-prod) alongside the knowledge-system work. **9 app-only PRs merged to `main`**, each CI-green with `main` re-verified green after merge: **#378** Arabic-Indic digit/date leaks; **#380** payroll zero/invalid-rate flag + tests; **#379** stock-coverage TS↔SQL parity (deepest-deficit basis, no double-subtracted receipts; independently reviewed); **#381** AI-assistant gate hardening (lowercase-normalize + broadened egress/PII regexes + adversarial tests); **#382** weather fetch-timeout + `server-only` guard + plan-check no-longer-false-green; **#384** expenses-date `fmtDate` + inventory column units; **#385** RTL physical→logical CSS + overspend text label + focus/aria; **#386** client-side form-validation (min bounds, date-order, default date); **#387** `runPlanChecks` N+1 → `Promise.all`. **Both gated draft PRs hardened (kept DRAFT, not merged):** **#368** — CRITICAL `sales` RLS read-leak fixed (reads now require `authorize('budget.write')` = owner/accountant) **+ the audit-mirror leak it exposed** (added a `sale` arm to `audit_read`), pgTAP 663✓; **#366** — CRITICAL pesticide sign-off bypass fixed (table CHECK `category <> 'pesticide' or has_chemical` + RPC forces the flag) **and migration renumbered `0089→0091`** to clear the duplicate-version collision with the merged palm-guard `0089` (left `0090` free for the planned member/role-admin migration), pgTAP 669✓. **Issues filed:** **#388** — researched wage-model decision memo (4 compensation modes, daily-rate default, Law 14/2025 compliance fields) → unblocks **SPEC-0006 §5 / Stage 8 payroll persistence**; **#383** — two verified issues in the now-applied `0085`/`0086`: `user_member_org_ids` is missing its explicit `revoke/grant` (anon-executable; low exposure) and `fn_update_org_settings` nulls `fiscal_year_start` when the arg is omitted (data-loss) — these are advisor-invisible, so **verify against the deployed prod `0089` and fix-forward if present.** Independent reviews posted on #389 / #368 / #366. No migration or prod-apply by this session (deferred to the deploy-owner lane).

> **2026-06-27 (newest) — Owner-authorized PUSH + MIGRATE + MERGE.** Knowledge System (16 docs) + SPEC-0014
> Tier A code committed/pushed/merged to `main` (branch `feat/knowledge-system-spec0014-tierA`, independent
> review APPROVE-WITH-NITS, nit fixed, tsc 0 / Vitest 159/159). **Prod migrated `0084` → `0089`** (`0085`
> active-org, `0086` org-settings, `0089` palm-guard) via MCP — exact repo versions, 0 stray rows, advisors show
> only pre-existing intentional WARNs; this **fixes the live org-switcher/settings errors**. Draft PRs #366/#368
> (academy `0087` / accounting `0088`) **deliberately NOT merged** — unmet human-expert gates + would 500 prod.
> Still Owner-only: enable the `custom_access_token_hook` in the dashboard to activate active-org; ratify SPEC-0013.
> **2026-06-29 Owner correction:** Supabase DB password + service-role key rotation is complete; do not list it as an
> open gate again unless the Owner reopens it.

> **2026-06-27 (latest) — ground-truth audit + commercialization specced (docs only; no code/migration/prod).**
> An external commercial-readiness assessment was **reconciled against `main`** and found to have evaluated a
> **stale prototype schema**, not the live code: the operating loop (Plan→Coverage→Budget→Approval→Execute→
> Cost→Report) and the multi-tenant / inventory / event / planning / PR foundation are **already built + live**.
> Created **[`RECONCILE-001`](RECONCILE-001-main-ground-truth-2026-06-27.md)** — now the **canonical capability
> map** (37 tables, ~38 RPCs, 26 pages, 89 pgTAP files; every capability → migration/RPC/route/lib + status +
> confidence). The one genuinely-missing layer → **[`SPEC-0013` Commercial SaaS Layer](SPEC-0013-commercial-saas-layer.md)**
> (subscriptions / tiers / limits / onboarding / import wizard / admin console / billing; **Draft**, High risk,
> 8 reviewable slices; **per-farm not per-seat**; real-data import behind Stage M privacy review). Also
> recommended (Owner-gated): a legacy banner on `docs/03` so its prototype schema examples aren't re-mistaken
> for production. **Next real Owner decision: ratify SPEC-0013 — esp. plan tiers + billing provider.**
> Also this session (Owner: "go for both, keep scope tight"): **[`SPEC-0014` Knowledge / Living Documentation
> System](SPEC-0014-knowledge-living-documentation.md)** scoped to **Tier A only** (page-level `pageMeta` help
> drawer + **rule-based** "Why?" over `lib/errors.ts` + a Documentation Health Score) — manual-generation,
> walkthroughs, videos, and the **AI Expert (blocked behind Stage 11)** are explicitly deferred — and a
> **CLAUDE.md Definition-of-Done amendment** adding the Documentation Health Score (blocking for user-facing
> pages, advisory for internal/admin/infra). Docs only; no app code/migration/AI route.
>
> **2026-06-27 (also) — canonical [`PRODUCT-MASTER-FILE.md`](PRODUCT-MASTER-FILE.md) written** (reconciled to
> `main`): the full product description (20 sections — modules, page-by-page manual of all ~26 verified routes,
> personas, permissions, data model, RPCs, workflows, built/partial/missing, roadmap). **Reconcile corrections
> it records vs older docs:** (1) **planned-vs-actual IS built** (`reports/[planId]/pva`) — corrects a stale
> RECONCILE-001 line; (2) **`/accounting` P&L + `lib/pnl.ts` + `sales` and `/academy` are NOT on `main`** (draft
> PRs #368/#366); (3) **README's prod "`0048`" is stale** — prod is `0084` (HELD), `main` `0089`. Treat the
> master file + RECONCILE-001 as ground truth.
>
> **2026-06-27 (also) — [`SPEC-0015` Product Knowledge System](SPEC-0015-product-knowledge-system.md) written +
> master file made the hub.** Designs a 6-phase "Knowledge Operating System" (FEAT/BR/TERM **traceability model**
> + L0–L5 **maturity levels**), but **scopes only Tier 1** for build: **Feature Registry + Business Rules Catalog
> + Domain Dictionary** (all code-anchored, Health-Score-tracked). Explicitly **deferred** (phase-gated by a real
> consumer): Notification/Automation/Import-Export/Metrics/Training/Customer-Success/AI-Knowledge-Graph + the
> RPC/Event/Report catalogs. Added a **Knowledge System Index** to [`PRODUCT-MASTER-FILE.md`](PRODUCT-MASTER-FILE.md)
> (hub; body not expanded).
>
> **2026-06-27 (also, under Owner `/goal`) — Tier-1 catalogs BUILT (L3, code-anchored).** Via 3 read-only Explore
> agents: **[`FEATURE-REGISTRY.md`](FEATURE-REGISTRY.md)** (27 FEAT-IDs), **[`BUSINESS-RULES-CATALOG.md`](BUSINESS-RULES-CATALOG.md)**
> (~50 BR-IDs from ~68 extracted constraints, each → enforcing object + migration + test + FEAT; powers the
> rule-based "Why?"), **[`DOMAIN-DICTIONARY.md`](DOMAIN-DICTIONARY.md)** (~40 terms, verified Arabic). Hub index
> flipped to ✅. **Reconcile fixes applied this session:** RECONCILE-001 corrected (planned-vs-actual IS built at
> `reports/[planId]/pva`; `/accounting`+`lib/pnl.ts` are draft-PR not on `main`); README given a ground-truth
> banner (its "`0048`" was stale; `main`=`0089`, prod=`0084`). Docs only — no app code/migration/AI/deploy.
>
> **2026-06-27 (also, under `/goal`) — Knowledge System Phase 2 BUILT (5 engineering catalogs, L3).** Via parallel
> Explore agents: [`RPC-CATALOG.md`](RPC-CATALOG.md) (28 RPCs + 9 trigger fns), [`DATA-DICTIONARY.md`](DATA-DICTIONARY.md)
> (38 tables, TBL-IDs), [`PERMISSIONS-MATRIX.md`](PERMISSIONS-MATRIX.md) (roles×perms×pages + SoD),
> [`EVENT-CATALOG.md`](EVENT-CATALOG.md), [`REPORT-CATALOG.md`](REPORT-CATALOG.md) (6 reports + 2 charts). Tier-1
> catalogs also adversarially verified (12/12 BR claims; 2 test-number typos fixed). Component catalog = Storybook
> (linked). Phases 3–6 remain consumer-gated. Docs only — no app code/migration/AI/deploy.
>
> **2026-06-27 (also, under `/goal`) — SPEC-0014 Tier A *content* drafted as docs.** [`PAGE-HELP.md`](PAGE-HELP.md)
> (5-question block per page), [`WHY-CATALOG.md`](WHY-CATALOG.md) (rule-based "Why?" grounded in `lib/errors.ts`),
> [`DOCUMENTATION-HEALTH.md`](DOCUMENTATION-HEALTH.md) (DoD scorecard baseline; core-loop pages at L3). 16 knowledge docs.
>
> **2026-06-27 (also, under `/goal`) — SPEC-0014 Tier A BUILT in app code + verified.** First running product this
> session: `lib/page-help.ts` (Arabic `pageMeta`), `lib/why.ts` (rule-based "Why?"), `HelpDrawer.tsx`/`WhyButton.tsx`
> (via `@amrebeid/ui` Drawer), wired once into `AppChrome` topbar; A4 Health-Score = **Vitest drift-guards**
> (`page-help.test.ts`/`why.test.ts` — new nav page/error code fails CI until its help/Why exists). **Verified: tsc 0,
> ESLint 0, Vitest 159/159.** Low-risk (presentational + pure logic; no schema/AI/access). **Local/uncommitted; not
> deployed** (deploy/commit Owner-gated). Stage **K** now: SPEC-0014 Tier A done; Tiers B/C deferred (C behind Stage 11).
>
> **2026-06-27 (earlier) — palm archived-hawsha guard merged (`0089`, prod HELD) + market scan → SPEC-0012 + profile page.**
> (1) **`fn_save_palm` data-integrity fix** — an EDIT could re-parent a live palm into an *archived* hawsha
> (vanishes from live views; NOT tenant-isolation). Merged as **PR #373**: migration **`0089`**
> (`palm_no_archived_hawsha`, rejects re-parent into archived hawsha → `22023`) + pgTAP **test `89`** (9 assns).
> Independent review: APPROVE-WITH-NITS. Renumbered `0087`→`0089` to yield to in-flight #366(0087)/#368(0088).
> **Owner decision: prod apply HELD** — prod stays `0084`; `0089` + the pending `0085`/`0086` access-control
> chain await that chain's independent review. (2) **Market/UX research** → [`SPEC-0012`](SPEC-0012-account-admin-and-ux-gaps.md)
> (member/role UI, profile, theme, `/m` offline audit). Owner ratified **role model = existing 5 roles**.
> Shipped via **PR #376**: **S3 read-only `/profile`** + nav; **S1 `/m` offline audit** (offline-*tolerant*, not
> offline-*capable* — no SW/PWA/queue). **Next:** S2 member/role admin (migration `0090` + invite-mechanism
> decision + independent review).
>
> **2026-06-27 (product UI + Stage 1/0) — Stage 1 closed; four backend-but-no-UI gaps shipped as pages.**
> **Stage 1 (SaaS foundation) is DONE** — active-org RLS narrowing + org switcher + org settings
> (#348/#357/#359/#360, migrations `0085`/`0086`; independently reviewed, all four acceptance criteria met).
> **Stage 0 is Owner-deferred** (#365): runbook ready, new repo verified secret-clean, leaked-password
> protection confirmed off; the five credential/external steps are tracked in issue **#362** (to be done
> before real data). Filled four product-surface gaps that had schema but no front-end — live, RLS-enforced,
> role-gated: **Suppliers** (#367), **Expenses** (#369), **Team/People** read-only directory (#370),
> **Budgets** overview (#371). **24 in-app pages** now. Note: prod DB is behind `main` (active-org `0085`/`0086`
> + later not yet pushed) — a prod `db push` + redeploy is needed for these to go live.
>
> **2026-06-27 (latest) — back-half stages advanced to the buildable limit; Owner closed 4 ratification gates in-session.**
> The Owner (Amr Ebeid) **ratified SPEC-0003 / 0005 / 0006 / 0007 + the 5-sector decision** in writing this session
> (recorded → PR #363), closing the ratification gates for Stages 5/8/9/11. Delivered: **Stage 9 weather** (PR #350,
> ready; needs API key); **Stage 5 croquis re-landed** (PR #364 — #347 had been orphaned when #344's base branch was
> deleted on merge); the **payroll** + **P&L** + **academy** + **AI-policy** safe cores; and, per the Owner's "build on
> synthetic, gated" directive, the **Stage 7 accounting framework** (PR #368 — `expenses.kind` #6 + `sales` + P&L report,
> migration `0088`) and the **Stage 10 academy editor** (PR #366 — content store + #4 sign-off gate + `/academy`, migration
> `0087`). All verified (pgTAP 660–666, tsc/eslint/build 0). **Two gates remain OPEN by design — they are real-world expert
> acts no AI can perform or fabricate:** Stage 7's **7-yr Excel reconciliation + privacy review**, and Stage 10's
> **licensed-agronomist + Egyptian pesticide-registration sign-off**. Also still binding: **independent review** before the
> Stage 8 payroll RPC + the Stage 11 AI build reach prod. PRs are drafts; apply migrations `0087`/`0088` WITH the merge
> (same ordering discipline that kept 2/3/4 from breaking prod); #366 & #368 need a trivial allowlist/types merge.
>
> **2026-06-27 (earlier) — Stages 2/3/4 SHIPPED + applied to prod; prod head = `0084`, in sync with `main`.**
> Merged **#344** (Stages 2/3/4), **#346** + **#351** (list search/filter — reusable `FilterableTable` +
> unit-tested `lib/filter.ts`, across inventory / purchase-requests / plans). Applied migrations
> **`0080`–`0084`** to prod via the Supabase MCP under their exact repo versions (0 stray rows) +
> **`storage-policies.sql`** (`farm-media` bucket + org-scoped storage RLS). Verified live: struct/event/plan
> RPCs + `attachments` (forced RLS) present, ledger clean, `get_advisors` only pre-existing WARNs. A
> frontend audit this session confirmed the MVP-0 UI is essentially complete (recommendation panel,
> PR-approval UI, palm grid, #187 Arabic errors, loading skeleton were all already built). **Owner-gated
> next:** independent review of the `0081`/`0084` RLS re-emits (access-control; actor ≠ reviewer); regen
> `database.types.ts` vs prod `0084`. New stages (5/7/8/9/10/11) remain SPEC-ratification-gated — not started.

> **2026-06-27 — Stages 2/3/4 BUILT + reconciled onto `main` (verified), on branch
> `feat/stages-2-3-4-structure-events-plans`.** Editable farm structure + per-node 360 pages + photos/docs
> (Stage 2, [`SPEC-0003`](SPEC-0003-farm-structure-and-palm-registry-import.md) §9); ad-hoc activity
> recording (Stage 3, [`SPEC-0010`](SPEC-0010-activity-event-recording.md)); plan creation/assign/labor +
> `/plans` (Stage 4, [`SPEC-0011`](SPEC-0011-planning-workspace.md)). Built on a stale 0050 base, then
> **renumbered to migrations `0078`–`0082`** (tests `80`/`81`/`82`) and **rebased onto `origin/main`
> (prod `0077`)** — 1 ahead/0 behind. Verified on the rebased branch: **pgTAP 627/627, tsc, Vitest 110/110,
> `next build` green**. One real fix the reconcile caught: explicit `attachments` grant (audit-leak
> invariant). **Owner-gated next:** push + PR; then apply `0078`–`0082` + `storage-policies.sql` to prod +
> regen types. See [`RECONCILE-stages-2-3-4-to-0077.md`](RECONCILE-stages-2-3-4-to-0077.md).

> **2026-06-26 — #155 / SPEC-0009 partial receipts COMPLETE end-to-end (model + UI):** the partial-receipt
> UI (SPEC-0009 slice 5) merged as **#285** — `components/ReceiveForm.tsx` (per-line received-qty inputs,
> default/max = remaining, partial + receive-all, over-receipt 23514→Arabic, double-submit guard), the
> PR-detail received/remaining columns + `partially_received` status, and `recordReceipt` passing
> `p_lines`. With slices 1–3 already shipped as migration **`0045`**, **#155 is complete end-to-end**.
> Only slice 4 (retire the forgeable `app.posting_receipt` GUC) remains, now **optional/low-priority** —
> the writes it guarded are already independently locked down (movements RPC-only via `0030`,
> `received_qty` column-revoked via `0045`), so a forged GUC achieves nothing. **App-only — prod migration
> number unchanged at `0048`.**

> **2026-06-26 (later) — prod pushed to `0035`, IN SYNC with `main` (live-verified):** applied
> **`0032`** (`pr_items_lock_and_version_bump`), **`0033`** (`fn_post_movement_floor_lock`, CONC-1),
> **`0034`** (`engine_stale_po_guard`, ENGINE-STALE-1 #197) and **`0035`** (`authorize_org_scoped`,
> AUTHZ-2 #181) to the prod Supabase (`veezkmytervjnpxcrbkw`) via the MCP, recorded under their exact repo
> versions. Verified live: `list_migrations` → `0035`; the `fn_stock_coverage` guard + `fn_post_movement`
> `FOR UPDATE` lock present; `authorize` is now the 2-arg org-scoped overload (1-arg dropped) and all 7
> policies + the 2 RPCs call it (`multi_org_members = 0`, so zero behavior change on current data);
> baseline coverage correct; `get_advisors` shows only pre-existing WARNs (no new regressions).
> **Authoritative current prod state: `0048`** — after the `0035` push, **`0036`** (FK perf indexes, #230)
> and **`0037`** (`authz3_reserve_wrapper`, AUTHZ-3 #182 — `fn_post_movement` made internal + gated
> `fn_reserve_stock` wrapper) were also applied + verified (fn_post_movement no longer
> authenticated-executable; the wrapper enforces inventory.write); then **`0038`** (`fn_add_plan_operation`,
> #196 — atomic plan-operation RPC); then **`0039`** (`fn_update_palm_status`, #238 — op.execute-gated
> atomic palm-status RPC), **`0040`** (`engine_rec1_fix`, #184 — removed the recommendation's period-1
> receipts double-subtract) and **`0041`** (`inventory_unit_cost`, #89-B — manual unit_cost, NULL when
> unknown, removes the fabricated *84) were applied + verified. Since then the **`0042`–`0046`** batch was
> applied + verified: **`0042`** plan_req_rolegate, **`0043`** budget_rolegate, **`0044`** expenses_rolegate
> (the Owner's RLS role-gates on plan-req/budget/expenses, closing the no-role-gate class B2/AUTHZ-1), **`0045`**
> partial_receipts (#155 — received_qty + partially_received + remaining-based projection + received_qty
> column-UPDATE lockdown), **`0046`** people_compensation (PII-1 #173 wage slice — `payroll.read` perm,
> `people_compensation` table, `people.rate` dropped). **Then `0047`** engine_nulldate_guard (#198 — `fn_stock_coverage`
> now coalesces a NULL `planned_at` to period 1 so null-dated demand is never silently dropped) was applied + verified
> (no-op for dated ops; potassium recommendation unchanged at 600). **Then `0048`** contact_pii_lockdown (PII-1 #173
> phone/email slice — deny-by-default: `revoke select on people from authenticated` + re-grant all columns except phone/email;
> phone column retained for service-role linking) was applied + verified (members can no longer read phone/email; non-PII still
> readable). **#173/PII-1 is now FULLY DONE — both the wage slice `0046` and the contact slice `0048`.**
> Verified (`list_migrations` → `20260622000048`); pgTAP 421/421.
> Also merged app-only (no migration): the `/m` field-view fixes (#268 — dropped a hardcoded plot name, corrected the
> "today" heading, subtype-derived execute defaults) and the plans-page fixes (#269 — plan-block labeled by real cause
> budget-vs-stock, not-found guard, stepper state). A comprehensive app bug-sweep this session confirmed
> auth/middleware/inventory/farm-sector/all action files clean.
> A duplicate non-repo perf-index record (`20260626053743`) was removed so prod history matches the repo exactly.
> *(This session prod went stale-docs→`0031`→`0034`→`0035`→`0037`→`0038`→`0041`→`0046`→`0047`→`0048`.)*
> This supersedes the stale figures elsewhere — the `0028`/`0029` prod claims in older entries (and `0023`
> in the READMEs) were mid-push or lagging snapshots, now corrected. No code/schema changed in this
> reconciliation. (Also surfaced this session: a local-only branch `feat/stage-2-farm-structure` holds
> **unratified** Stage 2 WIP — farm-structure read-views + a registry reconciliation oracle that hardcodes
> **5 sectors**, an open Owner decision per SPEC-0003; do not merge before SPEC-0003 ratification + the
> 4-vs-5 sector call. And three app-layer findings filed: **#187** (AR-ERR-1 Arabic error-mapping gaps,
> non-gated), **#188** (CREATE-1-RESERVE orphaned reservation, review-gated), plus a note on **#89**
> (hardcoded `needed_by` has an engine-projection consequence).)

> **2026-06-25 — Storybook 10 toolchain upgrade + `@amrebeid/ui` 1.2.0 published (merged):** the deferred
> Storybook major (Dependabot #131, ERESOLVE) landed properly via **PR #154** (`chore/storybook-10`).
> Whole Storybook stack `8.6.14`→`10.4.6` (`@storybook/react-vite` + core `storybook`), `@storybook/addon-essentials`
> **removed** (Storybook 9+ folded essentials into core — no v9/v10 release exists, by design; **not** an
> upstream block). `.storybook/main.ts`+`preview.ts` migrated (renderer→framework import; `backgrounds`
> `values`→`options`+`initialGlobals`); all **49** `*.stories.tsx` imports moved to `@storybook/react-vite`.
> Lockfile updated **surgically** to preserve `@types/react` hoisting (kept the `apps/farm-os` typecheck
> green); **no `--force`/`--legacy-peer-deps`**. All CI green (build job incl. **build-storybook**; app job;
> pgTAP) locally + on GitHub. Owner merged #154 (#131 auto-closed). The changesets flow then published
> **`@amrebeid/ui@1.2.0`** to npm + tag `@amrebeid/ui@1.2.0` (release PR #162), carrying this upgrade + the
> 4 queued UI changesets (a11y, datatable-mobile, recharts code-split, reduced-motion); `packages/ui` now `1.2.0`.
> Also merged by Owner this session (not authored here): **#163** (`#158`, lock `inventory_movements` INSERT
> to the RPC path — forgeable ENGINE-DC bypass) and **#164** (`#159`, floor `on_hand` at 0 in
> `fn_post_movement`) — both stock-engine/security fixes on `main` (HEAD `52fa7b0`); **confirm prod migration
> state separately before relying on them in prod.**
>
> **2026-06-25 — DB hardening session (merged + APPLIED to prod):** the queued security caveats
> from the prod-push assurance are now **closed in code and live on prod**. Prod Supabase
> (`veezkmytervjnpxcrbkw`) advanced **`0024`→`0028`**, fully in sync with `main` — all migrations
> applied + verified live; the full pgTAP suite is green locally and in CI at every step. Each landed
> as its own CI-green PR:
> - **AUTHZ-1 Option B** — PR #146, migration `0025_operation_tables_rls_authz`: REST-layer role gate on
>   the operation tables. `farm_event` (+ partitions) / `event_locations` / `quantities` gated to
>   `op.execute` (preserving the RLS-H1 parent-org `EXISTS` check); `plan_operations` gated to
>   `plan.write` (matches the planning action). Closes the direct-PostgREST forge-a-done-operation
>   surface. (test `26`)
> - **ENGINE-DC** — PR #144, migration `0026_engine_dc_constraint`: a `BEFORE INSERT` trigger on
>   `inventory_movements` (`type='receipt'`) rejecting a receipt while an approved-not-received PO for
>   the same `(org,item)` still exists — turns `0018`'s disjointness invariant into a hard DB control.
>   `fn_post_receipt` is claim-first so the legit path is safe. (test `27`)
> - **DELETE-posture** — PR #140, migration `0027_delete_posture_remediation`: `REVOKE DELETE` from
>   `authenticated,anon` on **27 tenant tables**; `plan_checks` intentionally kept deletable (the only
>   legit client delete). (test `28`)
> - **D1 FORCE RLS** — PR #142, migration `0028_force_rls_tenant_tables`: `FORCE ROW LEVEL SECURITY` on
>   all **35** RLS-enabled tenant tables. (test `29`)
>
> **pgTAP now 217 assertions, all green** (Docker-free shim harness + CI). **B2 inventory receipt
> role-gating assessed = ALREADY COVERED** (`fn_post_receipt` + the `0015` policy both enforce
> `inventory.write`) — no migration needed. **AP-5 insert-side SoD** (#76 item 2) confirmed **ALREADY
> merged earlier** (migration `0023`, test `21`) — **RESOLVED**. Other PRs merged this session: **#111**
> (generated Supabase types + typed clients), **#127** (`@playwright/test` patch), **#129**
> (`react`/`react-dom` → 19.2.7); #123/#125/#85/#139 merged earlier in the day. **Live verification:**
> manager login OK; authenticated reads (`farms`/`plans`) HTTP 200; DELETE `expenses` as manager →
> HTTP 403 (permission denied). Demo login fixed earlier — all 6 `@ebeid.test` accounts reset to
> `farm-os-pilot`. **Prod hygiene:** dropped the stray `pgtap` extension from prod `public` (a Supabase
> advisor WARN). **Dependabot majors DEFERRED** (open, commented): #128 TypeScript 6.0 (tsconfig
> `baseUrl` deprecation hard-errors), #130 ESLint 10 (`eslint-plugin-react` incompatible with the v10
> rule API), #131 Storybook 10 (ERESOLVE across the 8.6.x addon stack). **2026-06-29 correction:** Supabase
> DB password + `service_role` key rotation is complete per Owner confirmation; do not reopen it unless the Owner
> explicitly says so. Remaining auth/security follow-up here is to enable **Leaked Password Protection**
> (HaveIBeenPwned) via the Auth dashboard toggle. Detail:
> [`SECURITY-REVIEW-FOLLOWUP-2026-06-25.md`](SECURITY-REVIEW-FOLLOWUP-2026-06-25.md).
>
> **2026-06-25 follow-up security review (merged):** a second independent pass closed **B2.1**
> (append-only stock ledger, migration `0016`, #42), **AP-5** (PR self-approval SoD trigger,
> migration `0017`, #47), **EXE-1** (idempotent operation execute / claim-first, #51), **RCP-1**
> (idempotent PR receipt / claim-first, #57), **ENGINE-DC** (stock-coverage receipt double-count
> → fixed via direction #2: scheduled receipts sourced from approved POs, migration `0018`, #61), and
> **CREATE-1** (idempotent PR-create / find-or-create, #63), and **AUDIT-1** (audit
> `organization_member` changes, migration `0019`, #68) — plus a lint fix (#43), findings/runbook docs
> (#45/#49/#54/#55/#58/#59/#60/#62/#64/#65/#66), the ENGINE-DC TODO regression (#56) + engine
> round-trip test (#67), and the **SPEC-0002 authorization-enforcement DRAFT (#69, Owner-gated)**. All
> merged to `main` after independent diff review + local pgTAP/e2e verification; **pgTAP 103/103** (17
> files) + wedge-loop e2e green. **Prod DB still at `0013`** — pushing `0015`/`0016`/`0017`/`0018`/`0019`
> remains an Owner hard-stop (**`0018` is the core-engine change — ratify specifically**; the
> EXE-1/RCP-1/CREATE-1 fixes are app code, no migration). Open findings (all Owner-gated / deferred):
> **AUTHZ-1** (app-layer `op.execute` gate landed #71; authoritative RLS enforcement — SPEC-0002
> Option A — awaits Owner ratification, then a migration), **DEP-1** (`postcss<8.5.10` transitive via
> `next`, build-time only), **BUD-1** (INFO — the budget gate is decision-support + owner-approval, not
> a hard DB spend cap; `committed` is display-only), **CREATE-2** (LOW — `addPlanOperation`
> non-idempotent/non-atomic, planning-path, conservative). SoD finding renamed AP-3→AP-5
> (AP-3 = the PR version-guard). Detail:
> [`SECURITY-REVIEW-FOLLOWUP-2026-06-25.md`](SECURITY-REVIEW-FOLLOWUP-2026-06-25.md).
>
> **2026-06-25 prod-push (applied):** after an 8-agent adversarial prod-push assurance returned
> **GO-WITH-CAVEATS**, migrations `0015`→`0022` were applied to the prod Supabase project via the
> Supabase MCP (`0018` engine change Owner-ratified). **Prod DB is now at `0022`** (`0001–0013` +
> `0015–0022`), fully seeded (1 org, 6 org members, 12 auth.users, full synthetic dataset; transactional
> tables empty — correct pilot state). New this session on branch `fix/authz-1-execute-rpc` (PR #75,
> commit `31ad992`): **`0021`** (lock SECURITY DEFINER EXECUTE grants — revoke `anon` on write RPCs
> `fn_execute_operation`/`fn_post_movement`; revoke public+anon+authenticated on trigger fns
> `pr_guard_approval`/`fn_audit`/`fn_audit_org_member`) and **`0022`** (revoke UPDATE on
> `inventory_movements`/`inventory_bin` → ledger fully append-only, closes #76 item 1), with pgTAP
> tests `19`+`20`. **pgTAP now 126/126** on a clean reset (was 103). Residual caveats (QUEUED, not
> blocking, not live-exploitable on synthetic single-tenant data): **AUTHZ-1 Option B** (gate operation
> tables `plan_operations`/`farm_event`/`event_locations`/`quantities` at the REST layer, not only in
> the `0020` RPC); **AP-5 insert-side SoD** (#76 item 2 — a born-approved PR sidesteps the BEFORE UPDATE
> trigger); **ENGINE-DC** disjointness is convention-enforced, not DB-constraint-enforced. PRs #75/#77
> are both green; merging either = prod deploy = **Owner gate**.
>
> **2026-06-25 — phone-OTP removed:** auth is **email + password only**. The phone-OTP UI skeleton
> (login footnote) is gone and `[auth.sms]` stays disabled in `supabase/config.toml`; Twilio / any SMS
> provider is **dropped from MVP-0 scope** (OWNER-DECISIONS §2 resolved). The seed `phone` field stays
> as a demo-linking key + contact data — it is not auth. (branch `chore/remove-phone-otp`.)

## Current focus
One private monorepo `github.com/AmrEbeid/Farm` (`packages/ui` + `apps/farm-os` + `docs/`). The **design system** (`@amrebeid/ui` **v1.1.0, published** to GitHub Packages, green CI) and the **Farm OS MVP-0 app** are both **BUILT** and on `main`. The **independent security review is DONE + merged** (RLS/grants/engine fixes, the `db-tests` pgTAP CI gate, the `fn_post_movement` B1 primitive). The full inventory path (B1 rewiring + **D2 ledger-backed `reserved`**) is **merged + verified** (74/74 pgTAP + the Playwright wedge-loop e2e pass on the real Supabase stack). The app is now **DEPLOYED + LIVE** (2026-06-24) on **farm-ui-one.vercel.app** + **ebeidfarm.business** with a dedicated Supabase project — login + RLS + the stock-coverage engine verified on prod (see `DEPLOY-STATUS.md`). **2026-06-29 Owner correction:** Supabase DB password + service_role key rotation is complete; do not list it as an open gate again unless reopened. **Pilot validation — considered DONE (Owner):** customer research was completed pre-project (it produced the plan + dummy data). **Near-term:** MVP-0 is deployed + security-reviewed + e2e-verified, live and stable on synthetic data; remaining gates are legacy **Stage 0** secret remediation, real-data migration (after a privacy review), leaked-password protection, and product/expert decisions. **Done this session (2026-06-25):** AUTHZ-1 Option B, ENGINE-DC DB-constraint, the DELETE-exposure remediation, and D1 FORCE RLS — all merged + applied to prod (`0028`), pgTAP 217 green (see top banner). **Optional, agent-doable:** B3 (decision-gated minor); in-browser wedge walkthrough.

## Stages (risk-tiered; see MASTER-PLAN.md §4 for full plan)
| Stage | Title | Type | Risk | Status | Notes |
|---|---|---|---|---|---|
| R | Research & strategy | Research | Low | **Done** | 4 cited streams; white-space confirmed (docs 01) |
| D | Designs / prototypes | Documentation | Low | **Done** | `ebeid-farm-os-demo.html`, `farm-os-prototype.html`, `farm-os-full-demo.html` (mocks) |
| DS | Design system + component library | Execution | Low/Med | **Done (v1.2.0 published)** | `@amrebeid/ui` ~40 components, white-label theming, token-purity gate, Changesets, **green CI**. **`1.2.0` published to npm + tagged (2026-06-25)** — a11y, datatable-mobile, recharts code-split, reduced-motion + **Storybook 10 toolchain upgrade** (PR #154). (Catalog expanded beyond the 9 synced to Claude Design — re-sync pending.) |
| 0 | Security remediation & data cleanup | Execution+Apply | **Critical/High** | **Owner-deferred (2026-06-27)** | Prepped to the boundary by the agent: runbook (`STAGE-0-REMEDIATION-RUNBOOK.md`) complete, new repo verified secret-clean (gitleaks gate + manual scan), leaked-password protection confirmed OFF via advisor. **2026-06-29 Owner correction:** Farm Supabase DB password + service-role key rotation is complete; do not list it as open again unless reopened. Remaining Owner-only external cleanup: rotate/retire any non-Supabase legacy keys still identified in Stage 0, purge old-repo history, scrub spreadsheet + Google password, enable leaked-password protection — **deferred by Owner decision; must be done before real Ebeid data**. Tracked with exact commands in issue #362. |
| **MVP-0** | **Proof-of-value pilot (1 reference tenant)** | Execution | **Low/Med** | **BUILT (local) — pending review+validation** | `apps/farm-os`: all 14 screens, wedge loop e2e passing, 36 pgTAP + 11 Vitest. Plan: `docs/superpowers/plans/2026-06-21-farm-os-mvp0.md`. Local DB only; needs security review + pilot validation + deploy. |
| 1 | SaaS foundation (orgs/RLS/roles/audit) | Execution | **High** | **Done (2026-06-27)** | All four acceptance criteria met + independently reviewed. (a) **Cross-tenant isolation** — RLS deny-by-default `to authenticated`, `org_id` indexed, proven by `01_rls_isolation` + the invariants `08`/`22`/`24`/`27`/`81` (no-permissive-policy, every cross-org FK org-validated, every SECURITY DEFINER fn pins search_path); (b) **consultant multi-org per-org role** — **active-org** narrowing at the RLS layer (migration `0085`: `user_org_ids()` narrows to a membership-validated `active_org_id` JWT claim, fail-closed; `0086` org settings) + app **org switcher** + `getActiveMembership` reads the active claim (tests `82`); (c) **member removal revokes instantly** (membership-join RLS); (d) **audit_log immutable** (no update/delete policy + `02`/`79`). Org **settings** = owner-gated `fn_update_org_settings`. Farm-setup wizard covered by the editable structure feature. Independent adversarial review of the active-org core: no cross-org leak/escalation. |
| 2 | Farm structure + palm registry import | Execution | Medium | **Done (2026-06-27, merged #344 + live)** | Editable structure (add/edit/remove sector/hawsha/line/palm) + per-node 360 pages + media + **croquis map** (re-landed #364); migrations `0080`–`0084` applied to prod. **SPEC-0003 RATIFIED (Owner 2026-06-27), 5 sectors.** Real Nov-2025 registry bulk import = Stage M. |
| 3 | Activity/event model + operations | Execution | Medium | **Done (merged #344 + live)** | Ad-hoc event recording + follow-ups (SPEC-0010); migration `0083`. |
| 4 | Planning workspace | Execution | Low/Med | **Done (merged #344 + live)** | Plan create/assign/labor + `/plans` (SPEC-0011); migration `0084`. |
| 5 | Inventory + **stock-coverage engine** | Execution | Medium | Todo | The wedge — define checks first (SPEC-0001) |
| 6 | Budget + approvals + purchase requests | Execution | **High** | Todo | Approval/entitlement logic |
| 7 | Accounting (expenses/sales/vouchers) | Execution | **High** | **Cash-method custody ledger live (PR #568); full P&L still gated** | Branch `feat/accounting-custody-standalone` added source-linked cash ledger + request settlement for custody/payment requests. Validation green (local pgTAP 904/904, app 251/251, lint/build, PR checks + CodeRabbit). Prod migration `20260701220000 accounting_cash_custody_settlement` is applied/probed migrate-first; PR #568 merged at `8ffc4ae`; post-merge `ci`/`db-tests`/`release` green; live `/accounting` and `/custody` protected-route probes pass. Older #368 synthetic P&L remains behind real Excel reconciliation + Stage-M privacy review. |
| 8 | People & labor/payroll | Execution | **High** | **SPEC-0006 RATIFIED (2026-06-27); engine built, full build review-gated** | **PII-1 #173 FULLY DONE** (`0046` wage slice + `0048` contact slice). Payroll computation engine + reconciliation oracle (`lib/payroll.ts`, draft PR #352). **Ratify unblocks the synthetic `labor_logs` + payroll-run RPC build — NOT YET BUILT; needs independent access review + real PII behind Stage M.** |
| 9 | Weather integration | Execution | Medium | **Built (2026-06-27, PR #350 ready); SPEC-0007 RATIFIED** | Untrusted-safe forecast ingest (`lib/weather.ts`) + advisory operation gates + `/weather`. **Go-live = Owner sets server-side `WEATHER_API_KEY`/`WEATHER_API_URL` in Vercel.** |
| 10 | Care Academy content | Documentation | Med/High | **Editor built on synthetic (2026-06-27, draft PR #366)** | Content store + the **#4 authoritativeness gate** (`lib/academy.ts`) + sign-off workflow + `/academy` editor. Migration `0087` draft. pgTAP 666/666. **GATE STILL OPEN:** a **licensed agronomist + current Egyptian pesticide-registration sign-off** — content stays advisory ("قالب استرشادي") until then; editing content RESETS any sign-off. |
| 11 | AI assistant عبدالجليل | Execution | **High** | **SPEC-0005 RATIFIED (2026-06-27); boundary built, AI build review-gated** | Trifecta capability boundary (`lib/assistant-policy.ts`, draft PR #356) — deny-by-default, read-only/RLS-scoped/no-PII/no-outbound. **The AI itself (chat route, model, ingest) is NOT built — it requires independent security review per slice (highest risk).** |
| UX | Account admin & UX-gap closure | Execution | Medium | **Active** | [`SPEC-0012`](SPEC-0012-account-admin-and-ux-gaps.md) — from the 2026-06-27 market scan. **Done:** S1 `/m` offline audit, S3 read-only `/profile` (PR #376). **Next:** S2 member/role admin (5-role model ratified; migration `0090` + invite mechanism + review), S4 true offline, S5 theme. Does NOT rebuild Stage-1 items. |
| C | Commercial SaaS layer (subscriptions/onboarding/admin) | Execution | **High** | **Todo — [`SPEC-0013`](SPEC-0013-commercial-saas-layer.md) DRAFT; #215 research paused** | The largest remaining product gap (RECONCILE-001): billing/plan-tiers/tenant-limits/self-serve signup/onboarding/import wizard/demo tenant/admin console/trials/feature-flags. **None in schema/app today.** 8 slices; per-farm not per-seat; entitlements enforced in Postgres; real-data import gated on Stage M. #215 should refine the self-serve control panel as config-as-data, separating tenant owner setup from platform support/admin controls. Prereq: SPEC-0012 S2 invite (`0090`). |
| K | Knowledge / living documentation system | Execution | Low/Med | **Tier A BUILT + verified (2026-06-27, local)** | [`SPEC-0014`](SPEC-0014-knowledge-living-documentation.md): in-app Help drawer (`pageMeta`, 5 questions) + **rule-based "Why?"** (`lib/page-help.ts`/`lib/why.ts`/`HelpDrawer.tsx`/`WhyButton.tsx`, wired in `AppChrome`) + Health-Score **Vitest drift-guards**. tsc/lint/159 green; not deployed (Owner-gated). Plus the full knowledge system ([`SPEC-0015`](SPEC-0015-product-knowledge-system.md), 16 docs). **Deferred:** manual-gen/walkthroughs/videos (Tier B) + **AI Expert (Stage 11)** (Tier C). |
| M | Ebeid real-data migration (reference tenant) | External Apply | **High** | Todo | Real financials + PII |
| P | Production deploy (Vercel) | External Apply | **Critical** | **In progress** | MVP-0 deployed: Vercel `farm-ui` + dedicated non-Zeal Supabase `veezkmytervjnpxcrbkw`; prod DB is **at `0096` per DEPLOY-STATUS current-state note**. Earlier `0032`–`0048` were pushed + live-verified via `list_migrations`, incl. ENGINE-STALE-1 #197 + AUTHZ-2 #181 + AUTHZ-3 #182 + atomic plan-op #196 + FK perf indexes + palm-status RPC #238 + ENGINE-REC1 #184 + inventory unit_cost #89-B + the Owner RLS role-gate trio `0042`–`0044` (plan-req/budget/expenses) + partial receipts `0045` #155 + wage-confidentiality `0046` PII-1 #173 wage slice + engine null-date guard `0047` #198 + contact-PII lockdown `0048` PII-1 #173 phone/email slice) + full synthetic seed (transactional tables empty); backend verified (manager login + RLS; authenticated reads HTTP 200; DELETE `expenses` → HTTP 403; anon denied); pgTAP 421/421. Pending: enable Leaked Password Protection. **Rotation note:** Owner confirmed 2026-06-29 that Supabase DB password + service-role key rotation is complete; do not raise again. (Twilio OTP dropped per Owner.) See [DEPLOY-STATUS.md](DEPLOY-STATUS.md). |

Status legend: Todo / Active / Blocked / In review / Done

## Pilot validation gates (MVP-0)
> **Owner (2026-06-24): considered SATISFIED** — the customer research/validation was done *before*
> the project (it produced the plan + the dummy/seed data), so this is not a remaining blocker.
> (Original ≥5/7 criteria + demo/interview plan retained for reference in [`PILOT-READINESS.md`](PILOT-READINESS.md) / [06 §10](06-MVP-0-BUILD-SPEC.md).)

## Definition of Done (paste per stage; see [10 §16](10-operations-and-readiness.md))
- [ ] Code complete · tests pass · RLS verified · Arabic-RTL · mobile · audit events · no secrets · Owner reviewed · reviewer approved (High/Critical) · tracker/spec/session updated · rollback documented

## Open gates / decisions needed
> **See [`OWNER-DECISIONS-2026-06-24.md`](OWNER-DECISIONS-2026-06-24.md)** — consolidated path-to-finish with a recommendation per decision (deploy infra, phone-OTP, Stage 0 runbook, B3 cost source, role model, pricing, pilot).
- [x] **Independent security review of the MVP-0 build — DONE + MERGED to main 2026-06-23** (PR #2; `@amrebeid/ui@1.1.0` published via PR #1/#3). On main (migrations `0010`/`0011` + tests `05`/`06`/`07`, **65/65 pgTAP** via the `db-tests` CI gate): GRANT-C1 unauthenticated `anon` DML+EXECUTE incl. the SECURITY DEFINER engine (CRITICAL); RLS-H1 child tables didn't validate parent org (cross-tenant write, HIGH); ENGINE-C1 expiry double-counted (CRITICAL); ENGINE-H1 phantom purchase rec (HIGH); ENGINE-H2/SS/M1; HIGH-1 org_member write lockdown; B4 input validation; B5 coverage-NaN; `fn_post_movement` (B1 RPC primitive); D3 RLS reference-columns. **PR #4 (B1 action rewiring) + PR #8 (D2 ledger-backed `reserved`) MERGED + e2e-verified** — **74/74 pgTAP + the Playwright wedge-loop e2e PASS on the real Supabase stack** (Docker repaired 2026-06-23; the full receipt/issue/reserve/release path now routes through `fn_post_movement`). **Remaining (decision-gated, minor):** D1 FORCE RLS (low value on Supabase — `postgres` is `bypassrls`), B2 inventory role-gating (needs role-model decision — supervisors execute ops), B3 hardcoded execution date/price (needs cost-source decision). — owner: Amr
- [x] **Cloud infra — DONE (2026-06-24):** dedicated non-Zeal Supabase project (`veezkmytervjnpxcrbkw`) + Vercel deployed and LIVE (farm-ui-one.vercel.app + ebeidfarm.business). Auth = email/password (no SMS — phone-OTP/Twilio dropped per Owner). **Supabase DB password + service-role key rotation complete per Owner correction 2026-06-29.** — owner: Amr
- [x] **Supabase `service_role` key + DB password rotation** — Owner confirmed 2026-06-29 that this has been done several times. Do not list it as an open gate again unless the Owner explicitly reopens it. — owner: Amr
- [ ] **Enable Supabase Auth Leaked Password Protection** (HaveIBeenPwned) — a dashboard toggle (advisor item). — owner: Amr
- [x] **Merge PRs #75 and #77** — done earlier; the prod DB has since advanced to `0028` (see banner). — owner: Amr
- [x] **AUTHZ-1 Option B + AP-5 insert-side SoD + ENGINE-DC DB-constraint — RESOLVED (2026-06-25).** AUTHZ-1 Option B = migration `0025` (#146, REST-layer role gate on `plan_operations`/`farm_event`/`event_locations`/`quantities`); ENGINE-DC = migration `0026` (#144, BEFORE INSERT receipt-vs-open-PO trigger); AP-5 insert-side SoD confirmed already merged (migration `0023`, test `21`). All applied to prod (`0028`), pgTAP 217 green. — owner: Amr
- [x] **DELETE/role posture for tenant tables — RESOLVED (2026-06-25):** migration `0027` (#140) `REVOKE DELETE` from `authenticated,anon` on the **27** exposed tenant tables (keeping `plan_checks` deletable for the plan builder); migration `0028` (#142) also `FORCE`s RLS on all 35 RLS tables. Live-verified: DELETE `expenses` as manager → HTTP 403. Full finding in [`SECURITY-FINDING-delete-exposure-2026-06-25.md`](SECURITY-FINDING-delete-exposure-2026-06-25.md). — owner: Amr
- [ ] **Owner sign-off on canonical palm count** (registry says 4,380/299) — owner: Amr
- [ ] **Approve remaining Stage 0 security remediation** (non-Supabase legacy key/history purge cleanup; Supabase DB password + service-role key rotation is complete) — owner: Amr
- [ ] **Confirm 4-vs-5 sector labels** and enterprise/crop list — owner: Amr
- [ ] **Engage a local agronomist** to sign off Academy numbers + Egyptian pesticide registrations — owner: Amr
- [ ] **Schedule 5 design-partner farm interviews** (close the Arabic customer-voice gap) — owner: Amr
- [ ] **Decide EGP pricing & setup-fee** anchors with those farms — owner: Amr
- [ ] **Ratify [`SPEC-0013`](SPEC-0013-commercial-saas-layer.md) (Commercial SaaS Layer)** — esp. **plan tiers + limit dimensions** (farms/area/assets/storage/AI — not per-seat) and **billing provider** (Paymob/Fawry/Kashier/Stripe, gated by EGP support); self-serve trial vs white-glove only; platform-operator identity model. — owner: Amr
- [ ] **WhatsApp owner-approval** — wanted or not? Recurs in external assessments; it is a **Hard Stop** (external send + lethal-trifecta) and SMS/Twilio was dropped from MVP-0. — owner: Amr
- [ ] **Review/accept the BUILT [`SPEC-0015`](SPEC-0015-product-knowledge-system.md) Tier-1 catalogs** ([Feature Registry](FEATURE-REGISTRY.md) + [Business Rules](BUSINESS-RULES-CATALOG.md) + [Domain Dictionary](DOMAIN-DICTIONARY.md), built 2026-06-27 under `/goal`); confirm L4–L5 maturity target (CI-validated/generated) as the long-term goal; sequence Phase 2+ vs SPEC-0013. — owner: Amr
- [ ] **Review + deploy/commit [`SPEC-0014`](SPEC-0014-knowledge-living-documentation.md) Tier A** (BUILT + verified local 2026-06-27 under `/goal`: Help drawer + rule-based "Why?" + Health-Score Vitest guards; tsc/lint/159 green). Remaining = the Owner-gated **commit/deploy** + (optional) a standalone CI lint config; interactive in-browser check pending a logged-in session. Tier C (AI) stays behind Stage 11. — owner: Amr

## Known risks (live register — full version in MASTER-PLAN.md §6)
- **Exposed secret in public repo / accounting sheet** (Gmail + anon key + Vercel project id) — *status: OPEN, Stage 0 fixes it.* 🔴
- **Cross-tenant data leak via weak RLS** — *mitigation: RLS-first, independent review on Stage 1.* 
- **AI assistant lethal trifecta** — *mitigation: read-only RPCs, no mass outbound, untrusted-input handling (Stage 11).*
- **Agronomy/pesticide liability** — *mitigation: templates + expert sign-off (Stage 10).*
- **Real financial/PII data into third-party model** — *mitigation: privacy review before migration (Stage M).*
- **Onboarding friction → churn** (industry #1) — *mitigation: white-glove Arabic onboarding (GTM doc).*
