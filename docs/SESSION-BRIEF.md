# Session Brief — Farm OS      Updated: 2026-06-29 by Codex (Owner: Amr Ebeid)
*Updated LAST, after meaningful work.*

## 2026-06-29 — audit issue hygiene; docs-only status update
**Change.** Reconciled high-signal open audit issues against current `main` and production evidence, then updated
issue threads. Closed #383 as fixed/applied: #402 is merged, migration `0095` is on `main`, `95_org_switcher_preapply`
pgTAP coverage exists, and prod's migration ledger includes `20260622000095 org_switcher_preapply_hardening`.

**Kept open.** #317 remains open because a read-only prod grant probe still shows broad grant/default-privilege
hygiene gaps (`TRUNCATE` on 38 public tables for anon and authenticated, plus limited `DELETE` grants). #229 remains
open as the umbrella for remaining prod-config/advisor cleanup: FK indexes are fixed by `0096`, but grant/default
privilege cleanup and leaked-password protection remain. #188 remains open because #396 merged the reserve-aware
dedup app-layer fix, but the issue still explicitly tracks the migration-gated fully atomic PR-line+reserve RPC
follow-up.

**No prod action.** Deleted one malformed duplicate #317 comment, posted corrected evidence notes on #188/#229, and
ran no DDL, migration, or production data change.

**Follow-up issue hygiene.** Retitled and edited #362 so it no longer reopens Farm Supabase DB password +
`service_role` key rotation. That item is now checked off per Owner confirmation; #362 stays open for legacy keys,
old repo history, spreadsheet/Google password, leaked-password protection, and demo login cleanup before real data.

**UI issue closeout.** Re-checked #282/#206 against current `main` and closed both as resolved/superseded. The
remaining low ExecuteForm cleared-input behavior was split to #426 because deciding whether zero actuals are invalid
for all operation types needs a narrow product/validation decision. No code, DDL, migration, or production data
change was run.

**#426 implementation.** Opened #428 to reject blank/invalid/negative ExecuteForm actual quantity/labor inputs before
calling `executeOperation`, while still allowing an explicit typed `0`. Added pure parser coverage. Local isolated
validation passed: focused Vitest **3/3**, full Vitest **215/215**, focused eslint, `tsc --noEmit`, and production
build. No migration or DDL.

**#398 closeout.** Re-checked #398 against current `main` and closed it as delivered by merged #399
(`02b5da3`): `plan_operations.ends_on`, `plan_operation_assignees`, `fn_add_plan_operation_multi`, pgTAP coverage,
and the `OperationBuilder` UI for repeatable material/labor rows, multi-day dates, employee checkboxes, and lead
selection are all present. Deploy status says prod includes `0090` and `0093`. No DDL, migration, prod apply, or
production data change was run for this closeout.

## 2026-06-29 — #421 SPEC-0018 custody/payment-request draft hardened; not merged
**Change.** Reviewed draft PR #421 (`docs/spec-0018-custody-payment-requests`) for the custody + payment-request
module. Patched the SPEC-0018 draft to avoid embedding precise real finance/worker figures, remove non-existent
roles, keep custody/payment/receipt reads finance-role gated, avoid a broad new `expense.write` permission, make
#368 `expenses.kind`/`0088` an explicit prerequisite or same-apply-path dependency, and require extending
`attachments` for expense receipts before use (`entity_type='expense'`, resolver/storage validation,
finance-confidential RLS).

**Evidence.** #421 branch head `2fa6694`. GitHub checks passed: pgTAP, app/typecheck/lint/test/build,
token/storybook build, gitleaks, Vercel. Focused re-review found no findings.

**Still held.** No merge, migration, deploy, production apply, or real financial/PII import was performed. #421
remains draft/design-only for Owner review and Stage-M privacy gating.

## 2026-06-29 — #368 accounting DB-side summary fix implemented; PR still held
**Change.** Patched held draft #368 (`feat/stage-7-accounting-backend`) so `/accounting` no longer computes P&L
totals from capped PostgREST row reads. Migration `0088` now adds `fn_accounting_pnl_summary`, a
`SECURITY DEFINER` DB aggregate RPC gated by `budget.write`; the page uses that RPC for P&L totals while keeping
the 200-row queries only for recent expense/sale previews. Also added a typed RPC entry, tightened the expense-kind
action guard, and extended pgTAP coverage for aggregate totals, supervisor denial, drawings/capex separation, and
operating category totals.

**Evidence.** #368 branch head `0625150`. Local validation passed: pgTAP **709/709**, `npx tsc --noEmit`,
focused eslint, `lib/pnl.test.ts` **5/5**, and `npm run build`. GitHub checks passed: pgTAP, app/typecheck/lint/
test/build, token/storybook build, gitleaks, Vercel. A session reviewer check found no obvious blocker, but this is
not a substitute for the fresh visible final review required before any merge/migrate. PR body was refreshed to match
this state.

**Still held.** No merge, migration, deploy, or production apply was performed. #368 remains draft pending the real
7-year Excel reconciliation + privacy review, plus fresh pre-migration review of exact `0088` gap-fill and `0097`
apply order.

## 2026-06-29 — autonomous loop + PR #400 review held; PR #412 merged
**Owner instruction.** Keep working in Farm OS until stopped; always plan first, update docs, do deep research when
needed, review before merge, review before migrate, and proceed using recommendations without waiting for more input.
Recorded as a Codex goal and captured in
[`docs/superpowers/plans/2026-06-29-autonomous-farm-pr-review-loop.md`](superpowers/plans/2026-06-29-autonomous-farm-pr-review-loop.md).

**Status correction.** Owner confirmed Supabase DB password + service-role key rotation has already been done
several times. Active docs and the durable operating-method skill now mark rotation complete; do not raise it as an
open gate again unless Owner reopens it.

**PR #400 reviewed and fixed.** In isolated worktree `.worktrees/review-pr-400`, reviewed draft PR #400
(SPEC-0016 export compliance, migration `0092`). Found and fixed impossible compliance-value handling: negative
residue values could pass the pure readiness check, and the schema lacked CHECK constraints for inverted validity
windows and negative area/quantity/residue values. Pushed commit `2e2183d` to the PR branch. Validation passed:
local pgTAP **670/670**, `tsc`, focused eslint, Vitest **175/175**, production build, and GitHub checks. Decision:
keep #400 draft; do **not** merge or migrate `0092` until the lower-number migration lane is reconciled.

**PR #412 reviewed, cleaned, and review blockers fixed.** In isolated worktree `.worktrees/review-pr-412`, reviewed draft PR #412
(import reference resolution). The signed-in-user/RLS commit path and formula-injection template sanitizer looked
sound for this slice, but dry-run validation accepted impossible dates such as `2026-02-31`. Added a failing test,
prepared local commit `21467ad`, and published the same three file contents to `feat/import-refs` through GitHub's
Contents API because local `git push` stalls in `send-pack`/`pack-objects`. Then rebuilt #412 on current `main`
to drop already-merged #410 stacked history, producing a tight import-reference diff. Independent review found two
blockers: archived structure parents could be resolved by code, and row numbers could drift after validation filtered
bad rows. Fixed both at PR head `08e925a`: ref specs for farms/sectors filter `archived=false`, and hidden source-row
metadata preserves original spreadsheet row numbers through ref resolution, dedupe, and RPC failure reporting.
Local validation passed: import suite **41/41**, `tsc`, focused eslint, full Vitest **212/212**, and production build.
Fresh GitHub CI passed, independent re-review approved, and #412 was squash-merged to `main` as `d7b832d`. No
migration or production apply was involved.

## 2026-06-29 — remaining draft migration PRs reviewed; no merge/migrate
**What was reviewed.** Three parallel agents reviewed the remaining open draft migration PRs against current remote
`main` (`0767513`) and prod migration head `0096`: **#366** academy (`0091`), **#368** accounting (`0088` + `0097`),
and **#400** export compliance (`0092`).

**Decision.** Keep all three draft. Do not migrate any of them yet.

**#366 academy.** No obvious current code/security defect found: FORCE RLS, org-scoped policies, `academy.write`
gate, pinned `SECURITY DEFINER` RPCs, anon revoke, authenticated-only execute, and pesticide sign-off controls look
materially fixed. It remains blocked by the real Stage 10 gate: licensed-agronomist + current Egyptian
pesticide-registration sign-off. Merge-before-migrate is also undesirable because `/academy` would be visible while
prod lacks `academy_content`/RPCs; it likely renders empty rather than 500ing because errors are ignored, which is
misleading. Low-risk later fixes: update stale comments that still say "migration 0089" and fail visibly on academy
query errors.

**#368 accounting.** RLS/privacy state looks acceptable after current fixes: `sales` reads and sale audit rows are
budget-write gated, and `0097` closes the symmetric expenses read/audit leak. It remains blocked by the Stage 7
finance gate: real 7-year Excel reconciliation + privacy review. Migration sequencing is also special: prod is
already at `0096` but lacks `0088`, so `0088` is an explicit out-of-order gap-fill and must be handled with `0097`
rather than assumed to flow through a normal latest-migration path. Low-risk later fixes: fail fast on `/accounting`
Supabase query errors and align `/expenses` navigation with the owner/accountant-only read gate in `0097`.

**#400 export.** The `0092` export migration itself is materially review-clean on RLS/schema and now includes
`academy.write` in its `authorize()` union. The blocker is ordering: if `0092` is applied first, then #366's current
`0091` later re-emits `public.authorize()` without `export.write`, export writes would silently break. Safe paths
are: apply #366 `0091` before #400 `0092`; patch #366 `0091` to preserve `export.write`; or add a post-`0096`
repair/backfill migration pinning the final permission union after both features.

**No prod action.** No migration, deploy, or production apply was performed from this review.

## 2026-06-29 — safe branch follow-ups on held #366/#368
**#366 academy branch updated.** Applied the low-risk review follow-ups: `/academy` now checks the Supabase query
`error` and throws a generic failure instead of silently rendering empty content when `academy_content` is absent or
unreadable, and stale migration comments were corrected from `0089` to `0091`. Published through the GitHub API to
branch head `ca915dc`. GitHub checks are green (`pgTAP`, app/typecheck/lint/test/build, gitleaks, Vercel), and a
focused independent check found no blockers.

**#368 accounting branch updated.** `/accounting` now checks both `expenses` and `sales` query errors and throws a
generic failure rather than computing misleading zero/partial P&L. The `/expenses` nav item now matches the `0097`
read gate by showing only to owner/accountant instead of also `farm_manager`. Published through the GitHub API to
branch head `a4d1c7f`. GitHub checks are green (`pgTAP`, app/typecheck/lint/test/build, gitleaks, Vercel), and a
focused independent check found no blockers.

**Still held.** These branch fixes do **not** clear the real gates. #366 remains draft pending agronomist +
pesticide-registration sign-off. #368 remains draft pending real 7-year Excel reconciliation + privacy review and
explicit `0088` gap-fill plus `0097` apply planning. No migration or production apply was performed.

## 2026-06-29 — #366 authorize union patched for #400 ordering safety
**Change.** Patched held draft #366 (`feat/stage-10-academy-backend`) so migration `0091` includes `export.write`
in the `public.authorize(perm, p_org)` re-emit alongside `academy.write`. Test `89_academy_content_test.sql` now
pins the intended mapping: owner and farm_manager keep `export.write`; supervisor does not.

**Why.** This removes the specific #366/#400 ordering trap where applying export `0092` first and backfilling
academy `0091` later would have dropped `export.write`. Adding the permission before export tables exist is inert;
it only preserves the final permission union.

**Evidence.** #366 branch head `86dfa6e`; GitHub checks green (`pgTAP`, app/typecheck/lint/test/build, gitleaks,
Vercel); focused independent check found no blockers.

**Still held.** No merge, migration, deploy, or production apply was performed. #366 still needs the external
agronomist + Egyptian pesticide-registration sign-off; #400 still needs fresh pre-migration review of exact apply
order before any merge/migrate.

## 2026-06-29 — #400 export draft status wording refreshed
**Change.** Updated held draft #400 (`docs/spec-0016-export-compliance`) to remove stale "design only" wording from
SPEC-0016 and the PR body. The branch now states the actual scope: slice 1 schema/RLS/audit and pure readiness code
are implemented on the draft branch, but are not merged or applied to production. The `0092` migration comment now
describes the `authorize()` re-emit as the final known permission union including #366 `academy.write`.

