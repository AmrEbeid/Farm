# Stage 0 — Legacy Secret Remediation Runbook

**Status: OPEN (Critical).** Concerns the **legacy** system (the old repo + the accounting
spreadsheet), NOT the new `apps/farm-os` build. Must close before real Ebeid data / production.
**Owner-executed** — these are irreversible and touch systems the agent has no access to. This is
the exact runbook (referenced from `OWNER-DECISIONS-2026-06-24.md` §3).

## What's exposed (per the risk register)
- An **anon key + project id** committed in the **old repo's** git history.
- A **Gmail address + password** embedded in the **accounting spreadsheet**.
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

## Verification (Definition of Done)
- [ ] Old anon/service keys rotated or project deleted; old keys no longer authenticate.
- [ ] Secret scan of the old repo (e.g. `gitleaks detect`) is clean on the new HEAD.
- [ ] Spreadsheet credential removed; Google password rotated + 2FA on.
- [ ] Risk-register entry flipped from 🔴 OPEN → closed in `PROJECT-TRACKER.md` / `MASTER-PLAN.md`.

## Why it gates the rest
PROJECT RULES: "Building Stage 1+ code before Stage 0 (security/data) is closed" is **not approved**,
and real data must not enter any environment before this closes. Deploy (`DEPLOY-RUNBOOK.md`) may
proceed with **synthetic seed** data, but real Ebeid financials/PII wait for Stage 0 + a privacy review.
