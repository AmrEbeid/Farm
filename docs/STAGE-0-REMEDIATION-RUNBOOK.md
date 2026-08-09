# Stage 0 — Legacy Secret Remediation Runbook

**Status: PARTIAL — WORKBOOK SCRUBBED; OLD-SYSTEM KEY/HISTORY AND GOOGLE CONTROLS OPEN; D COMPLETE.**
Steps A–C concern the **legacy** system (the old repo + the accounting spreadsheet); step D (added 2026-07-28)
covers the shared demo credential that was committed and
client-bundled in the new `apps/farm-os` build. Production financial data is already live, so this
remediation is overdue. Close it before any further real Ebeid/PII import or identity onboarding.
**Owner-executed** where steps touch external systems or live identities. This is the exact runbook
(referenced from `OWNER-DECISIONS-2026-06-24.md` §3).

### 2026-08-06 remediation evidence

- Credential cells were cleared from the known parsed workbook/archive copies. A structured scan found no
  known credential, adjacent-password or legacy account-label hit afterward; 88 parser failures remain explicit
  and are not claimed clean.
- Canonical workbook and exception-evidence SHA-256 pins were rotated. Canonical validation passes 102/102; a
  private-corpus verifier compares 149,593 retained cells, permits only the two credential cells to disappear,
  and proves 33,751 formulas unchanged. Redacted or absent cached formula results are disclosed rather than
  claimed value-compared. The existing 698-row production batch remains untouched.
- The pin remediation is included in the locally green 2026-08-07 accounting release rehearsal. Old Farm key
  retirement, old-source history cleanup, and Google password/2FA verification remain external controls.

## What's exposed (per the risk register)
- An **anon key + project id** committed in the **old repo's** git history.
- A **Gmail address + password** was embedded in the **accounting spreadsheet** and has been removed from every
  parsed known copy; the Google account remains compromised until password rotation and 2FA are verified.
- Treat all of the above as **compromised** until rotated/purged.

## Steps

### A. Rotate / retire the legacy Supabase keys
1. In the **old** Supabase project: Settings → API → **roll** the `anon` and `service_role` keys
   (or, if the project is unused, **pause/delete** it entirely — simplest).
2. Update any still-live consumer of the old keys, or confirm there are none.

### B. Purge secrets from the old repo's git history
1. Mirror-clone the old repo, then scrub with `git filter-repo` (preferred) or BFG:
   ```bash
   git filter-repo --replace-text <(printf '<OLD_ANON_KEY>==>REDACTED\n<OLD_PROJECT_ID>==>REDACTED\n')
   ```
2. `git push --force --all` and `--tags` to overwrite history. **Note:** forks/clones may retain
   the secret — rotation (step A) is the real fix; history purge is hygiene.
3. Alternatively, if the old repo is dead: make it **private** and archive it (after A).

### C. Scrub the accounting spreadsheet
1. Remove the embedded Gmail/password from the sheet (and any cached copies/exports).
2. **Rotate the Google account password** and enable 2FA (the password is compromised).
3. Per PROJECT RULES non-negotiable #6: flag the legacy data-quality issues (typos, the embedded
   credential) rather than copying them into the new system; keep owner drawings (مسحوبات)
   separate from operating expenses when this data is eventually migrated.

### D. Retire the shared demo credential in the NEW app (added 2026-07-28)

Unlike A–C this one starts in `apps/farm-os`, but it lands here because the remedy is the same shape:
a shared password (`[REDACTED RETIRED DEMO PASSWORD]`) was committed to git **and** shipped in the production login
bundle, together with the `*@ebeid.test` demo account addresses and a button that provisioned them
via `POST /api/dev/seed-auth`.

**Done in code and production** (PR #933): blank login fields; demo chooser, shared password, activation button and copy removed;
`app/api/dev/seed-auth/route.ts` + `lib/seed-auth.ts` deleted; the `api/dev` proxy exclusion removed;
e2e moved to a required per-run `FARM_OS_E2E_PASSWORD`; a source-contract regression test added.
Detail in [`SECURITY-NOTES.md`](SECURITY-NOTES.md) §5.

**Completed live on 2026-08-05.** In the production Supabase project (`veezkmytervjnpxcrbkw`):
1. List the `*@ebeid.test` identities.
2. Capture a read-only mapping of each `auth.users.id`, `people.user_id`, organization membership,
   and role before changing anything.
3. For each, **rotate to a unique strong secret, delete it, or replace it with a real recoverable
   account** for the actual person — then re-link `people.user_id` / `organization_member`.
4. After each change, verify login and RLS-scoped access for the intended role before proceeding.
5. Confirm nothing still authenticates with `[REDACTED RETIRED DEMO PASSWORD]` (treat it as compromised everywhere it
   was reused; it was in git history and in the client bundle, so removing it from HEAD does not
   retract it).
6. Enable Supabase Auth **leaked-password protection** (`SECURITY-NOTES.md` §1.4) so known secrets
   are rejected on sign-up/reset.

Postflight evidence: leaked-password advisors = 0; `*@ebeid.test` users = 0; email-null phone-only users = 0;
and linked people/organization memberships for both populations = 0. The deleted identities cannot
authenticate with the retired shared password. No credential value was read or persisted during verification.

As in step B: history purge is hygiene; **rotation/deletion is the real fix**.

## Verification (Definition of Done)
- [ ] Old anon/service keys rotated or project deleted; old keys no longer authenticate.
- [ ] Secret scan of the old repo (e.g. `gitleaks detect`) is clean on the new HEAD.
- [x] Spreadsheet credential removed from all parsed known copies; 88 parser failures remain explicit.
- [ ] Google password rotated and 2FA enabled and verified.
- [x] Production `*@ebeid.test` and phone-only synthetic identities deleted with no dangling people/membership
      links; leaked-password protection enabled (D), verified 2026-08-05.
- [ ] Risk-register entry flipped from 🔴 OPEN → closed in `PROJECT-TRACKER.md` / `MASTER-PLAN.md`.

## Why it gates the rest
Production finance is already live under the separately recorded Stage-M controls. Until A–C close, do not add
further real Ebeid/PII sources, onboard identities, or transfer production data to another processor without the
applicable privacy review and explicit Owner approval.
