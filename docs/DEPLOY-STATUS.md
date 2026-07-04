# Deploy Status — Farm OS MVP-0 (pilot)   (2026-06-25; current-state note 2026-07-02)

First cloud deploy of the MVP-0 app. **No secrets in this file**.

> **2026-07-04 (latest) — SPEC-0024 S-8a interactive-reporting primitives LIVE; no migration.**
> Owner-ratified SPEC-0024 baseline is on `main` via #646, and the first implementation slice **S-8a** is live via
> PR **#649** (`6d936b4`). Scope: shared sortable `SimpleTable`/`FilterableTable`, sorted+filtered CSV export,
> reusable multi-insight chart toggle wrapper, trend overlay support, and the reports/dashboard user-manual update.
> **No Supabase migration / prod DB apply:** this is a frontend-only shared-component slice. Validation before merge:
> `tsc`, touched-file eslint, focused sorter test 5/5, full Vitest 429/429, `npm run build`, explicit Recharts
> code-split guard, full local pgTAP **1222/1222**, and `git diff --check`. After merge, `main` `ci`, `db-tests`,
> and `release` are green for `6d936b4`.
>
> **2026-07-04 — public site EDITABLE PHOTO GALLERY + in-OS image upload.**
> `/website` editor gained a gallery section (add/remove items, AR/EN captions) shipping with 4 dummy
> placeholder SVGs so it moves before real photos exist (#645) — the gallery rides the existing
> `site_content` JSON, **no migration**. Then in-OS **image upload** (#647): owner-gated server action
> `uploadGalleryImage` → service-role admin client → the public **`site-media`** Storage bucket
> (provisioned via Supabase MCP: `public=true`, 5 MB limit, image mimes — **NOT a repo migration**; the
> local pgTAP harness runs on bare Postgres without the `storage` schema, so a storage.buckets insert
> would break it). Owner uploads a photo → gets its public URL → stored as the gallery item's image.
> E2E-verified on prod (Playwright: login → `/website` → upload → URL = `…/site-media/gallery/<uuid>.png`,
> serves 200). One harmless ~5KB orphan test object remains in the bucket (direct SQL delete blocked by
> `storage.protect_delete`; no service key locally). `site_content` still 0 rows (no test save). Known
> follow-up: delete the old bucket object when a gallery item is replaced/removed (currently orphans it).
>
> **2026-07-04 (later) — gallery review pass + fixes (#650).** farm-os-pr-reviewer: upload security
> SOLID (owner-gated, no path traversal, service-role server-only, no XSS/SSRF). Fixed its findings —
> **HIGH:** the public site was auto-showing the 4 dummy placeholder tiles to buyers (defaults ship
> them + prod `site_content`=0 rows → fallback rendered them). SiteLanding now filters placeholder-path
> images out of the PUBLIC render + nav → gallery hidden until a card has a REAL image (owner still edits
> all in the OS); verified gone on prod. **LOW:** upload validates by MAGIC BYTES + derives content-type/
> ext server-side (client file.type/name untrusted); dropped `image/svg+xml` from the `site-media` bucket
> mimes (MCP); confirmed NO client write policy on `storage.objects` for site-media (only pre-existing
> `farm-media` has org-scoped policies) → service-role-only writes. Plus the orphan-cleanup-on-save
> follow-up above is now DONE (deletes site-media objects a gallery edit drops; best-effort; leaves
> placeholders + external URLs). CI green incl. pgTAP.
>
> **2026-07-03 — PUBLIC EXPORT WEBSITE LIVE + OS-EDITABLE; prod ledger head `20260701420000`.**
> Built and shipped the public marketing site at `/` (ebeidfarm.business) for Ebeid Farm — bilingual AR/EN,
> real GlobalGAP/GACC/QCAP/CAPQ proofs, logo + favicon + iOS/Android PWA icons, orchard hero, SEO/OG/JSON-LD/
> sitemap (⚠️ `robots.ts` had been `Disallow: /`, blocking ALL indexing — now allows the public home, keeps the
> OS out). Then made its content **editable from inside the OS**: migration **`20260701420000_site_content`**
> (org-scoped `site_content` RLS+FORCE RLS; `fn_save_site_content` SECURITY DEFINER gated by
> `authorize('site.write')`=owner; **`authorize()` re-emitted 18→19 perms, none dropped**) + owner editor at
> **`/website`** (nav «الموقع»). **Migrate-first applied to prod** `veezkmytervjnpxcrbkw` via `execute_sql` +
> explicit ledger row (the `apply_migration` version-footgun pattern) — the Farm project WAS reachable via the
> Supabase MCP this session (org `dicbxecebgdxkhmtavrz`/zeluu; not Zeal). Pre-apply probes: authorize()=18 perms
> (exact re-emit-base match), table absent. Post-apply probes: FORCE RLS ✓, RPC anon EXEC 0/auth 1 ✓,
> authorize()=**19** perms (labor/academy.write retained) ✓, ledger head `20260701420000` ✓, security advisor
> clean (only the generic SECURITY-DEFINER-executable WARN every gated RPC carries). CI green incl. pgTAP
> (new `tests/116`; guard tests 22/97 updated). PRs **#636**(site) **#638**(RTL phone bidi) **#639**(logo+icons+
> green cert band) **#640**(hero) **#641**(2-col enquiries card) **#642**(SEO/social) all merged+live; **#637**
> (Phase 2) rebased onto main, CI-green, squash-merged (`298986f`). Content editable now: owner → `/website` →
> edit → save (revalidates `/`). `site_content` has 0 rows → public page renders the typed defaults until first
> edit. Not done: `database.types.ext.ts` regen (RPC/table still cast `as any`); real farm photos; enquiry form.
>
> **2026-07-02 — STAGE 10 ACADEMY LIVE via #366 (`cedf0dd`); prod ledger head `20260701400000`; PR queue = ZERO.**
> Under the Owner's "keep working until this task and all other open PRs are finished" mandate: the stale
> Stage-10 draft **#366** was finished properly — fast-forwarded to its maintained head, merged with current
> `main`, and its migration **renumbered `20260701240000_academy_content` → `20260701400000`** (main had since
> claimed `240000` for the harvest-stage RPC re-emit; two files on one version would fail the duplicate guard).
> The migration deliberately does **NOT** re-emit `authorize()` (academy.write already in the live 18-perm
> union — the re-emit footgun explicitly avoided, verified live by probe). **Independent review (fresh-context
> reviewer agent): MERGE-READY**; its findings applied (Arabic-Indic sign-off dates via `fmtDate` + test pinning
> the no-ISO-leak rule, stale comment refs, rollback note, mojibake fix). Validation: local pgTAP **1207/1207**,
> vitest **398/398**, tsc/eslint clean, production build green. **Migrate-first**: pre-apply probes clean
> (academy.write live, head `20260701390000`, no collisions); applied via `execute_sql` + explicit ledger row
> (the `apply_migration` version-footgun pattern); post-apply probes: FORCE RLS ✓, anon EXEC 0/auth 3 ✓,
> **sign-off columns not client-updatable** ✓ (column-scoped grants), audit trigger ✓. #366 squash-merged after
> CI green on the final head. The #4 gate is mechanism-live: content renders «قالب استرشادي» until a NAMED
> agronomist + current Egyptian pesticide registration are recorded — the legal sign-off itself remains the
> external agronomist's act. Also this pass: **#580** (custody/accounting plan + SPEC-0018-EXT) conflict-resolved,
> cross-referenced to wave-3 findings, merged; **#597** STATUS pointers merged; earlier same day the Owner-gated
> batch **#590/#591/#592/#593/#594/#596** merged (incl. the `/purchase-requests` open-orders console — app-only,
> no migration). Live smoke recorded in SESSION-BRIEF.

> **2026-07-01 (latest) — FULL LIVE DEPLOY: 32 PRs merged, 14 migrations applied, prod ledger reconciled
> 134/134, Vercel confirmed READY.** Executed the Owner's twice-confirmed "proceed to full live deploy now"
> mandate: 18 no-schema PRs, then 7 independent schema PRs, then the `authorize()` chain (#557→#558, final
> 18-perm union), then the 5-layer `fn_add_plan_operation_multi` reconciliation (#543→#549→#562→#560→#563,
> final **16-arg** signature — every planned farm operation flows through this function). Applied migrations
> (in order): `fn_unassign_plan_operation`, `execute_multi_material`, `plan_operation_templates`,
> `owner_pnl_summary_rpc`, `weather_thresholds_settings`, `pest_scouting_traps`, `agronomist_signoff_gate`,
> `people_labor_write_gates`, `labor_logs`, `fn_add_plan_operation_multi_harvest_stage`,
> `plan_labor_person_link`+`plan_labor_person_write`, `spray_compliance_fields`, `plan_op_irrigation_basis`,
> `individual_palm_treatment`, `plan_op_relative_scheduling`. Each migration was pre-checked against the LIVE
> current-prod function signature before applying, not assumed. **Migration-ledger repair:** discovered (via a
> full repo-file-list ↔ prod-ledger diff, run as part of this same session's docs update) that the
> `apply_migration` MCP tool records its OWN auto-generated apply-time version rather than the migration file's
> intended timestamp; 2 migrations (`plan_op_irrigation_basis`, `individual_palm_treatment`) were still recorded
> under the wrong auto-generated version, plus 15 stale duplicate ledger rows survived from earlier in the
> session. Repaired via a direct, verified `UPDATE`/`DELETE` against `supabase_migrations.schema_migrations`
> (ledger bookkeeping only — no DDL re-run, no data/schema change). **Confirmed: 134/134 repo migration files
> now exactly match the prod ledger, zero orphans.** Final Vercel production deployment (PR #563, the last
> merge) confirmed `READY`, aliased to `ebeidfarm.business` + `farm-ui-one.vercel.app`. `get_advisors`: **0
> ERROR-level findings**; 54 WARN-level, all the expected/deliberate "authenticated can EXECUTE this SECURITY
> DEFINER RPC" pattern already used throughout this codebase — no new/unexpected security issue. **Not part of
> this batch:** PR #580 (accounting/custody plan, docs-only, awaiting Owner review, correctly still open).
> Full detail: `SESSION-BRIEF.md`.

> **2026-07-01 — connected work graph LIVE via PR #582 (`e98c3c9`).**
> Draft local migration `20260701390000_execute_operation_target_rollup.sql` fixes executed operation rollups for
> sector/hawsha/line/palm targets by writing `event_locations.farm_id/sector_id/hawsha_id/line_id` and palm
> `event_assets`, preserving both the #512 no-blind-release behavior and the current multi-material execution
> contract from `20260701230000_execute_multi_material.sql`. Current `main` owns `20260701230000` for
> multi-material execution, so this branch moves the rollup fix to `20260701390000`. Latest `main` also introduced a
> duplicate `20260701230000_operation_subtype_vocab.sql`; this branch renumbers it to `20260701235000` so it remains
> before `20260701240000_fn_add_plan_operation_multi_harvest_stage.sql`. Local pgTAP is green
> (**1098/1098**, including
> `112_execute_multi_material_test.sql` and `113_execute_operation_target_rollup_test.sql`, which also proves
> palm fallback through `line_id` when `assets.hawsha_id` is missing). App validation is green: full ESLint,
> `tsc --noEmit`, Vitest **353/353**, production build, and `git diff --check`. GitHub checks must rerun on the
> pushed rebased head before merge.
> Prod apply/probe completed on Farm (`veezkmytervjnpxcrbkw`): repaired exact ledger rows for already-applied
> generated-timestamp migrations, including `20260701235000`, `20260701240000`, `20260701280000`,
> `20260701300000`, `20260701310000`, `20260701350000`, `20260701370000`, and `20260701380000` after the latest rebase, then recorded
> `20260701390000_execute_operation_target_rollup` with exact ledger version. Probes
> confirm five-arg `fn_execute_operation`, no four-arg overload, multi-material refusal preserved, full
> `event_locations` insert including `asset_id`, palm `event_assets`, and no anon EXECUTE grant.
> PR #582 is squash-merged to `main`; main `ci`, `db-tests`, and `release` are green. Live unauthenticated smoke on
> `https://ebeidfarm.business` confirms `/` and `/login` return 200; protected app routes including `/farm`, `/m`,
> `/people/dashboard`, `/finance/dashboard`, `/accounting`, `/custody`, `/plans`, `/weather/thresholds`,
> `/farm/pest-scouting`, plus representative real sector/hawsha/line/palm 360 URLs, redirect to `/login` (307)
> rather than 404/500. Authenticated content smoke still needs a logged-in browser session.

> **2026-07-01 — accounting/custody settlement LIVE via PR #568 (`8ffc4ae`).**
> Branch `feat/accounting-custody-standalone` / PR #568 introduced
> `20260701220000_accounting_cash_custody_settlement.sql` plus `/accounting` and request-settlement UI.
> Validation is green (local pgTAP 904/904, app Vitest 251/251, lint, production build, diff check; PR checks +
> CodeRabbit green). The migration was applied to Farm prod (`veezkmytervjnpxcrbkw`) with
> `supabase db push --yes`; ledger now records `20260701220000 accounting_cash_custody_settlement`. Prod probes
> confirm the new tables/RPCs exist, FORCE RLS is enabled, authenticated table DML is revoked, and anon cannot execute
> the new accounting/payment RPCs. PR #568 was squash-merged to `main` at `8ffc4ae`; post-merge `ci`, `db-tests`,
> and `release` are green. Live unauthenticated probes on `https://ebeidfarm.business/accounting` and `/custody`
> return the expected protected-route `307` to `/login` (login `200`), not 404/500.

> **2026-07-01 (cont.) — 5 more prod migrations: the ENGINE masked-shortage program (all migrate-first, green `main`).**
> Prod ledger head is now **`20260701210000`**. All applied migrate-first + independent-reviewed (engine surface) +
> prod re-probed. A holistic re-audit after the first batch caught two masked shortages introduced by the batch
> itself (per-change reviews missed the INTERACTIONS); both fixed; a final re-audit confirms the engine is
> **masked-shortage-free**. The set (in order):
> - `20260701170000` #216 demand — pmr.unit reconcile trigger (reject a 'ton' requirement) (#521)
> - `20260701180000` #216 supply — fn_post_movement unit reconcile + fn_reserve_stock null (#522) ⚠️ engine
> - `20260701190000` #512 — fn_execute_operation drops the blind release (reservation-wipe mask) (#525) ⚠️ engine
> - `20260701200000` — clamp fn_stock_coverage bucket origin to today (regression from #509) (#529) ⚠️ engine
> - `20260701210000` — fn_post_receipt inherits the item unit (stuck-PR phantom-supply mask) (#530) ⚠️ engine
> **All 5 masked-shortage vectors found this session are closed (#509/#216/#512 + the two re-audit findings), each
> with an independent-review proof of non-masking.** Remaining reservation work (#199 double-count, #526 earmark
> accumulation) is OVER-ORDER only (safe), owner-gated on the reserve-lifecycle decision.

> **2026-07-01 — AUTONOMOUS SESSION: 10 prod migrations applied migrate-first, all green on `main` (`b05811e`).**
> Every migration was validated on the local pgTAP harness first, applied to Farm prod (`veezkmytervjnpxcrbkw`)
> via the MCP `execute_sql` + manual ledger-insert pattern (see memory `farm-prod-migrate-via-mcp`), re-probed on
> prod, then merged after CI green. Prod ledger head is **`20260701160000`**. The applied set (in order):
> - `20260630090000` anon table-DML lockdown (#317/PR #485)
> - `20260630100000` perf-advisor: pr_update RLS InitPlan + FK covering sweep (#486)
> - `20260701090000` org-settings audit gap (#492)
> - `20260701100000` plan-subsystem audit triggers (#495)
> - `20260701110000` event-children audit triggers (#497)
> - `20260701120000` custody one-cash-out unique backstop (#508)
> - `20260701130000` **engine masked-shortage fix** — count in_progress/approved op demand (#509) ⚠️ engine surface
> - `20260701140000` payment-lifecycle claim-first guards (#511)
> - `20260701150000` sectors/hawshat (org_id, code) unique — import idempotency (#515)
> - `20260701160000` structure CRUD integrity (archive/restore symmetry, row_count coalesce, archived-parent) (#517)
> **Still queued as draft PRs, NOT applied:** `0088`+`0097` (#368 accounting), `0091` (#366 academy) — behind their
> expert/reconciliation gates. **Owner-gated model decisions (NOT migrated):** the reservation-model redesign
> (#512/#199) and unit-model (#216) — both are masked-shortage-adjacent and need Amr's design call; #512 is pinned
> by `tests/105` (todo). Full session record + decision queue: issue #505.

> **2026-06-30 — perf-advisor remediation applied to prod (migrate-first), PR #486.** Migration
> **`20260630100000`**: (1) re-emit `purchase_requests.pr_update` (byte-for-byte from `0070`) with the
> `current_setting('app.posting_receipt')` read wrapped as an InitPlan subselect (fixes `auth_rls_initplan`
> WARN; semantically identical — per-tx GUC); (2) re-run the idempotent `0096` catalog FK-covering-index
> sweep to cover `plan_operation_assignees.org_id` + `residue_test_results.org_id` (created after `0096`).
> Local pgTAP 826/826; applied to prod (ledger `20260630100000`); re-probe: 0 uncovered FKs, GUC wrapped.
> Deliberately left the ~80 `unused_index` INFO findings (pilot DB → "unused" = "not yet exercised").

> **2026-06-30 — #317 residual anon table-DML lockdown applied to prod (migrate-first), PR #485.** A read-only
> prod grant probe found `anon` still held `INSERT,UPDATE` on `public.attachments` + `public.plan_operation_assignees`
> (created after the `0079`/`0080` anon sweeps; kept the broad grant from the platform `supabase_admin` default ACL;
> the `20260629135038` grant-hygiene migration swept only TRUNCATE/DELETE). Authored migration **`20260630090000`**
> (idempotent `revoke insert, update on all tables in schema public from anon`) + extended `tests/97` with an
> anon-no-DML invariant (local pgTAP 826/826). **Applied to Farm prod first** (`execute_sql` + ledger row
> `20260630090000`); post-apply re-probe confirms `anon` DML = none. PR #485 opened; merging after the prod apply.
> Residual lower-priority follow-ups (unchanged): `anon` SELECT on a few internal tables, and the platform-owned
> `supabase_admin` default ACL.

> **CURRENT STATE (2026-06-30 — SPEC-0018 live; #400 export compliance applied; Entity-360 UI sweep complete + runtime fixes live).** Prod ledger includes the reviewed
> custody/payment backend migrations **`20260629150000`** and **`20260629150100`**, applied with
> `supabase db push --yes` after #468 preflight showed exactly those two pending versions and no existing remote
> object/column collisions. `main` records the same backend migrations at merge `27065f1`; the frontend module
> was then refreshed on clean #474 and merged at `2eb6025` with no additional DB migration. Live app surfaces now
> include `/custody` and `/custody/request/[requestId]` for owner/accountant. UI-only #476 then merged at
> `fdca0e0`, formatting chart numeric axes/tooltips/accessibility fallbacks as Arabic-Indic digits; it changed no
> database files, so migration/prod DB apply is N/A. Export-compliance #400 then applied
> **`20260622000092_export_compliance`** with `supabase db push --include-all --yes` after a dry-run listed exactly
> that migration; the prod ledger now records `20260622000092`, and #400 is merged on `main` at `55fafbc`. No real
> certificate data or PII was imported. UI-only Entity-360 PRs #477/#478/#479/#480 also merged; #479/#480 changed
> no database files, so migration/prod DB apply is N/A. Post-360 app-only follow-ups **#481/#482/#483** are also
> merged: #481 fixed tabbed 360 Server Components calling client-only tab helper functions, #482 added a CI guard
> for that RSC failure class, and #483 made unknown planned fertilization costs render/persist warning instead of
> a false-green budget advisory. Follow-up **#484** made remaining tracked UI/report cost displays preserve unknown
> estimated/planned costs instead of rendering `0 ج.م`, including PVA chart suppression when planned cost is
> incomplete. These changed no `supabase/` files, so migration/prod DB apply is N/A. Post-merge `main` at
> `d603b1f` has `ci`, `db-tests`, and `release` green. The follow-up docs head `e567115` is also green on
> `ci`, `db-tests`, and `release`; it changed no app/schema files and required no migration. #438 and #441 are
> closed as superseded by #468/#474.
> **Still queued as draft PRs, NOT applied:** `0088` + `0097` (#368 accounting) and `0091` (#366 academy).
> These remain behind their expert/reconciliation/pre-migration gates. **Residual security/admin
> follow-up:** #317/#229 remain open for the platform-owned `supabase_admin` default table ACL and leaked-password
> protection/Auth dashboard verification. **Rotation note:** Owner confirmed 2026-06-29 that Supabase DB password +
> service-role key rotation is complete; do not raise again.

> **HISTORICAL STATE (2026-06-28, late — PR sweep; superseded by the 2026-06-30 current state above).** Prod is at migration **`0096`**. Applied this session
> via the Supabase MCP, each recorded under its **exact repo version** (**0 stray/off-version rows**;
> prod head `20260622000096`): earlier-applied `0090` + `0093` (#399 operations), `0094` (#401 **C2 engine
> fix — the go-live blocker, now LIVE on prod**), `0095` (#402 org-switcher anon-lock + fiscal-year coalesce),
> `0096` (#404 FK covering indexes — 0 unindexed FKs remain). **PRs #399 / #401 / #402 / #404 merged** →
> repo↔prod ledger in sync at `0096`.
> ✅ **Correction:** the Farm project `veezkmytervjnpxcrbkw` **IS reachable from the connected Supabase
> MCP** (same org as `ai-math-tutor`); the earlier "MCP reaches only the Zeal org / Farm not reachable"
> note was **stale** — verify with `list_projects`, don't assume.
> **Still queued as draft PRs, NOT applied:** `0088` + `0097` (#368 accounting), `0091` (#366 academy),
> and `0092` (#400 export). These are behind expert gates and/or the `authorize()` ordering risk recorded
> below — do **not** race that lane. Also still pending
> in the dashboard: enable `custom_access_token_hook` + leaked-password protection. **Rotation note:** Owner
> confirmed 2026-06-29 that Supabase DB password + service-role key rotation is complete; do not raise again.

> **HISTORICAL REVIEW UPDATE (2026-06-29 — draft migration lane; #400 later shipped on 2026-06-30).** Fresh independent reviews of the three remaining
> draft migration PRs all recommend **keep draft / do not migrate**:
> **#366 academy `0091`** is security/RLS-clean but still gated by licensed-agronomist + Egyptian
> pesticide-registration sign-off; merging before migrating would expose `/academy` against missing prod tables.
> **#368 accounting `0088` + `0097`** is privacy/RLS-clean after current fixes, but remains gated by real Excel
> reconciliation + privacy review; prod is already at `0096`, so `0088` is an out-of-order gap-fill and `0097`
> must be handled explicitly with it. **#400 export `0092`** is review-clean on RLS/schema, but must not be applied
> alone while #366's `0091` re-emits `public.authorize()` without `export.write`; safe paths are `0091` before
> `0092`, patch `0091` to preserve the final permission union, or add a post-`0096` repair migration that pins the
> final union after both features. No production migration is approved from these reviews.
> **Follow-up:** #366 now uses the "patch `0091` to preserve the final permission union" path at head `86dfa6e`;
> CI is green and a focused independent check found no blockers. This reduces the `0091`/`0092` ordering trap, but
> #366/#400 remain unmigrated and require a fresh pre-migration review before any apply.
> **#368 follow-up:** #368 now computes P&L totals through `fn_accounting_pnl_summary` on the DB side at head
> `0625150`, closing the capped-row totals bug; CI is green. A session reviewer check found no obvious blocker,
> but #368 still needs a fresh visible final review before any merge/migrate.
> It still remains unmigrated and draft-gated by real Excel reconciliation + privacy review and the explicit
> `0088` gap-fill + `0097` apply plan.

> **CURRENT ISSUE-HYGIENE UPDATE (2026-06-29).** #383 is closed as fixed/applied: #402 merged, migration `0095`
> exists on `main`, pgTAP coverage exists, and prod includes `20260622000095 org_switcher_preapply_hardening`.
> #317 remains open after a read-only prod grant probe still showed broad default/table grant hygiene gaps
> (`TRUNCATE` on 38 public tables for anon and authenticated, plus limited `DELETE` grants). #229 remains open
> for the remaining prod-config/advisor cleanup: FK covering indexes are fixed by `0096`, but grant hygiene and
> leaked-password protection are not closed. No DDL or production data change was run during this hygiene pass.

## What's live
- **Vercel:** project `farm-ui` (personal scope `amrabdelglill-7962s-projects`); Supabase↔Vercel
  integration injects `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY`.
- **Supabase:** dedicated **non-Zeal** project `veezkmytervjnpxcrbkw` (eu-west-1).
  - **Migrations now at `20260629150100` (current).** The live ledger includes the #466 hardening/alignment
    migrations `20260622000098`, `20260629135038`, `20260629140248`, `20260629141650`, plus the #468 SPEC-0018
    backend migrations `20260629150000` and `20260629150100`. The #474 SPEC-0018 frontend, #476 chart pass,
    #477/#478/#479/#480 Entity-360 UI pass, and #481/#482/#483/#484 app/CI follow-ups add no migrations. Draft
    PR migrations `0088`, `0091`, and `0097` are **not** applied. Historical note: by
    2026-06-27, Stages 2/3/4 had been applied via the Supabase MCP:
    `0080` structure_soft_delete_audit, `0081` structure_write_rpcs (+ `structure.write` on `authorize`;
    structure `tenant_all` re-emit), `0082` attachments (table + RLS + RPCs), `0083` record_event (3 RPCs),
    `0084` plan_builder (4 RPCs + plans `tenant_all` re-emit). Each recorded under its **exact repo version**
    (BEGIN/COMMIT txn + ledger insert; **0 stray/off-version rows**). Also applied **`storage-policies.sql`**
    (private `farm-media` bucket + 2 org-scoped `storage.objects` policies — node media now works). `main`
    in sync (#344/#346/#351 merged). `get_advisors`: only pre-existing WARNs. **Independent review of the
    `0081`/`0084` access-control re-emits is still Owner-gated (actor ≠ reviewer).**
  - **Prior: migrations at `0079` (2026-06-27).** Authoritative source = `schema_migrations` (max =
    `20260622000079`). Pushes via the Supabase MCP (all versions match their files; verified
    head/recorded-count/triggers/constraints/policies, no dup versions, `get_advisors` no new
    regressions): **`0049–0066`** (18: assets/PR/engine hardening + cross-org FK sweep,
    #235/#270/#280/#306) then **`0067–0073`** (7: 0067 suppliers write-gate, 0068/0069 plan_checks
    write/delete gates, 0070 cross-org FK registry tail, 0071 people reports-to same-org trigger, 0072
    inventory_items safety_stock/pack_size CHECK [360-review], 0073 palm_status_history write-gate
    [360-review]). PRs #318 + #321 merged. Then **`0074–0079`** applied to prod (a mix: the parallel
    session pushed through ~`0074`; `0075–0079` were applied via the Supabase MCP this session) — `0074`,
    `0075` cross_org_fk_assets, `0076` pri_unique_pr_item, `0077` people_comp_org_index, `0078`
    engine_msg_maxdef, `0079` people_comp_anon_revoke (the wage-table `anon` DML revoke — see
    `SECURITY-FINDING-wage-table-anon-grant-2026-06-27.md`). — Prior baseline: `0001–0013` + `0015–0048` applied and recorded
    (`0036` FK perf indexes #230; `0037` AUTHZ-3 #182 — fn_post_movement made internal + gated fn_reserve_stock;
    `0038` fn_add_plan_operation #196 — atomic plan-operation RPC; `0039` fn_update_palm_status #238 — op.execute-gated
    atomic palm-status RPC; `0040` engine_rec1_fix #184 — removed the recommendation's period-1 receipts double-subtract;
    `0041` inventory_unit_cost #89-B — manual unit_cost, NULL when unknown; `0042` plan_req_rolegate, `0043` budget_rolegate,
    `0044` expenses_rolegate — the Owner's RLS role-gates on plan-req/budget/expenses (closing the no-role-gate class B2/AUTHZ-1);
    `0045` partial_receipts #155 — received_qty + partially_received + remaining-based projection + received_qty column-UPDATE lockdown;
    `0046` people_compensation — PII-1 #173 wage slice: `payroll.read` perm + role-gated `people_compensation`, `people.rate` dropped;
    `0047` engine_nulldate_guard #198 — `fn_stock_coverage` coalesces a NULL `planned_at` to period 1 so null-dated demand is never silently dropped;
    `0048` contact_pii_lockdown — PII-1 #173 phone/email slice: deny-by-default (`revoke select on people from authenticated`) + re-grant all columns except phone/email; phone column retained for service-role linking. Members can no longer read phone/email; non-PII columns still readable).
    under their repo versions (`0001–0013` via `supabase db push`; `0015→0029` applied 2026-06-25 via the
    Supabase MCP after the prod-push assurance; `0030`/`0031` the same day; `0032`–`0041` applied
    2026-06-26 via the MCP — `0032` PR-line lock + version bump, `0033` CONC-1 floor lock, `0034`
    ENGINE-STALE-1 #197 shortage-mask fix, `0035` AUTHZ-2 #181 org-scoped `authorize()`, `0036` FK perf
    indexes #230, `0037` AUTHZ-3 #182 reserve wrapper, `0038` fn_add_plan_operation #196, `0039` palm-status
    RPC #238, `0040` ENGINE-REC1 #184, `0041` inventory unit_cost #89-B; **`0042`–`0048` applied via the MCP** —
    `0042` plan_req_rolegate, `0043` budget_rolegate, `0044` expenses_rolegate, `0045` partial_receipts #155,
    `0046` people_compensation PII-1 #173 wage slice, `0047` engine_nulldate_guard #198, `0048` contact_pii_lockdown PII-1 #173 phone/email slice). Verified
    via `list_migrations` (latest = `20260622000048`) + function-definition / policy checks
    (coverage guard + `fn_post_movement` `FOR UPDATE` lock live; `authorize` now the 2-arg org-scoped
    overload incl. the `payroll.read` branch, 1-arg dropped, all policies repointed); `get_advisors` shows only pre-existing WARNs.
  - Synthetic **seed loaded** — verified 28 hawshat / 6 items / 6 members / potassium on_hand 300. Full
    dataset: 1 org, 6 organization_member, 12 auth.users, 1 farm, 60 assets, 5 sectors, 6 inventory
    items/bins/movements, 1 plan w/ 3 operations + checks + budget. Transactional tables (`farm_event`,
    `purchase_requests`, `expenses`, `audit_log`) start **empty** — correct pilot state.
  - **Security verified on prod:** anon → `permission denied` (GRANT-C1); a logged-in owner reads
    only their org (RLS: 28/28 hawshat, org `مزارع عبيد`).
- **Auth (demo):** email/password sign-in minted for the 6 seeded roles via the Admin API
  (`owner@ebeid.test`, `manager@…`, `engineer@…`, `accountant@…`, `supervisor@…`,
  `storekeeper@…`) and relinked to the tenant rows. Login confirmed working (password-grant returns
  a token). ⚠️ **Correction (2026-06-26):** the demo password is NOT out-of-band — it is **hardcoded
  and committed** (`apps/farm-os/lib/seed-auth.ts` `SEED_PASSWORD`, `apps/farm-os/app/login/page.tsx`
  `DEMO_PASSWORD`) and ships in the client bundle (prefilled in the login field). Fine for the pilot
  (synthetic data only), but it **must be de-hardcoded + rotated before any non-demo use** — see follow-up #4.
  *(2026-06-25: auth is **email + password only** — phone-OTP / Twilio removed from MVP-0 scope;
  `[auth.sms]` stays disabled.)*

## Security follow-ups
**2026-06-29 Owner correction:** Supabase DB password + `service_role` key rotation is complete; do not list it
as an open gate again unless the Owner reopens it.

1. **Rotate the demo login password** (or delete the demo users) before real users, if still applicable.
2. **De-hardcode the demo password** — it is committed in `lib/seed-auth.ts` + `app/login/page.tsx`
   (client-bundled, prefilled). Move it to a (server-side for seed, `NEXT_PUBLIC_` for the prefill) env
   var and stop pre-filling the field, then rotate (#3). *(A gitleaks CI gate now blocks NEW committed
   secrets — `.gitleaks.toml` + `ci.yml` `secret-scan` job — but this pre-existing one needs the manual
   de-hardcode + a Vercel env var, so it is Owner-gated.)*

## ⛔ Known issue — Vercel Root Directory is wrong (2026-06-24)
`https://farm-ui-one.vercel.app/` serves the **`@amrebeid/ui` library JS**, and `/login` is 404 —
i.e. Vercel is building the **monorepo root / library**, not the Next.js app. **Fix (Owner, in the
Vercel dashboard):** project `farm-ui` → **Settings → Build & Deployment → Root Directory** = `apps/farm-os`
→ Save → **Redeploy**. Framework preset: **Next.js**. Keep the env vars. If the build then fails to
resolve the `@amrebeid/ui` workspace dep, enable "Include source files outside the Root Directory"
(Vercel monorepo/workspaces support) or set Install Command to install from the repo root. Custom
domain `ebeidfarm.business` will serve the app once the root is fixed + redeployed.

**Monorepo build fix (2026-06-24):** `@amrebeid/ui` resolves to `dist/`. First attempt — a
`vercel-build` that built the lib on Vercel (`npm … run build --workspace @amrebeid/ui && next build`)
— **failed**: the lib's `tsup` build crashed on Vercel's Linux runner (the lockfile, generated on
macOS, omits the Linux `esbuild`/rolldown optional binary — npm/cli#4828, same issue our CI patches).
**Resolution: commit the prebuilt `packages/ui/dist/`** (un-ignored) so the Vercel app build just runs
`next build` and consumes the prebuilt library — no fragile cross-workspace build on Vercel. The
`vercel-build` script was removed. **Trade-off:** `dist/` can go stale vs source — **rebuild it before
deploying any library change**: `npm run build --workspace @amrebeid/ui` then commit. (Cleaner future
option: have the app consume the *published* `@amrebeid/ui@1.1.0` from GitHub Packages via an `.npmrc`
+ read token, instead of the workspace.)

## Auth decision (2026-06-24): NO SMS
The Owner does not want the app to send SMS → **phone-OTP/Twilio is dropped**. Auth is
**email/password** (the demo logins above; real users get email/password accounts the same way).
The phone-OTP UI skeleton stays unused; ensure the login path never calls `signInWithOtp` (phone).

## Remaining for a real pilot
- **Frontend smoke test** — walk the wedge loop on the live `*.vercel.app` URL signed in as each role.
- **Real data** — only after Stage 0 (`STAGE-0-REMEDIATION-RUNBOOK.md`) + a privacy review (Stage M).
- The deployed build predates the schema load; if any page cached an empty-DB error, redeploy.

## ⛔→✅ Root cause of the failing Vercel builds (2026-06-24)
The committed root `.npmrc` (`@amrebeid:registry=…github` + `_authToken=${NODE_AUTH_TOKEN}`) made the
package manager crash on Vercel with **"Failed to replace env in config"** during `next build`
(NODE_AUTH_TOKEN is undefined there). It exists for library publishing, but breaks the app build
(which uses the *workspace* `@amrebeid/ui`, not the registry). **Fix:** removed the live `.npmrc`
(kept `.npmrc.example` for external consumers); publishing still works because `release.yml`'s
`actions/setup-node` injects its own registry+token. This was the actual blocker behind the
repeated build failures — not the lib build.

## ⛔→✅ The actual Vercel build fix (2026-06-24): build with webpack, not Turbopack
Next 16 builds with **Turbopack** by default. On Vercel's Linux runner Turbopack's native binary
is broken (the macOS-generated lockfile omits the Linux swc/turbopack optional — npm/cli#4828; the
"Found lockfile missing swc dependencies" warning), so Turbopack mishandled CSS-module imports in
the root layout (`styles.css`, then `globals.css` — the `[Client Component Browser] ← layout.tsx`
traces). Local Turbopack works (darwin binary present), Vercel's didn't. **Fix:** `build` script is
now `next build --webpack` — webpack needs no native turbopack binary and handles CSS robustly.
Verified locally (`✓ Compiled`, all routes, recharts fine via the client boundary). The earlier
turbopack.root / committed-dist / local-CSS / .npmrc fixes were all real, sequential blockers; this
is the last one. Turbopack stays available for `next dev` (the `turbopack` config block is inert for
webpack builds).

## ✅ LIVE (2026-06-24)
The app is deployed and working end-to-end on **farm-ui-one.vercel.app** (+ `ebeidfarm.business`),
backed by the dedicated Supabase project `veezkmytervjnpxcrbkw`.
- **Verified live (2026-06-25):** `/` 200, `/login` 200, `/dashboard` 307 (auth redirect); **all 6
  role logins** succeed and each reads the org «مزارع عبيد» + 28 hawshat (RLS scoped per role);
  **`fn_stock_coverage` works on prod** (potassium → available 300, shortage, recommend 300kg,
  Arabic message); dashboard reads correct (6 items / 1 plan / 1 budget / 1 farm); anon denied
  (GRANT-C1). DB = all 13 migrations + synthetic seed. Also CI now gates the app build (ci.yml `app` job).
- **Auth:** email/password, **no SMS** (phone-OTP/Twilio dropped per Owner). Six demo accounts
  exist (`<role>@ebeid.test`); ⚠️ **the password IS committed** (`lib/seed-auth.ts` + `app/login/page.tsx`,
  client-bundled) — see "Security follow-ups" #4. Synthetic-only, but de-hardcode + rotate before real use.
- **Build chain resolved (the saga):** Vercel Root Directory→`apps/farm-os`; committed `@amrebeid/ui`
  `dist/`; removed the root `.npmrc` (`${NODE_AUTH_TOKEN}` crashed the build); app-local CSS copy;
  `turbopack.root`+`outputFileTracingRoot`; **pinned Tailwind v4 Linux native binaries**
  (`@tailwindcss/oxide-linux-x64-gnu`, `lightningcss-linux-x64-gnu` — npm/cli#4828, the real crash);
  `framework:"nextjs"` (Vercel had expected a `dist/` output); resilient middleware.

## ✅ Prod DB migration push (2026-06-25)
Prod was provisioned at `0001–0013`. After an **8-agent adversarial prod-push assurance returned
GO-WITH-CAVEATS**, migrations **`0015`→`0024`** were applied to the prod Supabase
(`veezkmytervjnpxcrbkw`) via the Supabase MCP; the **`0025`→`0029`** access-control / engine-integrity
hardening (AUTHZ-1 Option B, ENGINE-DC DB-enforcement + PR-scope fix, DELETE-posture, FORCE-RLS) was
applied the same way — **prod DB reached `0029`** at this 2026-06-25 push (`0001–0013` +
`0015–0029`, all recorded under their repo versions); it has since advanced to **`0048`** (see the
top-of-file status — `0030`–`0048` all applied; prod is now in sync with `main`). `0018` (the core-engine change) was
**Owner-ratified** first. Earlier this session (branch `fix/authz-1-execute-rpc`, PR #75, commit
`31ad992`): **`0021`** locks SECURITY DEFINER fn EXECUTE grants (revoke `anon` on write RPCs
`fn_execute_operation`/`fn_post_movement`; revoke public+anon+authenticated on trigger fns
`pr_guard_approval`/`fn_audit`/`fn_audit_org_member`) and **`0022`** revokes UPDATE on
`inventory_movements`/`inventory_bin` (ledger now fully append-only, closing #76 item 1). Then
**`0023`** (`pr_approval_sod_guard_insert`) extends the PR self-approval guard to fire BEFORE INSERT,
closing the AP-5 insert-side sidestep (#76 item 2 — a born-approved PR), and **`0024`**
(`fn_post_receipt`, **RCP-ATOMIC-1**) makes PR receipt posting atomic in one transaction (no more
half-received corrupt state). **pgTAP 287/287** on a clean reset (latest harness run 2026-06-25; grew
from 126 as `0025`–`0033` and their tests landed). (Migration filenames skip `0014` — a dropped first
B2 attempt; harmless, applied by version.)

**Residual caveats — now CLOSED (2026-06-25):** **AUTHZ-1 Option B** (gate operation tables
`plan_operations`/`farm_event`/`event_locations`/`quantities` at the REST layer, not only inside the
`0020` RPC) landed in `0025`; **ENGINE-DC** disjointness is now DB-enforced (`0026`) with a PR-scoped
guard fix (`0029`), no longer convention-only. *(AP-5 insert-side SoD — #76 item 2 — closed by `0023`;
receipt-posting atomicity — closed by `0024`.)* No queued security caveats remain from the assurance.

## Security follow-ups
- **Supabase DB password + `service_role` key rotation is complete** — Owner correction 2026-06-29. Do not list
  this as an open gate again unless the Owner reopens it.
- The **demo login password is known** (shared in chat **and committed** in `lib/seed-auth.ts` +
  `app/login/page.tsx`, client-bundled). Fine for the pilot (synthetic data only),
  but reset it before any real Ebeid data, and consider per-user passwords.
