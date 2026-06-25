<!--
Farm OS PR — keep it a small, independently-reviewable slice.
Merges are Owner-gated (Amr Ebeid); the reviewer/approver is never the author.
See CONTRIBUTING.md and docs/CLAUDE.md (PROJECT RULES).
-->

## What & why

<!-- One or two sentences: what changed and why. Link the SPEC / issue if any. -->

## Risk level

<!-- impact × probability × reversibility — take the highest tier any dimension implies. -->

- [ ] Low — internal / additive, no access-control, money, engine, or schema change
- [ ] Medium — user-facing behaviour or app logic
- [ ] High — touches RLS/access, money/budget/voucher logic, payroll/PII, the stock-coverage engine, the AI assistant, or a deploy → **independent review required**

## Checks (paste evidence, don't just assert)

- [ ] `npm run lint` / `typecheck` pass (app: `farm-os`; lib: `@amrebeid/ui`)
- [ ] Unit tests pass — `npm test` (vitest: `@amrebeid/ui` and/or `farm-os`)
- [ ] `npm run build` passes for the package(s) I touched
- [ ] No secrets added (keys/passwords/service-role) — not in code, env files, or logs

## Changeset (only for `@amrebeid/ui` published-surface changes)

- [ ] Added a changeset (`npm run changeset`) with the right bump (patch / minor / major)
- [ ] N/A — this PR does not change the published surface of `@amrebeid/ui`

## Database / migrations (only if `apps/farm-os/supabase/` changed)

- [ ] New migration added under `supabase/migrations/` (timestamped `YYYYMMDDHHMMSS_slug.sql`)
- [ ] Paired with a pgTAP test under `supabase/tests/` that pins the new behaviour (RLS / audit / invariant)
- [ ] Applied locally and the suite passes (`supabase db reset && supabase test db`, or the Docker-free shim)
- [ ] **Prod push is Owner-gated** — I am NOT pushing to the prod DB in this PR (see `docs/DEPLOY-RUNBOOK.md`)
- [ ] N/A — no schema change

## User-facing?

- [ ] Arabic-RTL verified and mobile-tolerant (field roles), or N/A
- [ ] N/A — not user-facing
