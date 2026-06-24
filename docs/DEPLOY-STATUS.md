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

## Remaining for a real pilot
- **Phone-OTP via Twilio** (`DEPLOY-RUNBOOK.md §3`) — the intended auth for field roles; the
  email/password logins above are an interim demo path.
- **Frontend smoke test** — walk the wedge loop on the live `*.vercel.app` URL signed in as each role.
- **Real data** — only after Stage 0 (`STAGE-0-REMEDIATION-RUNBOOK.md`) + a privacy review (Stage M).
- The deployed build predates the schema load; if any page cached an empty-DB error, redeploy.