**Evidence.** #400 branch head `dbcfeb8`; GitHub checks green (`pgTAP`, app/typecheck/lint/test/build, gitleaks,
Vercel); focused independent check found no wording blockers.

**Still held.** No merge, migration, deploy, or production apply was performed. #400 remains draft and still needs
fresh pre-migration review of exact prod apply order before any apply.

## 2026-06-28 (latest+6) — Owner "push": 8 review-clean PRs MERGED to `main`; migration PRs HELD (prod still `0089`)
**Where we are.** Owner directed "push". All 18 open PRs were independently reviewed (actor≠reviewer, parallel agents). **8 non-migration, review-clean PRs squash-merged to `main`; CI re-verified green (ci/db-tests/release) after the batch:** SPEC-0017 frontend stack **#405** (spec) + **#406** (CSV export) + **#407** (palm-360) + **#409** (MasterTable; rebased onto `main` after #406 via `rebase --onto`); plus **#395** (registry oracle test), **#396** (#188 reserve-aware dedup), **#390** (06-27 session record), **#392** (SPEC-0004 plan). **Prod unchanged at `0089` — NO migrations applied this session.** The live app receives the FE/app-quality changes via Vercel auto-deploy; no schema change shipped.

**Held (NOT merged) — and why:**
- **Migration PRs need migrate-FIRST (prod apply = Owner's act; not doable from this session — Farm Supabase `veezkmytervjnpxcrbkw` unreachable here, MCP reaches only the Zeal org).** Clean + apply-ready: **#401** `0094` (🔴 C2 go-live blocker), **#402** `0095` (org-switcher), **#404** `0096` (FK indexes). Ordered apply bundle written to scratchpad **`farm-prod-apply-0094-0095-0096.sql`**. Sequence: apply `0094`→`0095`→`0096` → confirm → then merge #401/#402/#404.
- **Blocked on their own issues:** **#399** (`0090`/`0093`) REQUEST-CHANGES — coarse dedup key silently drops a 2nd distinct same-day op (returns success); **#403** REQUEST-CHANGES — seed writes out-of-domain `sex='ذكر'` (must be `'male'`); **#400** (`0092`) apply-coupled to #366's `academy.write`; **#391** needs an Owner design decision (flips the **app-wide** font token).
- **Expert-gated (cannot finish regardless):** **#368** accounting — `0088` is BROKEN (sorts behind `0089`; must renumber ≥`0097`) + real-Excel reconciliation + privacy review; **#366** academy (`0091`; label refs say `0089`/`0087` — reconcile) + licensed-agronomist + Egyptian pesticide-registration sign-off. Both would 500 on prod (tables absent) if merged before migrate. Code quality itself is sound (drawings-vs-opex separation ✓; template-not-prescription ✓).

**Open Owner items.** (1) Apply the 3-migration bundle, then I merge #401/#402/#404. (2) Decide #399 / #391; fix #403. (3) Renumber/reconcile #368/#366 + clear their expert gates. (4) Enable `custom_access_token_hook` + leaked-password protection (dashboard). (5) There are also uncommitted state-doc edits in the local `main` worktree (README/DEPLOY-STATUS/PRODUCT-MASTER/ROADMAP → prod `0089`) — reconcile or discard. **Supabase DB password + service-role key rotation is complete per Owner correction 2026-06-29; do not raise again unless reopened.**

## 2026-06-27 (latest+5) — parallel app-quality + gated-stage-CRITICAL session
**Where we are.** A second session ran the app-quality lane in parallel with the knowledge-system session — all NON-migration / NON-prod. **9 PRs merged to `main`** (#378 i18n, #380 payroll rate-flag, #379 stock-calc↔SQL parity, #381 assistant-gate hardening, #382 weather hardening, #384 display, #385 rtl/a11y, #386 form-validation, #387 perf) — every one CI-green, `main` re-verified green after each merge. Both gated draft PRs **hardened but kept DRAFT**: **#368** CRITICAL sales RLS read-leak + audit-mirror leak fixed (pgTAP 663✓); **#366** CRITICAL pesticide-gate bypass fixed + migration renumbered **`0089→0091`** (collision with the merged palm-guard `0089`; `0090` left free for S2) (pgTAP 669✓).
**Unblocked next.** **#388** (researched wage-model memo) unblocks the SPEC-0006 §5 decision → Stage 8 payroll persistence can proceed once the Owner ratifies the 4-mode / daily-rate-default recommendation.
**⚠️ Verify/fix-forward on prod.** **#383**: the now-applied `0085`/`0086` carry two verified issues — `user_member_org_ids` lacks the explicit `revoke/grant` (anon-executable; low exposure) and `fn_update_org_settings` nulls `fiscal_year_start` when omitted (data-loss). Both are advisor-invisible; verify against deployed prod `0089` and fix-forward if present. *(Now addressed by #402 `0095` — held for migrate-first apply.)*
**Not done (deferred).** No migration/prod-apply by this session; #368/#366 left for the deploy-owner to merge+apply after their human-expert gates; #157 budget + #89 pricing remain Owner decisions.
**Last evidence.** `main` green incl. the 9 PRs + #389; pgTAP 663/669 on the two hardened draft branches; tsc/lint/build 0 across all merged PRs.

## 2026-06-27 (latest+4) — Owner opened the gate: REVIEW → PUSH → MERGE → MIGRATE executed
**Where we are.** The Owner authorized in writing ("review and then push merge and migrate"). All three
gated actions ran, in the safe order (review → push → migrate → merge):
- **Review (actor ≠ reviewer).** A fresh independent code-reviewer agent reviewed the SPEC-0014 Tier A code →
  **APPROVE-WITH-NITS**; the one real nit (missing `closeLabel` on both `Drawer`s → no visible × close) was
  **fixed** (`closeLabel="إغلاق"`). Re-verified: **tsc 0, Vitest 159/159.**
- **Push (the "can't push" assumption was STALE).** A dry-run push to `AmrEbeid/Farm` succeeded — this session's
  identity (`amrabdelglill-pixel`, token scopes `repo`+`workflow`) **does have write access**. Committed the 16
  knowledge docs + SPEC-0014 Tier A app code (junk excluded: the `* 2.md` sync-dupes + local `.claude/`) on branch
  **`feat/knowledge-system-spec0014-tierA`** and pushed it. (PR opened + merged — see below.)
- **Migrate (prod `0084` → `0089`).** Applied the held queue to prod `veezkmytervjnpxcrbkw` via the MCP, **exact
  repo versions** (the tool's stray apply-time version was reconciled in the ledger each time → **0 stray rows**):
  **`0085`** active-org (backward-compatible: no `active_org_id` claim ⇒ `user_org_ids()` returns the FULL set =
  old behavior; fails-closed on a forged claim), **`0086`** org-settings setter, **`0089`** palm archived-hawsha
  guard. **Verified:** all objects exist (`fn_set_active_org`/`fn_update_org_settings`/`custom_access_token_hook`/
  `user_active_org`), `get_advisors` shows **only the pre-existing intentional WARNs** (SECURITY-DEFINER-by-design +
  leaked-password toggle) — **no new regression**. This also **fixes the live org-switcher/settings errors** the
  audit flagged (their RPCs now exist in prod).

**NOT done (deliberately, with reasons).** Did **not** merge draft PRs **#366** (academy `0087`) / **#368**
(accounting `0088`): they carry **unmet human-expert gates** (Stage 7 real-Excel reconciliation + privacy review;
Stage 10 licensed-agronomist + pesticide-registration sign-off) and merging them deploys `/accounting`+`/academy`
which query `sales`/`academy_content` tables **not on prod** → live 500s. They stay draft until those gates clear.

**Still open (Owner-only).** **One manual step to activate active-org:** enable the `custom_access_token_hook` in the Supabase
dashboard (Auth → Hooks) / `config.toml [auth.hook.custom_access_token]` — until then the active_org feature is
inert (safe; full-membership behavior). SPEC-0013 still awaits ratification.
**2026-06-29 Owner correction:** Supabase DB password + service-role key rotation is complete; do not list it as
an open gate again unless the Owner reopens it.

## 2026-06-27 (latest+3) — ground-truth audit (RECONCILE-001) + Commercial layer specced (SPEC-0013) — docs only
**Where we are.** No code/schema/prod change this session — **documentation only**, `main` unchanged at `0089`,
prod still `0084` (HELD). An external commercial-readiness assessment was **reconciled against `main`** and
found to have judged a **stale prototype schema** (the `payment_vouchers`/`farm_tasks`/`seedling_inventory`/
"simple roles, no org isolation"/"Lovable useState prompt" it critiqued exist **only in `docs/03`** or **not at
all** — verified by grep; no `lovable` anywhere). The live product (multi-tenant + RLS + inventory/coverage +
event ledger + planning + PR/approval + attachments + the full operating loop) is **already built + live**.
Produced three artifacts:
- **[`RECONCILE-001-main-ground-truth-2026-06-27.md`](RECONCILE-001-main-ground-truth-2026-06-27.md)** — the new
  **canonical capability map** (37 tables, ~38 RPCs, 26 pages, 89 pgTAP files; capability → evidence + status +
  confidence). Future audits/AI reviews reconcile here, not to legacy docs.
- **[`SPEC-0013-commercial-saas-layer.md`](SPEC-0013-commercial-saas-layer.md)** — the one genuinely-missing
  layer (billing/tiers/limits/onboarding/import/demo/admin/trials/flags), **Draft**, High risk, 8 slices.
- Registered both in PROJECT-TRACKER (new banner + Stage **C** + open gates); a Commercial-Readiness matrix was
  added to the tracker artifact.

**Approved next.** Nothing new built. The standing approved slice remains **SPEC-0012 S2** (member/role admin,
migration `0090`). SPEC-0013 is **Draft — not approved to build** until the Owner ratifies it.

**NOT approved.** Building any SPEC-0013 slice; signing up for any billing provider; touching prod. Applying
`0089`/`0085`/`0086` to prod was Owner-HELD at this point in the timeline. Adding the
`docs/03` legacy banner = done this session (doc-only, Owner-recommended text).
**Superseded 2026-06-29:** Supabase DB password + service-role key rotation is complete; do not raise again unless reopened.

**Active stage.** UX — [`SPEC-0012`](SPEC-0012-account-admin-and-ux-gaps.md). New: Stage **C** —
[`SPEC-0013`](SPEC-0013-commercial-saas-layer.md) (Draft, awaiting ratification).

**Reconcile-first notes.** RECONCILE-001 is the canonical schema reference — use it before trusting `docs/03`
(now banner-marked as carrying legacy/migration-from examples). Migration lanes: `main` at `0089`; SPEC-0012 S2
= next free `0090`; SPEC-0013 lanes come after that.

**Also this session (Owner: "go for both, keep scope tight").** Specced the living-documentation idea as
**[`SPEC-0014`](SPEC-0014-knowledge-living-documentation.md)** — **Tier A only** (per-page `pageMeta` help drawer
answering the 5 questions + **rule-based "Why?"** over `lib/errors.ts` + a Documentation Health Score CI lint);
manual-gen, walkthroughs, videos = deferred Tier B/C; **AI Expert / AI "Why?" hard-gated behind Stage 11**.
Substrate already exists (`lib/nav.ts` page registry, `lib/errors.ts` ~19 rule codes, `docs/user-manual/`).
Amended **CLAUDE.md Definition of Done** to add the Documentation Health Score — **blocking for user-facing
pages/workflows, advisory for internal/admin/infra**, enforced by CI not prose. Registered SPEC-0014 in the
tracker (banner + Stage **K** + open gate). **Still Draft — no build authorised** (no app code/migration/AI).

**Also this session.** Wrote canonical **[`PRODUCT-MASTER-FILE.md`](PRODUCT-MASTER-FILE.md)** (20 sections,
reconciled to `main`) — the single product description for business/product/design/eng/onboarding/AI.
**Reconcile corrections it records (use the master file + RECONCILE-001 as ground truth):** (1) **planned-vs-actual
IS built** (`reports/[planId]/pva`) → RECONCILE-001's "⬜ not built" line is **superseded** (worth a 1-line fix in
RECONCILE-001); (2) **`/accounting`+`lib/pnl.ts`+`sales` and `/academy` are NOT on `main`** — draft PRs #368/#366,
migrations `0087`/`0088` unapplied (RECONCILE-001 cited them as if present → also superseded); (3) **README prod
"`0048`" is stale** — prod `0084` (HELD), `main` `0089`; README needs refresh. Tracker references the master file.

**Also this session.** Wrote **[`SPEC-0015` Product Knowledge System](SPEC-0015-product-knowledge-system.md)** —
a 6-phase "Knowledge Operating System" with a **FEAT/BR/TERM traceability model** + **L0–L5 maturity levels**,
**Tier 1 scoped for build only** (Feature Registry + Business Rules Catalog + Domain Dictionary, code-anchored),
everything else phase-gated by a concrete consumer. Made **[`PRODUCT-MASTER-FILE.md`](PRODUCT-MASTER-FILE.md)** the
**hub** (added §0 Knowledge System Index; body not expanded). **Then (under Owner `/goal` "go ahead, don't stop") — Tier-1 catalogs BUILT (L3).** Via 3 read-only Explore
agents: **[`FEATURE-REGISTRY.md`](FEATURE-REGISTRY.md)** (27 FEAT-IDs), **[`BUSINESS-RULES-CATALOG.md`](BUSINESS-RULES-CATALOG.md)**
(~50 BR-IDs ← ~68 extracted constraints, each → enforcing object + migration + test + FEAT), **[`DOMAIN-DICTIONARY.md`](DOMAIN-DICTIONARY.md)**
(~40 terms, Arabic verified from `lib/labels.ts`/`StructureForm`/`auth.ts`). Master-file hub flipped to ✅; SPEC-0015
tasks T0–T1.3 marked done. **Reconcile fixes:** RECONCILE-001 corrected (planned-vs-actual IS built `reports/[planId]/pva`;
`/accounting`+`lib/pnl.ts` are draft-PR #368, not `main`); README ground-truth banner added (stale "`0048`").
**Did NOT do (Owner-gated / out of safe scope):** any app code/migration/AI/deploy; git commit/push (outward +
this GitHub account can't push to `AmrEbeid/Farm`); the deferred catalogs (Notification/Automation/Import-Export/
Metrics/Training/Customer-Success/AI-Knowledge-Graph) remain Phase-gated. **Then (still under `/goal`) — Knowledge System Phase 2 BUILT (5 engineering catalogs, L3).** Via 3 parallel Explore
agents (RPC signatures, table columns, report internals): [`RPC-CATALOG.md`](RPC-CATALOG.md) (28 RPCs + 9 triggers,
RPC-IDs→BR/FEAT), [`DATA-DICTIONARY.md`](DATA-DICTIONARY.md) (38 tables incl. `user_active_org`, TBL-IDs),
[`PERMISSIONS-MATRIX.md`](PERMISSIONS-MATRIX.md) (perm→roles map + page guards + SoD), [`EVENT-CATALOG.md`](EVENT-CATALOG.md),
[`REPORT-CATALOG.md`](REPORT-CATALOG.md). Surfaced limitations (now documented): dashboards/budget-check use a
hardcoded `SEED_PLAN_ID`; budget-check hardcoded to `أسمدة`; `FilterableTable` exists but isn't wired onto list
pages; no report export. Component catalog = Storybook (linked, not duplicated). **Phases 3–6 remain
consumer-gated** (ops/customer-success/intelligence/executive) — not built.

**Then (still under `/goal`) — SPEC-0014 Tier A content drafted as docs (no app wiring).** [`PAGE-HELP.md`](PAGE-HELP.md)
(5-question help blocks for all pages, A1 content), [`WHY-CATALOG.md`](WHY-CATALOG.md) (rule-based "Why?" mapped from
the real `lib/errors.ts` codes + situations → BR refs, A3 content), [`DOCUMENTATION-HEALTH.md`](DOCUMENTATION-HEALTH.md)
(per-page DoD scorecard; core-loop pages L3; systemic gap = no per-page changelog ⑧, partial manual ⑦).
**16 knowledge docs total.**

**Then (still under `/goal`) — SPEC-0014 Tier A BUILT in app code + verified (first code this session).** Low-risk
(presentational + pure logic; no schema/AI/access): `lib/page-help.ts` (Arabic `pageMeta`), `lib/why.ts` (rule-based
"Why?"; `lib/errors.ts` got an additive `AR_ERROR_CODES` export), `components/HelpDrawer.tsx` + `components/WhyButton.tsx`
(via `@amrebeid/ui` `Drawer`), wired ONCE into `components/AppChrome.tsx` topbar (`activeNavId`). A4 Health-Score =
**Vitest drift-guards** (`lib/page-help.test.ts`, `lib/why.test.ts`). **Verified: tsc 0, ESLint 0, Vitest 159/159.**
**Local/uncommitted; NOT deployed** (commit/deploy Owner-gated; this GitHub identity can't push to `AmrEbeid/Farm`).
Interactive in-browser check pending a logged-in session (shell is auth-gated). Tier C (AI "Why?"/Expert) stays
behind Stage 11.

**Quality gate:** a 4th Explore agent **adversarially verified** 12 high-stakes Business Rules against the actual
migration SQL + tests — **12/12 enforcement claims VERIFIED**; only 2 test-number typos found + fixed (BR-040 test
`33` not `32`; BR-104 test `83` not `81`; FEAT-011 likewise). A 5th agent verified the page access-gates (now in
the master file §6, NV markers removed). **Approved-next:** Owner review/accept of the built Tier-1 catalogs;
decide Phase-2 sequencing vs SPEC-0013.

**Last evidence.** New docs: RECONCILE-001, SPEC-0013, SPEC-0014, SPEC-0015, **PRODUCT-MASTER-FILE.md**,
**FEATURE-REGISTRY.md**, **BUSINESS-RULES-CATALOG.md**, **DOMAIN-DICTIONARY.md**, **RPC-CATALOG.md**,
**DATA-DICTIONARY.md**, **PERMISSIONS-MATRIX.md**, **EVENT-CATALOG.md**, **REPORT-CATALOG.md**, **PAGE-HELP.md**,
**WHY-CATALOG.md**, **DOCUMENTATION-HEALTH.md** (16 knowledge docs); edits: PROJECT-TRACKER (banners +
Stages C/K + gates + master-file/SPEC-0015 refs + Tier-1-built note), CLAUDE.md (DoD), `docs/03` legacy banner,
master-file §0 hub index (+ Tier-1 ✅), SPEC-0015 tasks T0–T1.3 done, **RECONCILE-001 corrections** (PvA built;
`/accounting` draft-only), **README ground-truth banner**, SESSION-BRIEF. Consistency pass: no stale PvA claim,
all hub links resolve, catalog cross-refs dense (FEAT/BR). **Plus SPEC-0014 Tier A app code** (`lib/page-help.ts`,
`lib/why.ts`, `lib/errors.ts` export, `HelpDrawer.tsx`, `WhyButton.tsx`, `AppChrome.tsx` wiring, 2 test files) —
**checks run: tsc 0, ESLint 0, Vitest 159/159 green.** All changes (16 docs + the code) are **local/uncommitted; not
deployed** — commit/push/deploy is Owner-gated + outward (and this GitHub identity can't push to `AmrEbeid/Farm`).

## 2026-06-27 (latest+2) — palm archived-hawsha guard (`0089`, prod HELD) + SPEC-0012 (profile + audit)
**Where we are.** Two merges to `main`, **prod untouched at `0084`**:
- **PR #373** — `fn_save_palm` data-integrity guard: migration **`0089`** (`palm_no_archived_hawsha`, rejects a
  re-parent of a live palm into an *archived* hawsha → `22023`; `search_path=''` + all existing guards intact)
  + pgTAP **test `89`** (9 assns). Independent review (fresh agent): APPROVE-WITH-NITS. Renumbered `0087`→`0089`
  to avoid colliding with in-flight #366(0087)/#368(0088).
- **PR #376** — [`SPEC-0012`](SPEC-0012-account-admin-and-ux-gaps.md) from a market/UX scan: **S3** read-only
  `/profile` + nav; **S1** `/m` offline audit (offline-*tolerant*, NOT offline-*capable* — no SW/PWA/queue).

**Approved next.** S2 (member/role admin) — role model ratified = **existing 5 roles**. Build as a focused PR:
`fn_set_member_role`/`fn_remove_member` (migration **`0090`**, owner-gated, audited) + `/members` UI; the
email-invite sub-task needs an invite-mechanism decision (pending-invite table vs Auth-admin Edge Function).
Access-control → needs independent review.

**NOT approved.** Applying `0089` (or the pending `0085`/`0086` access-control chain) to prod — **Owner HELD**;
do that chain's independent review first. **Superseded 2026-06-29:** Supabase DB password + service-role key
rotation is complete; do not raise again unless reopened.

**Active stage.** UX — [`SPEC-0012`](SPEC-0012-account-admin-and-ux-gaps.md).

**Reconcile-first notes.** Migration lanes are contested by parallel agents — `main` at `0089`; in-flight
#366=`0087`, #368=`0088`; next free = `0090`. Re-check before authoring any migration. Prod head `0084` (2
behind main's `0086`, plus `0089`).

**Last evidence.** PRs [#373], [#376] merged; pgTAP 656/656, tsc clean, `next build` green this session.

## 2026-06-27 (latest+1) — review & merge pass (Owner: "do not wait, review and merge, go ahead")
**Merged to `main` this pass (all CI-green):** #363 ratifications, #364 croquis (Owner merged these two);
then by me — **#372** (docs), **#352** (payroll engine `lib/payroll.ts`), **#356** (AI capability boundary
`lib/assistant-policy.ts`), **#350** (weather, nav conflict resolved). The pure libs + weather + croquis +
docs are now on main.

**Prepared but NOT merged — the two migration PRs (blocked on the prod-apply, by design):**
- **#368** Stage 7 accounting (migration **`0088`**) — rebased on main, nav resolved, **pgTAP 660/660**, build 0.
- **#366** Stage 10 academy (migration renumbered **`0087`→`0089`** to clear the collision with #373's palm-guard
  `0087`) — rebased, **pgTAP 666/666**, build 0.
Both kept **draft** with a "do-not-merge-before-apply" comment: merging deploys `/accounting` + `/academy`
(which query `sales`/`academy_content`) before the tables exist → **500 on live prod**.

**⚠️ PROD IS BEHIND MAIN — `list_migrations` shows prod at `0084`, main at `0086`.** Migrations
**`0085` (active_org) + `0086` (org_settings)** are merged + the app deployed, but **NOT applied to prod** —
so the org-switcher / settings pages may be erroring on the LIVE site right now. **Owner apply queue:
`0085`, `0086`, then `0088` (#368), `0089` (#366); merge #368/#366 after.** I deliberately did **not**
auto-apply migrations to the live multi-tenant prod DB (Owner-only irreversible action; prod-apply is the
Owner's batched process and is mid-queue).

**Still open — the two real-world expert acts (unchanged):** Stage 7 real-Excel reconciliation + privacy
review; Stage 10 licensed-agronomist + pesticide-registration sign-off (`fn_signoff_academy_content` ready
to RECORD a genuine sign-off). Plus independent review before the Stage 8 payroll RPC + Stage 11 AI build.

## 2026-06-27 (latest) — back-half stages advanced to the buildable limit; Owner closed 4 gates; SAFE STOP
**The Owner ratified SPEC-0003 / 0005 / 0006 / 0007 + the 5-sector decision in-session** (the in-writing
Owner act that closes a ratification gate) → recorded in **PR #363**. That closes the gates for Stages
5/8/9/11. Then, per the Owner's "build on synthetic, gated" directive, I built the Stage 7 + Stage 10
frameworks. **Stopped on Owner request** ("safe stop, report, update docs").

**Open PRs (all verified — pgTAP 660–666, tsc/eslint/build 0):**
- **#363** — Owner ratifications (SPEC-0003/0005/0006/0007 + 5 sectors) — docs, ready.
- **#364** — Stage 5 croquis, **re-landed** (the original #347 was orphaned/closed when #344's base branch was
  deleted on merge — the croquis code was NOT on main; cherry-picked clean onto main). **Ready.**
- **#350** — Stage 9 weather (SPEC-0007). **Ready**; go-live = Owner sets `WEATHER_API_KEY`/`WEATHER_API_URL`.
- **#366** — Stage 10 Care Academy editor (migration **`0087`**, draft). Content store + the #4 sign-off gate
  (`lib/academy.ts`) + `/academy`. Editing content RESETS its sign-off; chemical content needs a current reg.
- **#368** — Stage 7 accounting framework (migration **`0088`**, draft). `expenses.kind` (#6) + `sales` +
  P&L engine (`lib/pnl.ts`) + `/accounting`.
- **#352** — payroll computation engine (`lib/payroll.ts`); **#356** — AI trifecta capability boundary
  (`lib/assistant-policy.ts`). Both are the safe cores; the full builds are review-gated (below).

**To merge (order + caveats):** apply migrations **with** the merges (prod was `0084`; `0085`/`0086`
active-org/org-settings merged to main — confirm they're applied to prod first; then `0087` academy,
`0088` accounting). **#366 and #368 both edit `lib/database.types.ext.ts` + `tests/22_security_invariants`
(the SECURITY-DEFINER allowlist)** → whichever merges second needs a **trivial conflict resolution** (both
just add distinct blocks). Closed/superseded: #347 (orphaned→#364), #354 (engine folded into #368), #355
(gate folded into #366).

**STILL OPEN — two real-world expert acts no AI can perform or fabricate (the honest stop line):**
1. **Stage 7** — dual-run reconciliation of one closed season vs the **real 7-yr Ebeid Excel** + a **privacy
   review** (real financials → Stage M). Framework is built + the #6 separation enforced; the figures are
   synthetic (the UI says so).
2. **Stage 10** — a **named licensed Egyptian agronomist** signs off the NPK/pesticide figures + confirms a
   **current pesticide registration**. The workflow to RECORD it is built (`fn_signoff_academy_content`); when
   the Owner has the real sign-off (name + date + registration expiry) it records in one call and Stage 10
   closes. Until then content renders advisory ("قالب استرشادي — راجِع مهندسك الزراعي").

**Also still binding (independent review — actor ≠ reviewer):** the **Stage 8 payroll-run RPC** (PII/payroll)
and the **Stage 11 AI build** (chat route/model/ingest — highest risk) are **ratified but NOT built**; they
need independent review per slice before prod. Stage 8's `labor_logs` + payroll-run RPC on synthetic is the
next buildable slice once a reviewer is named.

## 2026-06-27 (later) — Stages 2/3/4 SHIPPED + applied to prod (`0084`); list search live
- **Frontend audit reconciled:** the MVP-0 UI is essentially complete — every "gap" a scout flagged
  (purchase-recommendation panel, PR-approval UI, palm grid, #187 Arabic error-mapping, CLS loading
  skeleton) was already built. The only genuinely-open, non-blocked polish was **list search/filter**.
- **Merged to `main`:** **#346** (reusable `FilterableTable` + unit-tested `lib/filter.ts`; inventory +
  purchase-request lists), **#344** (Stages 2/3/4 — editable structure, 360 media, ad-hoc events, plan
  builder), and **#351** (plans-list search follow-up). Combined `main` build green.
- **Prod DB pushed `0080`–`0084`** via the Supabase MCP (each under its **exact repo version** in a
  `BEGIN/COMMIT` txn + ledger insert — **0 stray/off-version rows**). Then **`storage-policies.sql`** applied
  (private `farm-media` bucket + 2 org-scoped `storage.objects` policies) so the media gallery works
  end-to-end. **Prod head = `0084`, in sync with `main`.** Verified: 5/5 recorded, struct/event/plan RPCs +
  `attachments` table + forced RLS live; `get_advisors` shows **only pre-existing WARNs** (the intentional
  SECURITY-DEFINER-granted-to-authenticated pattern; gate enforced in-DB via `authorize()`).
- **Owner-gated next (per PROJECT RULES — actor ≠ reviewer):** independent review on the `0081`/`0084` RLS
  re-emits (structure/plans `tenant_all` now gate direct-REST writes on `structure.write`/`plan.write`);
  regen `database.types.ts` against prod `0084` (new objects currently augmented in
  `lib/database.types.ext.ts`). **Superseded 2026-06-29:** Supabase DB password + service-role key rotation is
  complete; do not raise again unless reopened.

## 2026-06-27 — Stages 2/3/4 built + RECONCILED onto `main` (verified); branch ready to push
- Built editable farm structure + 360 pages + media (Stage 2), ad-hoc activity recording (Stage 3), and
  plan creation/assign/labor + `/plans` (Stage 4) — but on a **stale 0050 base** that collided with the
  already-merged `0051`–`0077`. **Reconciled:** renumbered to migrations **`0078`–`0082`** (tests
  `80`/`81`/`82`), **rebased onto `origin/main` (prod `0077`)** on branch
  **`feat/stages-2-3-4-structure-events-plans`** (1 ahead / 0 behind).
- **Verified on the rebased branch:** pgTAP **627/627**, `tsc` OK, Vitest **110/110**, `next build` green.
  One real fix the reconcile caught: explicit `grant ... on attachments to authenticated` (audit-leak
  invariant). Details: [`RECONCILE-stages-2-3-4-to-0077.md`](RECONCILE-stages-2-3-4-to-0077.md).
- **Owner-gated next (NOT done — external):** push the branch + open a PR (CI incl. the duplicate-migration
  guard now passes); after merge, apply `0078`–`0082` + `storage-policies.sql` to prod + regen
  `database.types.ts`; independent review on the `0079` RLS re-emits per PROJECT RULES.
- Prod/GitHub/Vercel are themselves in sync at `0077` (audited this session; `farm-ui-one.vercel.app` serves
  the live app). `database.types.ts` reconciles to prod — the new objects live in `lib/database.types.ext.ts`.

## 2026-06-26 (latest) — PRs #318/#321 merged; prod pushed to `0073`; live site verified
After the 360 review: **PR #318** (landing fabricated-KPI removal + 6-form offline handling + migration
drafts) and **PR #321** (renumber, resolving a 0070/0071 dup-version collision with concurrent #319/#320)
merged to `main`. The 360 draft **0072 (revoke anon EXECUTE on authorize/user_org_ids) was dropped** — it
broke pgTAP INV-1, which deliberately pins those two anon-executable (RLS policies call them for anon
queries too); the advisor 0028/0029 WARN is a known false-positive. Then **applied `0067–0073` (7) to prod**
via the MCP — prod head now **`0073`, in sync with `main`** (verified: 7/7 recorded, 0 dup/stray versions,
CHECKs/trigger/policies live, `get_advisors` no new regressions). **Live site verified:** Vercel prod
deploy on the merge succeeded; landing page now shows no fabricated KPI tiles, login renders clean, no
errors. The remaining tracked items are unchanged (#270 C1/C2 engine, #157 budget, #317 grants, #161 parity).

## 2026-06-26 — prod push 0049→0066 + deep 360 review
**Local was 97 commits behind origin** (HEAD #185 vs origin #311) — fast-forwarded to `4ac73b1`. The
work since the prior brief was overwhelmingly DB-layer + docs (security/integrity hardening) and subtle
app-code, and the DB half was un-applied on prod — which is why the live site "looked unchanged" despite
heavy activity.

**Prod-DB push (Owner-authorized in writing):** applied migrations **0049–0066** (18) to prod
`veezkmytervjnpxcrbkw` via the Supabase MCP (DDL + ledger row per file; the one `apply_migration` stray
apply-time version was corrected so every version matches its file). **Prod head = `0066`, in sync with
`main`.** Verified live: 18/18 recorded, 5 new audit triggers, 6 new CHECK constraints, write-gates live;
`get_advisors` shows **no new** regressions. Turnkey record: `RUNBOOK-prod-push-0049-0066-2026-06-26.md`.

**Deep 360 review (6 parallel reviewers)** — full writeup: `REVIEW-360-2026-06-26.md`. Verdict:
substantive holes closed; short precise remainder.
- **Fixed in branch `docs/push-prep-0049-0066` (PR open, Owner-gated):** removed landing-page
  dashboard KPI tiles (`app/page.tsx` — hardcoded; for palms they show the canonical 4,380 while the
  registry import never happened, #239 — Owner may re-add as static brand copy); offline `try/catch`
  added to 6 mutation forms (only ExecuteForm had it); migration **drafts 0070** (inventory_items
  safety_stock/pack_size CHECK) + **0071** (palm_status_history write-gate). App validated: lint 0,
  tsc 0, 110/110 tests. **0070–0071 NOT applied to prod** (new migrations → PR review + pgTAP, then
  Owner applies). *(Draft 0072 — revoke anon EXECUTE on authorize/user_org_ids — was WITHDRAWN: pgTAP
  INV-1 deliberately pins them anon-executable since RLS policies call them for anon queries too; the
  advisor 0028/0029 WARN is a false-positive.)*
- **Closed (verified fixed on prod 0066):** #306 (cross-org FK sweep), #280 (F2/F4/F5).
- **Still open / tracked:** #270 **C1** (fn_post_receipt keys received_qty by item_id not line id →
  phantom on_hand with duplicate same-item lines) + **C2** (overdue PO projected as supply) — both
  verified real, need a tested PR; #157 (budget guardrail not table-backed + NULL est_cost=0); **#317
  (new)** (default privileges re-grant anon/authenticated CRUD+TRUNCATE on post-0027 tables); #161
  (SQL↔TS engine parity drift, latent).
- **Recommended next (one PR each):** merge this PR + apply 0070–0071 → #270 C1/C2 engine fix (pgTAP)
  → #157 budget → #317 grant lockdown.

## 2026-06-26 — ✅ `0048` contact-PII lockdown PUSHED + verified; #173/PII-1 now FULLY closed; prod `0048`, in sync with `main`
- **#173 — PII-1 phone/email slice** → **`0048`** contact_pii_lockdown: deny-by-default on `people`
  (`revoke select on people from authenticated` + re-grant all columns **except** phone/email; the phone column is
  retained for service-role linking). Pushed to prod + verified — members can no longer read phone/email; non-PII
  columns still readable.
- **#173 / PII-1 is now FULLY DONE — both halves**: the wage slice (`0046` people_compensation) and the contact
  slice (`0048`). It is **no longer an open / remaining item.**
- Verified: `list_migrations` → `20260622000048`; **pgTAP 421/421** (Docker-free shim harness), all green.
- **Prod is now at `0048`, in sync with `main`.**
- **Remaining (Owner-decision / human-only):** #157 chart-of-accounts, #199 reserveQty semantics, #239 registry
  data (open Owner decisions). *(#173 phone/email is DONE; the old key-rotation red item was superseded by the
  2026-06-29 Owner correction confirming Supabase DB password + service-role key rotation is complete.)*

## 2026-06-26 — ✅ `0047` engine null-date guard PUSHED + verified; prod now `0047`, in sync with `main`; app swept clean
- **#198 — ENGINE null-date guard** → **`0047`** engine_nulldate_guard: `fn_stock_coverage` now coalesces a
  NULL `planned_at` to period 1, so null-dated demand is never silently dropped. Pushed to prod + verified —
  it's a no-op for dated ops (potassium recommendation unchanged at **600**, confirming behaviour is preserved).
- **App-only (no migration):** the `/m` field-view fixes (#268 — dropped a hardcoded plot name, corrected the
  "today" heading, subtype-derived execute defaults) and the plans-page fixes (#269 — plan-block labeled by the
  real cause budget-vs-stock, not-found guard, stepper state).
- **Comprehensive app bug-sweep** this session confirmed auth / middleware / inventory / farm-sector / all
  action files **clean** — the whole app is now swept.
- Verified: `list_migrations` → `20260622000047`; **pgTAP 415/415** (Docker-free shim harness), all green.
- **Prod is now at `0047`, in sync with `main`.**
- **Remaining (Owner-decision / human-only, unchanged):** #199/reserveQty + #173 phone/email half + #157
  chart-of-accounts (open Owner decisions), #239 registry data. *(The old key-rotation red item was superseded by
  the 2026-06-29 Owner correction confirming Supabase DB password + service-role key rotation is complete.)*

## 2026-06-26 — ✅ the `0042`–`0046` batch MERGED + PUSHED to prod + verified; prod now `0046`, in sync with `main`
Five migrations landed, were pushed to the prod Supabase (`veezkmytervjnpxcrbkw`) via the MCP, and verified:
- **The Owner's RLS role-gate trio** — **`0042`** plan_req_rolegate, **`0043`** budget_rolegate, **`0044`**
  expenses_rolegate: WITH-CHECK role gates on the plan-req/budget/expenses tables, closing the same
  no-role-gate class as B2 / AUTHZ-1 (org-scoped but ungated writes).
- **#155 partial receipts** → **`0045`** (SPEC-0009): `received_qty` + `partially_received` + a
  remaining-based projection, **plus the `received_qty` column-UPDATE lockdown the independent review caught**
  (clients can't hand-edit received quantities outside the receipt RPC).
- **#173 PII-1 wage confidentiality** → **`0046`** people_compensation: a `payroll.read` perm
  (owner/accountant) + a role-gated `people_compensation` table; the leaking `people.rate` column dropped.
- Verified: `list_migrations` → `20260622000046`; **pgTAP 411/411** (Docker-free shim harness), all green.
- **Prod is now at `0046`, in sync with `main`.**
- **Remaining (Owner-decision / human-only):** #173 **phone/email half** (open PII-access decision), #157
  chart-of-accounts, #239 registry import, #199/#198 held low-value/design items. *(The old key-rotation red item
  was superseded by the 2026-06-29 Owner correction confirming Supabase DB password + service-role key rotation is
  complete.)*

## 2026-06-26 — ✅ palm-status RPC `0039` + ENGINE-REC1 `0040` + unit_cost `0041` MERGED + PUSHED; prod now `0041`; #241 app-fix batch
Three migrations + one app-only batch closed and live in prod; prod is back in sync with `main`:
- **#238 — palm-status RPC** → **Migration `0039`** (`fn_update_palm_status`): an op.execute-gated atomic
  SECURITY DEFINER RPC for palm-status changes. Merged → pushed → verified.
- **#184 — ENGINE-REC1** → **Migration `0040`** (`engine_rec1_fix`): removed the recommendation's period-1
  receipts double-subtract. Merged → pushed → verified.
- **#89-B — inventory unit_cost** → **Migration `0041`** (`inventory_unit_cost`): manual `unit_cost`, NULL
  when unknown, removes the fabricated `*84`. Merged → pushed → verified.
- **#241 — app-only fix batch:** `runPlanChecks` budget now scoped to fertilization (the #190 parity bug);
  hawsha Arabic label; pct locale leaks fixed. No migration.
- All three migrations applied to prod via the MCP and verified: `list_migrations` → `20260622000041`,
  RPCs present + gated, `get_advisors` only pre-existing WARNs. **Prod is now at `0041`, in sync with `main`.**
- **pgTAP is now 356** (Docker-free shim harness + CI), all green.
- **Remaining is now Owner-decision / human-only:** #155/#157 chart-of-accounts, #239 registry import, #173
  PII, plus held low-value/design items #198/#199/#188. *(The old key-rotation red item was superseded by the
  2026-06-29 Owner correction confirming Supabase DB password + service-role key rotation is complete.)* Nothing
  auto-buildable is open.

## 2026-06-26 — ✅ #196 atomic plan-op (migration `0038`) MERGED + PUSHED; prod `0038`; review-sweep actioned
The atomic plan-operation RPC is closed and live in prod:
- **#196 — `addPlanOperation` was non-atomic / non-idempotent** (CREATE-2). **Migration `0038`**
  (`fn_add_plan_operation`) adds a single SECURITY DEFINER RPC that inserts the plan-operation atomically
  (gated, claim-first); the app's `addPlanOperation` now routes through it. **PR #196 merged → pushed to
  prod** via the MCP (recorded under repo version `20260622000038`) → verified: `list_migrations` → `0038`,
  the RPC present + gated, `get_advisors` only pre-existing WARNs. **Prod is now at `0038`, in sync with `main`.**
- **Review-sweep findings actioned:** the budget wrong-ops fix is **in flight**; **#238** (palm-status) and
  **#239** (registry-import) filed for follow-up.
- **pgTAP is now 338** (Docker-free shim harness + CI), all green.
- **Next:** the budget wrong-ops fix (in flight); then triage #238 / #239. *(The old key-rotation red item was
  superseded by the 2026-06-29 Owner correction confirming Supabase DB password + service-role key rotation is
  complete.)*

## 2026-06-26 — ✅ AUTHZ-3 (#182) fixed + MERGED + PUSHED; prod now `0037`; SPEC-0002 set COMPLETE
The full SPEC-0002 authorization-enforcement set is now closed and live in prod:
- **AUTHZ-3 / #182 — `fn_post_movement` was `authenticated`-callable with no role gate** (any member could
  move their org's stock). **Migration `0037`** makes it an INTERNAL primitive (`revoke execute from
  authenticated`; the SECURITY DEFINER callers still reach it via the owner's grant) and adds a gated
  **`fn_reserve_stock(item,qty,plan)`** wrapper (`authorize('inventory.write', v_org)`) — the one client
  reserve entry point. App: `reserveStock` → `fn_reserve_stock`; an up-front `inventory.write` gate added
  to `createPurchaseRequestFromShortage` (also closes the #188 authz-orphan). Gate choice = `inventory.write`.
- **Process:** worktree-agent build → **independent review** (confirmed none of the 7 adapted tests
  weakened an invariant — test 10 now `throws_ok 42501`, test 22 adds a negative pin; reviewer also caught
  a `0036` migration-number collision with #230, renumbered → `0037`) → full pgTAP **326/326** (test 37 =
  10 assertions) → **PR #231 merged** → **pushed to prod** (`0036` perf indexes + `0037`) → verified:
  `fn_post_movement` no longer authenticated-executable, `fn_reserve_stock` gated + callable, advisors clean.
  Removed a duplicate non-repo perf-index record (`20260626053743`) so prod history == repo. **#182 closed.**
- **Prod is now at `0037`, fully in sync with `main`.** This session shipped to prod, in order:
  `0032`/`0033` (locks/CONC-1), **`0034`** (ENGINE-STALE-1 #197 shortage-mask), **`0035`** (AUTHZ-2 #181),
  `0036` (FK perf indexes #230), **`0037`** (AUTHZ-3 #182). Two HIGH bugs + the full authz set, all live.
- **Decision memos filed (Owner input needed)** on **#155** (partial receipts → recommend line-level
  `received_qty`; DRAFT SPEC-0009 exists), **#157** (budget gate display-only → make figures live then
  enforce in RLS), **#89** (price source → pick catalog/last-paid/manual; the `needed_by`+`reserveQty`
  correctness half is being shipped separately).
- **Next codeable (in flight / queued):** #89 `needed_by`/`reserveQty` correctness fix (app-only, no gate);
  then the engine follow-ups #188/#196 (atomic-RPC orphan fixes) and #198 (null-date, conservative).

## 2026-06-26 — ✅ AUTHZ-2 (#181) fixed + MERGED + PUSHED; prod now `0035`
Under full Owner autonomy (the Stop-hook directive: review→merge green PRs, push, don't wait), built +
shipped the second HIGH security fix end-to-end:
- **AUTHZ-2 / #181 — `authorize()` was not org-scoped** → a multi-org member could exercise a privileged
  role in an org where they hold only a low role (cross-org privilege escalation). **Migration `0035`**
  (`authorize_org_scoped`) adds the org-scoped overload `authorize(perm text, p_org uuid)` (`m.org_id =
  p_org`), repoints all 7 RLS policies + `fn_execute_operation` + `fn_post_receipt` (re-emitted from the
  0029 body, ENGINE-DC marker intact), and **drops the 1-arg fn last** (un-migrated callers fail closed).
- **Process:** worktree-agent implementation → **independent fresh-context review** (caught a real
  test-pin bug — test 22's `has_function_privilege('authorize(text)')` would error post-drop; fixed) →
  full pgTAP **315/315** (test 36 proves escalation blocked + single-org access retained) → **PR #227
  merged** → **pushed to prod via MCP** (atomic) → verified: `list_migrations` → `0035`, all 7 policies
  call the 2-arg authorize, RPCs org-scoped, `multi_org_members = 0` (zero behavior change on current
  single-org data — a latent-hole closure ahead of multi-tenant), `get_advisors` only pre-existing WARNs.
  **#181 closed.**
- **Prod is now at `0035`, fully in sync with `main`.** Both HIGH issues this session (#197 shortage-mask,
  #181 authz escalation) are fixed AND live in prod.
- **Next security slice = #182 (AUTHZ-3):** `fn_post_movement` is `authenticated`-callable with no
  `inventory.write` gate (the app calls it directly for `reserve`). Fix = a gated `fn_reserve_stock`
  wrapper + revoke `fn_post_movement` from `authenticated`. Paired with SPEC-0002; changes the live
  reserve write path, so test + review carefully before the prod push.

## 2026-06-26 — ✅ PROD PUSHED to `0034`; live app no longer has the shortage-mask
Owner directive escalated to full autonomy incl. prod ("go ahead with recommendations, do not wait").
Pushed the pending migrations to the prod Supabase (`veezkmytervjnpxcrbkw`) via the MCP, one at a time,
recorded under their exact repo versions:
- **`0032`** `pr_items_lock_and_version_bump`, **`0033`** `fn_post_movement_floor_lock` (CONC-1),
  **`0034`** `engine_stale_po_guard` (ENGINE-STALE-1 #197 — the empirically-proven shortage-mask).
- **Verified live:** `list_migrations` → `0034`; `fn_stock_coverage` contains the `needed_by >=
  v_period_start` guard; `fn_post_movement` has the `FOR UPDATE` lock; the 2 new PR triggers exist;
  baseline potassium coverage returns `shortage:true` + the correct Arabic message; `get_advisors`
  (security) shows only **pre-existing** WARNs (SECURITY DEFINER RPCs by design / #182 / leaked-pw toggle)
  — no new regressions. **Prod is now in sync with `main` at `0034`.** No prod data was mutated to test
  (verified via function definitions, not by injecting rows).
- **Remaining Owner-only items:** reset the demo password; enable Leaked-Password-Protection; ratify SPEC-0002/0003; the HIGH
  product forks (#155/#157/#173/#89/#181/#182/#184); the gated engine follow-ups (#188/#196/#198/#199).
  *(Supabase service-role key + DB password rotation was superseded by the 2026-06-29 Owner correction confirming
  completion.)*
- Docs (this PR) bumped prod `0031`→`0034` across README / TRACKER / DEPLOY-STATUS / ROADMAP.

## 2026-06-26 (later) — autonomous fixes MERGED to main + ENGINE-STALE-1 fixed; prod push (now done above)
The "keep working" session below moved from propose-only to **review→merge** (Owner directive: review
then merge green PRs, don't wait). All landed on `main` (CI green; some merged by the Owner in parallel):
- **#189** docs reconciliation (prod=`0031`), **#191** AR-ERR-1 (Arabic error mapping), **#195** op-status/
  date Arabic + plan-check false-pass guard, **#203** sector-page Arabic — all app-layer, merged.
- **#202 — ENGINE-STALE-1 (#197), migration `0034`:** the HIGH, **empirically-reproduced** shortage-mask —
  `fn_stock_coverage` projected an overdue approved PO (`needed_by < v_period_start`) as period-1 supply
  via `greatest(bucket,1)`, hiding a real shortage (live-triggerable via the #89 past `needed_by`). Fix =
  one guard `and pr.needed_by >= v_period_start` (faithful 0018 copy; strictly conservative — only reveals,
  never hides; independent-review + pgTAP `35` + full shim **290/290**). Closes #197.
- **Owner-merged in parallel:** #183 (SPEC-0002 consolidation, docs), **#186 (Stage 2 farm-structure)**,
  #190 (budget gate uses real plan-op cost), #201 (turnkey runbook).
- ⚠️ **GOVERNANCE FLAG — Stage 2 (#186) merged while SPEC-0003 was DRAFT and 4-vs-5 sectors was OPEN.**
  Test `34_registry_reconciliation_oracle` now asserts **5 sectors** + per-sector counts as truth. Merging
  it effectively ratifies 5 sectors — **confirm that's intended** (the registry import itself is still a
  separate Owner-gated apply on real data).
- 🔴 **Prod push still PENDING (the one action held for an explicit Owner go):** prod DB is at **`0031`**;
  `main` is now at **`0034`**. **`0032`/`0033`/`0034` are NOT on prod.** Until `0034` is pushed, **the LIVE
  app still has the ENGINE-STALE-1 shortage-mask.** `0034` is a core-engine change → ratify before push
  (the `0018` precedent). This is a direct prod-DB mutation (not a PR merge), so it awaits an explicit
  "ratified, push to prod" — say it and the push + verify happens.
- **Follow-up issues filed (gated):** #188 CREATE-1-RESERVE, #196 CREATE-3, #198 ENGINE-NULLDATE-1,
  #199 ENGINE-RESV-1, + #197 residual (forward-anchoring). Plus the pre-existing HIGH forks
  #155/#157/#173/#89/#181/#182/#184.
- **Local toolchain now present:** Node 26 + Postgres 17 + pgTAP (built) — `tsc`/`eslint`/`vitest`/
  `next build` + the full pgTAP shim (`290/290`) all runnable locally.

## 2026-06-26 — prod-state reconciliation + app-layer audit (read-only; docs + issues only)
Autonomous "keep working" session under `amr-operating-method` (propose → validate → report; no
self-merge, no prod push). No app code or schema changed on `main`; deliverables are this doc
reconciliation (un-merged PR) + filed issues. Key results:
- **Prod migration state live-verified.** Queried prod Supabase (`veezkmytervjnpxcrbkw`) via
  `list_migrations`: **prod is at `0031`** (`fn_post_movement_stock_floor`) — `0001–0013` + `0015–0031`.
  Repo `main` is at **`0033`**; **`0032`** (`pr_items_lock_and_version_bump`) + **`0033`**
  (`fn_post_movement_floor_lock`, CONC-1) are verified on `main` but **NOT pushed to prod** (Owner-gated).
  This **corrects the stale `0029` figures** in the older entries below (and `0023`/`0028` in the READMEs
  / tracker Stage-P row) — those were mid-push or lagging snapshots. **Authoritative prod state: `0031`.**
- **Docs reconciled (un-merged PR `docs/reconcile-state-2026-06-26`):** README (`0023`→`0031`, ui
  `v1.1.1`→`1.2.0`, `74`→`287` pgTAP), app README (`0023`→`0033`), PROJECT-TRACKER (Stage-P row +
  new banner → `0031`), DEPLOY-STATUS (removed the stale "Phone-OTP via Twilio = intended auth" item
  that contradicted the same file's NO-SMS decision; `270`→`287` pgTAP), ROADMAP (`0029`→`0031`; pending
  push is `0032`/`0033`, not `0030`–`0033`; `#156` marked CLOSED, `#181` AUTHZ-2 added to the HIGH forks).
- **App-layer audit + review sweep — findings filed AND the non-gated ones fixed** (un-merged PRs, per
  `amr-operating-method`):
  - **#187 — AR-ERR-1 (MED, non-gated) → FIXED in PR #191:** several PR/plan/coverage server actions
    returned raw English `error.message` to the field UI on un-mapped paths (violates non-negotiable #2).
    Wired the existing-but-unused `lib/errors.ts` `toArabicError` into all 9 leak sites + added
    `lib/errors.test.ts` (7 tests). Verified local: tsc 0, eslint 0, vitest 82, next build OK. CI green.
  - **Review sweep → PR #195 (non-gated, FIXED):** (a) operation status rendered **raw English**
    (`planned`/`approved`/`done`) in the status pills on the plan-detail table + manager dashboard — added
    `lib/labels.ts` `OP_STATUS_AR` (aligned to `SimpleTable.statusFor` for correct pill colour) + `fmtDate`
    on `planned_at`; (b) **`runPlanChecks` swallowed read/RPC errors** → could persist a false-pass
    stock/budget check that **masks a shortage**; now aborts on those errors. tsc/eslint/vitest/next build green.
  - **#196 — CREATE-3 (MED, gated):** `addPlanOperation` can orphan a `plan_operation` on partial failure;
    the dedup misses it on retry → over-counts the budget check. Needs an atomic RPC → independent review.
  - **#188 — CREATE-1-RESERVE (MED, review-gated):** `createPurchaseRequestFromShortage` inserts PR+line
    then reserves; if reserve fails post-insert, the retry dedup branch returns the PR **without
    re-reserving** → orphaned (un-reserved) PR. Engine-adjacent → independent review required.
  - **#89 (existing) — commented:** the hardcoded `needed_by: "2025-07-08"` (coverage/actions.ts:105)
    has an **engine-projection consequence** (a wrong/null `needed_by` silently drops the PO from
    `fn_stock_coverage` scheduled-receipts) — suggested splitting the date fix from the pricing decision.
  - **Deferred (not done):** the `farm/sector/[id]/page.tsx` raw-status/date findings — that file is being
    reworked on `feat/stage-2`, so fixing it now would conflict.
- **Unratified Stage 2 WIP preserved.** A local-only branch **`feat/stage-2-farm-structure`** (also on
  origin) holds farm-structure read-views (hawsha drill-down + farm/sector timelines) + a registry
  reconciliation oracle (`tests/34_...sql`) that **hardcodes 5 sectors** — but 4-vs-5 is an **open Owner
  decision** and SPEC-0003 is **DRAFT**. Do **not** merge before SPEC-0003 ratification + the sector call.
  `lib/errors.ts` is committed there but unwired.
- **Toolchain installed:** this machine had no Node/Docker; installed **Node v26.4.0 + npm 11.17.0** via
  Homebrew + ran `npm install` (root). `tsc`/`eslint`/`vitest`/`next build` are now runnable locally;
  **pgTAP still cannot run locally** (no Postgres/Docker — the shim needs `psql`), so the `287` figure is
  the latest committed harness run, not re-run this session.
- **State:** `main` unchanged (origin HEAD `e35c46b`); **4 open PRs, all un-merged for the Owner gate:**
  **#183** (SPEC-0002 consolidation, DRAFT, green), **#189** (this docs reconciliation), **#191** (AR-ERR-1
  fix, CI green), **#195** (op-status/date Arabic + plan-check safety). New issues this session: **#187**
  (fixed by #191), **#188**, **#196**. Owner-gated next moves unchanged: push `0032`/`0033`;
  ratify SPEC-0002/0003; merge the 3 ready fix/docs PRs; the HIGH forks (#155/#157/#173/#89/#181).
  *(The old key-rotation red item was superseded by the 2026-06-29 Owner correction confirming Supabase DB
  password + service-role key rotation is complete.)*

## 2026-06-25 — adopted amr-operating-method + independent review (5 findings) + repo relocation
**Working method:** adopted **`amr-operating-method`** (the gated protocol — propose → validate →
report → **STOP**, owner gates merges/migrations; no self-merge). Going forward, findings are filed
as issues + un-merged PRs for the Owner to gate.

**Repo relocated (Owner request):** the working copy is now **`~/projects/farm`** (old `~/farm-os-ui`
deleted; local `.env.local` + `.vercel/` migrated; verified functional — tsc + pgTAP 287/287). A
personal skills inventory was generated at `~/skills.md` (+ regen script `~/.claude/gen-skills.mjs`).

**Independent read-only security + core-engine review — 5 findings (1 fixed, 4 filed; all fixes
Owner-gated):**
- **CONC-1** ✅ fixed + merged (#168, migration `0033`): the #159 stock floor was a TOCTOU under
  concurrency; added `SELECT … FOR UPDATE` to serialize movements per bin.
- **AUTHZ-2** (#181, HIGH·latent): `authorize(perm)` is **not org-scoped** → a multi-org member can
  exercise a privileged role in an org where they hold only a low role. Violates Stage-1 acceptance.
- **AUTHZ-3** (#182, MED): `fn_post_movement` is `authenticated`-callable with **no `inventory.write`
  check** (definer bypasses table RLS; `0030` removed the only gated path) → B2's control isn't
  enforced on the real write path. Fix = revoke from `authenticated` + a gated reserve wrapper.
- **ENGINE-REC1** (#184, MED–HIGH): the purchase recommendation **double-subtracts period-1
  scheduled receipts** (shortfall is already net of them) → emits `shortage=true` **and**
  `recommend_qty=0` + "stock sufficient" — a contradictory, shortage-masking output (SPEC-0001 #1 risk).
- **PII-1** (#173, MED): `people.rate`/phone/email org-readable by any member (no role gate); fix
  designed in SPEC-0006.
- **SPEC-0002 updated** to consolidate AUTHZ-1/2/3 + PII-1 and correct a now-false claim
  (`fn_post_movement` is *not* gated) → **PR #183 (OPEN, awaiting your gate — not merged).**

**Confirmed sound:** auth/route boundary (middleware + `requireMembership` redirect + per-action
self-protect + only one guarded `api` route), `op.execute` enforcement (`0020`/`0025`), SoD (AP-5),
`fn_post_receipt` atomicity + concurrency-safe claim, delete-posture (`0027`), `audit_log`
immutability (AP-4), `authorize` injection-safety, PvA variance math.

**Theme across the authz findings:** *role/permission gates must be enforced at the definer-RPC/data
layer and **org-scoped** — not on table RLS that definers bypass, nor globally across a user's
memberships.* Natural next step: ratify the expanded SPEC-0002 (#183) → build the enforcement
migration in gated slices. **Open queue for the Owner:** issues #173/#181/#182/#184, PR #183; plus the
still-pending prod push of `0030`–`0033` (now incl. CONC-1 `0033`).

## 2026-06-25 — Arabic error-mapping thread closed (#178–#180 merged)
Finished mapping every RPC-calling field action's Postgres SQLSTATEs to Arabic, so a DB-raised error
never leaks raw English to field users (non-negotiable #2). All three **merged to `main`**, all CI
green (app typecheck/lint/test/build, pgTAP, Storybook, CodeRabbit, Vercel):
- **#178** — `executeOperation`: map `23514` (insufficient stock) → «المخزون غير كافٍ لتنفيذ هذه الكمية».
- **#179** — `reserve` (coverage): map the reserve-RPC errors → Arabic, consistent with #178.
- **#180** — `recordReceipt`: map `22023` → «بند في الطلب يحمل كمية غير صالحة». The last raw-message
  fall-through: a malformed PR line (qty ≤ 0) makes `fn_post_movement` raise `22023` via the
  `fn_post_receipt` chain (type is the constant `'receipt'`, so `22023` here can only mean bad qty —
  the message is precise). **App-layer only — no migration, no engine/RLS surface touched.**
- **State:** all merged; `main` green (HEAD `b0aaf3b`); **no open PRs**. ⚠️ **prod still at `0029`**
  (unchanged by this thread — these are app-code-only, ship via the Vercel deploy on merge). The prod
  push of `0030`–`0033` (incl. CONC-1) remains Owner-gated, as do the items below.
- **Stale branches** (not on critical path): `docs/review-followup-0625` (3 ahead),
  `fix/pr-approval-sod-bypass` (2 ahead), `fix/74-silent-failures` (0 ahead — safe to delete).

## 2026-06-25 — independent review (CONC-1 fix + PII-1) + complete SPEC corpus + roadmap
A follow-on session that **reconciled to the advanced `main`** (it had moved to migration `0031` +
prod `0029` via the 8-agent re-audit; an earlier fork was stale — re-read the repo first) and then:
- **CONC-1 (fixed, #168, migration `0033`):** the #159 stock floor (`0031`) was a TOCTOU under
  concurrency — the floor read `on_hand` with no lock + `fn_bin_rebuild` locks only at its closing
  UPDATE, so two simultaneous outflows could drive `on_hand` negative. Fixed: `SELECT … FOR UPDATE`
  the bin row before the floor check (serializes movements per bin). Shim harness 287/287.
- **PII-1 (filed, issue #173, MED):** `people.rate` (wages) + phone/email are org-readable by any
  member (`tenant_all`, no role gate) via PostgREST — UI-gated, not RLS-gated. Fix is Stage 8 (a
  `people_compensation` table) — designed in SPEC-0006, not a blind patch.
- **#161 L2 + L5 (fixed, #176):** seed-auth route got a `VERCEL_ENV !== 'production'` belt-and-braces
  gate; `lib/stock-calc.ts` aligned to the SQL (`available = on_hand − reserved`, expiry already
  netted into on_hand per ENGINE-C1) + oracle tests corrected. (L1/L3/L4/L6 left — deferred/design/
  non-exploitable.)
- **Re-confirmed sound:** `0025` (AUTHZ-1 operation-tables RLS — every app write path matches its
  gate), `0027` (delete posture).
- **Completed the SPEC corpus:** every stage now has a DRAFT spec for Owner ratification — SPEC-0003
  (Stage 2 palm import), 0004 (Stage 7 accounting), 0005 (Stage 11 AI / trifecta-safe), 0006 (Stage 8
  payroll/PII), 0007 (Stage 9 weather), 0008 (Stage 10 Care Academy) — plus
  **`ROADMAP-path-to-finish-2026-06-25.md`** (the dependency-ordered plan).
- **State:** all merged; `main` green; **no open PRs**. ⚠️ **prod still at `0029`** — `0030`–`0033`
  (incl. CONC-1; `0018`/`0033` are core-engine) verified on `main`, pending the Owner prod push. The
  project is now **decision-bound, not design-bound** — next moves need Owner ratification of a SPEC,
  the prod push, the HIGH forks (#155/#156/#157/#173/#89), and the agronomist (Stage 10 long-pole).

## 2026-06-25 — Storybook 8.6→10.4 toolchain upgrade + @amrebeid/ui 1.2.0 published
Coordinated **MAJOR** Storybook upgrade for `packages/ui` (the `@amrebeid/ui` design system),
landing the deferred Dependabot bump #131 properly (it had failed install with ERESOLVE because
only `@storybook/react-vite` was bumped while the rest of the 8.6.x stack stayed put).
- **Full footprint inventoried** — only **3** Storybook packages, not a 14-addon stack:
  `@storybook/react-vite`, `storybook` (core), `@storybook/addon-essentials`, declared in the repo
  root + `packages/ui`; one config dir `packages/ui/.storybook/`; 49 `*.stories.tsx`. `apps/farm-os`
  and `docs/export` have **zero** Storybook deps.
- **Upstream availability checked** per package: `@storybook/react-vite` + `storybook` exist at `10.4.6`
  (latest). `@storybook/addon-essentials` has **no v9 stable / no v10** — by design: Storybook 9+ folded
  the essentials addons (controls, actions, backgrounds, viewport, docs, measure, outline) into core
  `storybook` and stopped publishing the standalone addon. **Not a block** (unlike the ESLint-10 /
  `eslint-plugin-react` case) — the correct action is to remove it.
- **Changes:** bumped `@storybook/react-vite` + `storybook` `8.6.14`→`^10.4.6` (root + `packages/ui`);
  **removed** `@storybook/addon-essentials` (deps + the `addons` array in `.storybook/main.ts`);
  migrated `.storybook/preview.ts` (Preview type import `@storybook/react`→`@storybook/react-vite`;
  `backgrounds` `values[]`+`default` → `options` map + `initialGlobals`; defaults off the deprecated
  `globalTypes.defaultValue` → `initialGlobals`); migrated all **49** story imports
  `@storybook/react`→`@storybook/react-vite`. Kept TypeScript at the repo's `^6.0.3` (did NOT take
  Dependabot's incidental TS 6→5.6.3 downgrade).
- **Lockfile:** updated **surgically** (pruned only the `@storybook/*`+`storybook` entries and
  re-resolved) to preserve the existing `@types/react` hoisting (`19.2.17` root / `18.3.31` nested under
  `packages/ui`) — a full from-scratch regen flipped it and broke the `apps/farm-os` typecheck; the
  surgical approach keeps both CI jobs green. **No `--force` / `--legacy-peer-deps` / overrides hacks.**
- **All CI gates verified green** locally AND on GitHub runners (build job: typecheck, tokens:present,
  tokens:purity, 270 unit+a11y tests, tsup build, **build-storybook**; app job: typecheck, eslint,
  75 tests, `next build`; pgTAP).
- **PR #154** (`chore/storybook-10`) merged to `main` by the Owner; superseded Dependabot **#131**
  (auto-closed). The changesets release flow then published **`@amrebeid/ui@1.2.0`** to npm + pushed tag
  `@amrebeid/ui@1.2.0` (PR #162 release-PR merge) — carrying this upgrade plus the 4 queued UI changesets
  (a11y, datatable-mobile, recharts code-split, reduced-motion). `packages/ui/package.json` now `1.2.0`.
- **Also landed by Owner this session (not authored here):** PR **#163** (`#158`, lock
  `inventory_movements` INSERT to the RPC path — closes a forgeable ENGINE-DC bypass) and PR **#164**
  (`#159`, floor `on_hand` at 0 in `fn_post_movement` — no negative stock). Both stock-engine/security
  fixes are merged on `main` (HEAD `52fa7b0`); confirm prod DB migration state separately.
- **Safe stop:** the upgrade + release are complete. **No agent-doable, non-gated task remains on the
  critical path** — everything left is Owner-gated (Leaked Password Protection toggle;
  pricing #89; Stage-0 ratification; Stage M) or "do not start the next stage automatically" per
  `docs/CLAUDE.md`. Stopping per project rules. *(The old key-rotation red item was superseded by the
  2026-06-29 Owner correction confirming Supabase DB password + service-role key rotation is complete.)*

## 2026-06-25 — phone-OTP removed (email/password only)
Auth is now **email + password only**. The phone-OTP UI skeleton (the login footnote) was removed and
a brief comment was added above `[auth.sms]` in `supabase/config.toml` (SMS already disabled). **Twilio /
any SMS provider is dropped from MVP-0 scope** — OWNER-DECISIONS §2 marked RESOLVED, and the active docs
(deploy runbook, pilot-readiness, screen-map, architecture) now say "email + password (phone-OTP
removed)". The seed `phone` field is untouched — it is a demo-linking key + contact data, not auth.
Branch `chore/remove-phone-otp` (PR open, **not merged** — Owner gate). `tsc`/lint/tests verified (the 3
known pre-existing `bigint`-not-`ReactNode` `tsc` errors in `layout.tsx`/`AppChrome.tsx`/`SimpleTable.tsx`
are unrelated and unchanged).

## 2026-06-25 — prod migration push (0015→0022) + authz/ledger hardening
After an **8-agent adversarial prod-push assurance** returned **GO-WITH-CAVEATS**, migrations
**`0015`→`0022`** were applied to the prod Supabase (`veezkmytervjnpxcrbkw`) via the Supabase MCP
(`0018` engine change **Owner-ratified** first). **Prod DB is now at `0022`** (`0001–0013` +
`0015–0022`, recorded under their repo versions), **fully seeded** (1 org, 6 organization_member,
12 auth.users, full synthetic dataset: 1 farm, 60 assets, 28 hawshat, 5 sectors, 6 inventory
items/bins/movements, 1 plan w/ 3 operations + checks + budget). Transactional tables (`farm_event`,
`purchase_requests`, `expenses`, `audit_log`) start **empty** — correct pilot state.
- **New this session** (branch `fix/authz-1-execute-rpc`, PR #75, commit `31ad992`): **`0021`** locks
  SECURITY DEFINER fn EXECUTE grants (revoke `anon` on write RPCs `fn_execute_operation`/
  `fn_post_movement`; revoke public+anon+authenticated on trigger fns `pr_guard_approval`/`fn_audit`/
  `fn_audit_org_member`) and **`0022`** revokes UPDATE on `inventory_movements`/`inventory_bin` →
  ledger now **fully append-only**, closing **#76 item 1**. New pgTAP tests `19`+`20`.
- **Verified: pgTAP 126/126** on a clean reset (was 103).
- **Residual caveats — QUEUED, not blocking, not live-exploitable on synthetic single-tenant data:**
  **AUTHZ-1 Option B** (gate operation tables `plan_operations`/`farm_event`/`event_locations`/
  `quantities` at the REST layer, not only the `0020` RPC); **AP-5 insert-side SoD** (#76 item 2 —
  a born-approved PR sidesteps the BEFORE UPDATE trigger); **ENGINE-DC** disjointness is
  convention-enforced, not DB-constraint-enforced.
- **Still OWNER-GATED / open:** reset the demo password; ~~Twilio phone-OTP~~ (resolved 2026-06-25 —
  dropped; email/password only); Stage-0 legacy
  remediation; real Ebeid data (Stage M); per-farm EGP pricing; agronomist sign-off; **merging PRs
  #75 and #77** (both green) — a merge = prod deploy = Owner gate.
  *(Supabase `service_role` key + DB password rotation was superseded by the 2026-06-29 Owner correction confirming
  completion.)*
- Note: the local Docker DB was found empty after a reboot (volume not persisted) — irrelevant; the
  **cloud DB is the source of truth**.

## 2026-06-25 (later) — follow-up security review merged + EXE-1 fixed
A second independent adversarial pass over post-deploy `main` (recorded in
[`SECURITY-REVIEW-FOLLOWUP-2026-06-25.md`](SECURITY-REVIEW-FOLLOWUP-2026-06-25.md)) found and fixed
three more issues, all **merged to `main`** after independent diff review:
- **B2.1** (#42, migration `0016`) — the stock ledger was directly **DELETE-able** by any org member
  (B2 gated INSERT/UPDATE via `WITH CHECK`, but `FOR ALL` DELETE uses `USING` only + the blanket
  `0009` grant). Fixed: `revoke delete` → append-only ledger; pgTAP `11`.
- **AP-5** (#47, migration `0017`) — PR **self-approval bypass** (the AP-2 `WITH CHECK` reads the
  NEW row, which the same UPDATE can rewrite). Fixed: `BEFORE UPDATE` trigger freezes `requested_by`
  + stamps `approved_by`/`approved_at` from the session; pgTAP `12`.
- **EXE-1** (#51) — `executeOperation` was **not idempotent** (a double-submit/retry re-ran the
  issue/release path → double stock loss). Fixed **claim-first** (flip `status→done` guarded by
  `status <> 'done'`, abort if no row, before any stock movement; revert only pre-persist); pgTAP
  `13` + wedge-loop e2e. Incorporated 3 CodeRabbit data-integrity refinements.
- **RCP-1** (#57) — EXE-1's twin: `recordReceipt` re-posted every `receipt` on a double-submit →
  **phantom stock IN**. Fixed **claim-first** (flip `approved→received` guarded by `status='approved'`,
  abort if no row, before any movement; adds the missing precondition); pgTAP `15` + wedge-loop.
- **ENGINE-DC** (#61, migration `0018`) — `fn_stock_coverage` double-counted received receipts (in
  `on_hand` **and** re-projected forward) → could **mask a real shortage** (the wedge's whole point).
  Fixed **direction #2**: scheduled receipts now come from approved purchase_requests (open POs),
  disjoint from `on_hand` by construction; test `06` re-modeled onto POs, regression test `14`
  un-TODO'd. Independently reviewed + locally verified before merge. **Core-engine change — Owner
  should ratify before the prod push.**
- Also merged: **#43** (eslint clean), **#45**/**#49**/**#54**/**#55**/**#58**/**#59**/**#60**
  (findings + follow-up docs), **#56** (ENGINE-DC TODO regression test `14` + shim harness honors TAP TODO).
- **Verified:** **pgTAP 97/97** on a clean reset (test `14` now a real pass post-fix) + Playwright
  wedge-loop e2e + app/lib CI all green.
- ⚠️ **(superseded — see the 2026-06-25 (latest) entry above):** at the time of this entry the prod DB
  was still at migration `0013` with `0015`–`0019` verified on `main` but unpushed; the `0015`→`0022`
  push (incl. the Owner-ratified `0018`) was subsequently applied to prod — **prod DB is now at `0022`**.
- Also fixed: **CREATE-1** (#63, find-or-create) and **AUDIT-1** (#68, migration `0019`, test `17` —
  a dedicated `fn_audit_org_member` trigger puts membership/role changes on the append-only audit_log).
- Test coverage added: **#67** (test `16` engine approve→receive round-trip disjointness), **#56**
  (test `14` ENGINE-DC). Runbook **#65** documents the gated `0015→0019` prod push. **pgTAP 103/103**
  (17 files) + wedge-loop e2e green.
- **AUTHZ-1 partial fix (#71)** + **SPEC-0002 DRAFT (#69)**: the app-layer `op.execute` gate landed
  (`executeOperation` now calls `authorize('op.execute')`; e2e executes as supervisor, passes) —
  defense-in-depth. SPEC-0002 records that the role model already exists (migration `0001`) and
  proposes the authoritative RLS/`bypassrls` enforcement (Option A). **That enforcement migration is
  Owner-gated** (ratify SPEC-0002 first); until then the operation tables stay directly REST-writable.
- **Open (Owner-gated / deferred):** **AUTHZ-1** (authoritative Option A — SPEC-0002 ratify → migration),
  **DEP-1** (`postcss<8.5.10` transitive via `next`, build-time only, low), **BUD-1** (INFO — budget
  gate is decision-support, AP-1/AP-5 server-side, no hard DB spend cap), **CREATE-2** (LOW —
  `addPlanOperation` non-idempotent/non-atomic, planning-path, conservative). SoD finding renamed
  **AP-3→AP-5** (AP-3 was already the PR version-guard).

## 2026-06-25 — post-deploy hardening
With the app live, hardened + verified further: **prod re-verified** (all 6 role logins + per-role
RLS + `fn_stock_coverage` on the live stack); **app build now CI-gated** (`ci.yml` `app` job:
tsc + vitest + `next build --webpack`, #36); **README refreshed** to live state (#37); **B2 RESOLVED**
(#39, migration `0015`) — direct REST writes to inventory tables now require `inventory.write`,
closing a stock-forgery hole; unblocked by B1/D2 (app writes go through the bypassrls RPC). All green:
**pgTAP 78/78** + e2e + app/lib CI + Vercel. Also a **Playwright visual UX audit** (desktop +
mobile screenshots) found + fixed an **RTL mobile-sidebar overflow** on the field (`/m`) view (the
closed off-canvas drawer peeked ~90px) → **`@amrebeid/ui@1.1.1` published**; desktop screens
(dashboard/coverage/inventory/plan) reviewed clean. ⚠️ **(prod-DB note superseded — prod is now at
`0022`; see the 2026-06-25 (latest) entry above)** at the time of this entry prod was at migrations
0001–0013 with `0015` (B2) verified on `main` but not yet `db push`ed. Remaining is unchanged:
Stage 0 legacy cleanup + real-data privacy remain project-end deferred; Supabase DB password/service-role key
rotation was later completed per the 2026-06-29 Owner correction. Decision-gated minors remain B3 actual-paid
pricing and D1 FORCE RLS (low value).

## 2026-06-24 — DEPLOYED + LIVE 🎉
Farm OS MVP-0 is **deployed and verified end-to-end on production**: **farm-ui-one.vercel.app**
+ **ebeidfarm.business**, backed by a dedicated Supabase project (`veezkmytervjnpxcrbkw`), all 13
migrations + synthetic seed applied. **Verified live:** login (email/password, **no SMS**), RLS
isolation (owner sees «مزارع عبيد» + 28 hawshat, anon denied), and the **stock-coverage engine**
(`fn_stock_coverage` → the SPEC-0001 wedge: available 300, recommend 300kg, Arabic message).
- **Build-chain fixes (all on `main`, PRs #22–#32):** Vercel Root Dir→`apps/farm-os`; committed
  `@amrebeid/ui` `dist/`; removed root `.npmrc` (`${NODE_AUTH_TOKEN}` crash); app-local CSS copy;
  `turbopack.root`+`outputFileTracingRoot`; **pinned Tailwind v4 Linux native binaries** (oxide +
  lightningcss — npm/cli#4828, the real crash); `framework:"nextjs"` (Vercel expected `dist/`);
  resilient middleware. Full record: `docs/DEPLOY-STATUS.md`.
- **Auth:** 6 demo email/password accounts (`<role>@ebeid.test`) minted on prod via the admin API;
  password held by the Owner (not in repo).
- **Security key rotation — SUPERSEDED 2026-06-29.** This older note said the Supabase **DB password** +
  **service_role key** rotation was deferred; the Owner later confirmed both have been rotated several times.
  Do not raise Supabase DB password/service-role key rotation again unless the Owner reopens it. Demo password
  cleanup and leaked-password protection remain separate follow-ups.
- **Pilot validation — considered DONE (Owner, 2026-06-24):** the customer research was completed
  *before* the project (it produced the plan + the dummy/seed data), so the pilot-validation gate is satisfied.
- **Near-term: nothing required** — MVP-0 is deployed, live, and stable on synthetic data.
  **Deferred to project end (Owner):** legacy **Stage 0** secret remediation and real-Ebeid-data migration
  (after a privacy review). Supabase DB password/service-role key rotation is complete per the 2026-06-29 Owner
  correction. **Optional, agent-doable anytime:**
  in-browser wedge-loop walkthrough; D1 FORCE RLS check on the real Supabase roles (low value).

## This session (2026-06-23) — security review DONE + **MERGED**; lib **published 1.1.0**
Ran the independent MVP-0 security review (3 adversarial subagents: RLS / grants / engine, then
an app + read/display pass) and the `@amrebeid/ui` hardening. **Merged to `main`:** PR #1 (library
hardening), PR #2 (security remediation — migrations `0010`/`0011`, tests `05`/`06`/`07`, the
`db-tests` pgTAP CI gate, B4/B5 app fixes). **`@amrebeid/ui@1.1.0` published** to GitHub Packages
(changesets Version PR #3 → `release.yml`). The `db-tests` pgTAP job is green on CI (65/65).
What landed: **GRANT-C1** (unauthenticated
`anon` had full DML+EXECUTE incl. the SECURITY DEFINER engine — CRITICAL), **RLS-H1** (child
tables didn't validate parent org — cross-tenant write), **ENGINE-C1** (expiry double-counted),
**ENGINE-H1** (phantom purchase rec), HIGH-1 (org_member write lockdown), ENGINE-H2/SS/M1, B4
input validation, B5 coverage-NaN, and **`fn_post_movement`** (B1 transactional inventory RPC).
Full record: **`docs/SECURITY-REVIEW-MVP0-2026-06-23.md`**.
- **Verified on the real Supabase stack (Docker repaired):** **70/70 pgTAP** + the **Playwright
  wedge-loop e2e PASS** (coverage → PR reserve → budget gate → owner approve → receipt → execute →
  PvA). PR #4 (the B1 action rewiring → `fn_post_movement`) is **merged + e2e-verified** — no revert.
  App `tsc` clean; app unit 18/18; library 231/231 + build.
- **D2 DONE** (PR #8): `reserved` is now ledger-backed (`fn_bin_rebuild` = greatest(0, Σreserve−Σrelease);
  reserve/release routed through `fn_post_movement`) — 74/74 pgTAP + wedge-loop e2e green.
- **B3 DONE** (date PR #13 + price PR #16): real execution time; unit price = plan-derived rate
  (`est_cost÷qty`), not a magic number. **B2 investigated + dropped** (PR #11 — PostgREST embed
  interaction, low value). **D1 decided: skip** (no-op on Supabase). **Every agent-doable security
  finding is now resolved or decided.**
- **Path-to-finish artifacts shipped** (PRs #12/#14): **`OWNER-DECISIONS-2026-06-24.md`** (every open
  decision + a recommendation), **`DEPLOY-RUNBOOK.md`** + `apps/farm-os/.env.production.example`, and
  **`STAGE-0-REMEDIATION-RUNBOOK.md`**. The gated steps are now turnkey.
- **Remaining — all need an Owner decision or human action** (see OWNER-DECISIONS): deploy infra owner
  (non-Zeal Supabase + Vercel), Twilio phone-OTP, B3 *price* cost-source, Stage 0 execution, the 5 pilot
  interviews; then optionally the full MVP (Stages 1–11 — each needs a spec + approval, Stage 0 first).
  Also: enable repo "Allow Actions to create PRs" for hands-off releases.

## Where we are
Everything now lives in one **private monorepo: `github.com/AmrEbeid/Farm`** (npm workspaces) — `packages/ui` (design system), `docs/` (these product docs). Governed under the **AI Project Operating System v3** (CLAUDE.md / TRACKER / this brief / SPEC-0001 / MASTER-PLAN).

- **Design system — shipped (`@amrebeid/ui` v1.0).** Renamed from `@farm-os/ui` (the npm scope must match the GitHub owner). Full v1 catalog (~40 components: forms, data-display, overlays, nav/shell, Recharts charts, domain), two-tier white-label theming, token-purity gate, Changesets + **green GitHub Actions CI**. *(The original 9 components were synced to Claude Design "Farm OS UI" `115ae675…`; the expanded catalog has NOT been re-synced.)*
- **Farm OS app — MVP-0 BUILT (`apps/farm-os`), merged to `main`, CI green.** Next.js 16 + Supabase (local, via Docker) + Tailwind RTL, consuming `@amrebeid/ui`. Phases A–D: foundation, full data model + RLS + audit + Ebeid seed, the SPEC-0001 stock-coverage engine, all 14 screens, and a **Playwright e2e driving the full 11-step wedge loop (passing)**. 36 pgTAP + 11 Vitest + e2e all green.

**Important:** this is an *engineering* MVP-0 on a **local** DB. NOT deployed, NOT pilot-validated, NOT security-reviewed. Auth is email/password for seeded roles (phone-OTP UI is a skeleton).

## Approved to do next (the next safe slice)
Build is done; the remaining gates are **review + validation + infra**, all Owner-led:
1. **Independent security review — DONE + MERGED** (PRs #1–#8 on `main`; 74/74 pgTAP + wedge-loop e2e verified on the real Supabase stack; `@amrebeid/ui@1.1.0` published). B1+D2 inventory integrity landed. Only decision-gated minors remain (D1/B2/B3 — see the security-review doc).
2. **Pilot validation** — the 5-farm interviews + the H1–H4 / ≥5-of-7 gates (all still open).
3. **Stage 0 — legacy security remediation** (rotate the exposed anon key, purge the old repo's git history, scrub the Gmail/password from the accounting sheet) — still OPEN; concerns the *legacy* system, untouched by the new build.
4. **Cloud deploy** — provision a dedicated (non-Zeal-org) Supabase project + Vercel, apply migrations, wire real auth. (Local dev used local Supabase to avoid billing a personal project to the Zeal org.)

## NOT approved yet (a session must not start these)
- Any **production deploy**, **DB migration**, **key rotation/history rewrite** without explicit Owner go-ahead (these are Critical/High).
- **Migrating real Ebeid financial/PII data** into any environment or model before a privacy review.
- **Building Stage 1+ code** before Stage 0 (security/data) is closed.
- Turning **research findings directly into build** — each must pass through a SPEC first (market-led control).

## Active stage
**MVP-0 engineering build COMPLETE (local) → awaiting the review/validation/deploy gates above.** The MVP-0 plan delivered a working local vertical slice that overlaps tracker Stages 1/3/4/5/6 (org+RLS+audit, event spine, planning, stock engine, budget+PR) for one tenant. **Stage 0 (legacy security remediation) remains OPEN** and is still required before touching real Ebeid data or deploying. Build artifacts: `apps/farm-os/`; plan/spec: `docs/superpowers/{plans,specs}/2026-06-21-farm-os-mvp0*.md`.

## Reconcile-first notes (what the next session must check)
- Re-read `CLAUDE.md` and this brief before acting. Do **not** act on any earlier conversational plan that the Owner has since changed.
- Confirm the **canonical palm count = 4,380 برحي / 299 ذكور / 28 حوش** (Nov-2025 registry) is still the agreed source.
- Confirm whether the **exposed secret** (Gmail/password in the accounting sheet; anon key + project id in the old repo) has already been rotated/purged — if unsure, treat as still exposed.

## Last evidence
- **Library (`packages/ui`):** 176 Vitest + jest-axe tests, token-purity + token-presence gates, tsup build, Storybook build — all green; GitHub Actions `ci.yml` green on `main`.
- **App (`apps/farm-os`):** `supabase test db` 36/36 pgTAP (RLS isolation, audit immutability, seed invariants, stock-engine oracle); 11 Vitest (stock-calc oracle); Next build green; **Playwright e2e wedge loop passing** (reserve 500 → receipt 300→600 → execute 480kg → variance −1,680/−4%). Run `supabase db reset` before `supabase test db` (invariant tests assume the pristine seed).
- Docs: `docs/01–10`, `MASTER-PLAN.md`, `SPEC-0001`; agentic specs/plans under `docs/superpowers/`.
- Source data verified: palm registry (docx), offshoot jard (pdf), 7-yr accounting (xlsx).
- **Security review (2026-06-23):** branch `fix/mvp0-security-remediation` — migration `0010` + test `05`; **59/59 pgTAP** (36 existing + 23 new) via `apps/farm-os/supabase/test-shims/run-pgtap-local.sh` (Docker-free harness); full findings in `docs/SECURITY-REVIEW-MVP0-2026-06-23.md`. **Not merged/pushed** — awaiting Owner sign-off + the e2e on Docker.
