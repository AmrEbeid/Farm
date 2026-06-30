# Deploy Status — Farm OS MVP-0 (pilot)   (2026-06-25; current-state note 2026-06-30)

First cloud deploy of the MVP-0 app. **No secrets in this file**.

> **CURRENT STATE (2026-06-30 — SPEC-0018 live; #476 chart fix; #400 export compliance applied).** Prod ledger includes the reviewed
> custody/payment backend migrations **`20260629150000`** and **`20260629150100`**, applied with
> `supabase db push --yes` after #468 preflight showed exactly those two pending versions and no existing remote
> object/column collisions. `main` records the same backend migrations at merge `27065f1`; the frontend module
> was then refreshed on clean #474 and merged at `2eb6025` with no additional DB migration. Live app surfaces now
> include `/custody` and `/custody/request/[requestId]` for owner/accountant. UI-only #476 then merged at
> `fdca0e0`, formatting chart numeric axes/tooltips/accessibility fallbacks as Arabic-Indic digits; it changed no
> database files, so migration/prod DB apply is N/A. Export-compliance #400 then applied
> **`20260622000092_export_compliance`** with `supabase db push --include-all --yes` after a dry-run listed exactly
> that migration; the prod ledger now records `20260622000092`, and #400 is merged on `main` at `55fafbc`. No real
> certificate data or PII was imported. Post-merge `main` `ci`, `db-tests`, and `release` are green for the
> SPEC-0018, #476, and #400 lanes. #438 and #441 are closed as superseded by #468/#474.
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
    backend migrations `20260629150000` and `20260629150100`. The #474 SPEC-0018 frontend adds no migration. Draft
    PR migrations `0088`, `0091`, `0092`, and `0097` are **not** applied. Historical note: by
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
