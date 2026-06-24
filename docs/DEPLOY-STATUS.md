# Deploy Status — Farm OS MVP-0 (pilot)   (2026-06-24)

First cloud deploy of the MVP-0 app. **No secrets in this file** — credentials were shared
out-of-band and must be rotated (see "Security follow-ups").

## What's live
- **Vercel:** project `farm-ui` (personal scope `amrabdelglill-7962s-projects`); Supabase↔Vercel
  integration injects `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY`.
- **Supabase:** dedicated **non-Zeal** project `veezkmytervjnpxcrbkw` (eu-west-1).
  - Migrations **0001–0013 applied** (`supabase db push` via the session pooler).
  - Synthetic **seed loaded** — verified 28 hawshat / 6 items / 6 users / potassium on_hand 300.
  - **Security verified on prod:** anon → `permission denied` (GRANT-C1); a logged-in owner reads
    only their org (RLS: 28/28 hawshat, org `مزارع عبيد`).
- **Auth (demo):** email/password sign-in minted for the 6 seeded roles via the Admin API
  (`owner@ebeid.test`, `manager@…`, `engineer@…`, `accountant@…`, `supervisor@…`,
  `storekeeper@…`) and relinked to the tenant rows. Login confirmed working (password-grant returns
  a token). The shared demo password was delivered out-of-band — **rotate before any non-demo use.**

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
- **Phone-OTP via Twilio** (`DEPLOY-RUNBOOK.md §3`) — the intended auth for field roles; the
  email/password logins above are an interim demo path.
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
