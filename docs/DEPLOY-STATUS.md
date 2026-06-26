# Deploy Status — Farm OS MVP-0 (pilot)   (2026-06-25)

First cloud deploy of the MVP-0 app. **No secrets in this file** — credentials were shared
out-of-band and must be rotated (see "Security follow-ups").

## What's live
- **Vercel:** project `farm-ui` (personal scope `amrabdelglill-7962s-projects`); Supabase↔Vercel
  integration injects `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY`.
- **Supabase:** dedicated **non-Zeal** project `veezkmytervjnpxcrbkw` (eu-west-1).
  - **Migrations now at `0047` — in sync with `main`.** `0001–0013` + `0015–0047` applied and recorded
    (`0036` FK perf indexes #230; `0037` AUTHZ-3 #182 — fn_post_movement made internal + gated fn_reserve_stock;
    `0038` fn_add_plan_operation #196 — atomic plan-operation RPC; `0039` fn_update_palm_status #238 — op.execute-gated
    atomic palm-status RPC; `0040` engine_rec1_fix #184 — removed the recommendation's period-1 receipts double-subtract;
    `0041` inventory_unit_cost #89-B — manual unit_cost, NULL when unknown; `0042` plan_req_rolegate, `0043` budget_rolegate,
    `0044` expenses_rolegate — the Owner's RLS role-gates on plan-req/budget/expenses (closing the no-role-gate class B2/AUTHZ-1);
    `0045` partial_receipts #155 — received_qty + partially_received + remaining-based projection + received_qty column-UPDATE lockdown;
    `0046` people_compensation — PII-1 #173 wage slice: `payroll.read` perm + role-gated `people_compensation`, `people.rate` dropped;
    `0047` engine_nulldate_guard #198 — `fn_stock_coverage` coalesces a NULL `planned_at` to period 1 so null-dated demand is never silently dropped).
    under their repo versions (`0001–0013` via `supabase db push`; `0015→0029` applied 2026-06-25 via the
    Supabase MCP after the prod-push assurance; `0030`/`0031` the same day; `0032`–`0041` applied
    2026-06-26 via the MCP — `0032` PR-line lock + version bump, `0033` CONC-1 floor lock, `0034`
    ENGINE-STALE-1 #197 shortage-mask fix, `0035` AUTHZ-2 #181 org-scoped `authorize()`, `0036` FK perf
    indexes #230, `0037` AUTHZ-3 #182 reserve wrapper, `0038` fn_add_plan_operation #196, `0039` palm-status
    RPC #238, `0040` ENGINE-REC1 #184, `0041` inventory unit_cost #89-B; **`0042`–`0047` applied via the MCP** —
    `0042` plan_req_rolegate, `0043` budget_rolegate, `0044` expenses_rolegate, `0045` partial_receipts #155,
    `0046` people_compensation PII-1 #173, `0047` engine_nulldate_guard #198). Verified
    via `list_migrations` (latest = `20260622000047`) + function-definition / policy checks
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
  a token). The shared demo password was delivered out-of-band — **rotate before any non-demo use.**
  *(2026-06-25: auth is **email + password only** — phone-OTP / Twilio removed from MVP-0 scope;
  `[auth.sms]` stays disabled.)*

## Security follow-ups (REQUIRED — credentials were shared in chat)
1. **Reset the Supabase DB password** (Settings → Database) — it was used over chat for `db push`.
2. **Roll the `service_role` (secret) key** (Settings → API) — shared in chat; then **update the
   Vercel env** (`SUPABASE_SERVICE_ROLE_KEY`) and redeploy. (The publishable/anon key is lower-risk
   but can be rolled too.)
3. **Rotate the demo login password** (or delete the demo users) before real users.

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
  exist (`<role>@ebeid.test`); the password was given to the Owner directly (NOT committed).
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
`0015–0029`, all recorded under their repo versions); it has since advanced to **`0047`** (see the
top-of-file status — `0030`–`0047` all applied; prod is now in sync with `main`). `0018` (the core-engine change) was
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

## 🔴 Security follow-ups (Owner — do now)
- **Rotate the Supabase DB password and the `service_role` (secret) key** — both were pasted in the
  setup chat. (Supabase → Settings → Database / API → roll.) After rotating the DB password, the
  committed migrations still apply via a fresh connection string; the app uses only the publishable
  + service-role keys (service-role only server-side on Vercel).
- The **demo login password is known** (shared in chat). Fine for the pilot (synthetic data only),
  but reset it before any real Ebeid data, and consider per-user passwords.
