# Session Brief — Farm OS      Updated: 2026-06-23 by Claude (Owner: Amr Ebeid)
*Updated LAST, after meaningful work.*

## This session (2026-06-23) — independent security review DONE (gate #1)
Ran the independent MVP-0 security review (3 adversarial subagents: RLS / grants / engine,
then an app-layer pass). Findings fixed on branch **`fix/mvp0-security-remediation`** (7 commits,
not merged/pushed) — migration `0010` + test `05`. Highlights: **GRANT-C1** (unauthenticated
`anon` had full DML+EXECUTE incl. the SECURITY DEFINER engine — CRITICAL), **RLS-H1** (child
tables didn't validate parent org — cross-tenant write), **ENGINE-C1** (expiry double-counted),
**ENGINE-H1** (phantom purchase rec), plus HIGH-1 (org_member write lockdown), ENGINE-H2/SS/M1,
and B4 input-validation guards. Full record: **`docs/SECURITY-REVIEW-MVP0-2026-06-23.md`**.
- **Verified: 49/49 pgTAP green** (36 existing + 13 new). Docker crash-looped (`exit status 150`),
  so the suite was run via a new Docker-free harness: **`apps/farm-os/supabase/test-shims/`**
  (`run-pgtap-local.sh`). App `tsc` clean; TS unit tests 11/11.
- **Remaining for this workstream (Owner-gated / Docker-gated):** (1) Owner **merge sign-off** on
  the branch — I cannot approve my own change; (2) **Playwright e2e** on a healthy Docker stack to
  confirm no wedge-loop regression; (3) deferred to the Docker stack: B1 transactional inventory
  RPCs (non-atomic on_hand arithmetic → ledger-drift risk, HIGH integrity), D1 FORCE RLS,
  D2 `bin.reserved` reconciliation, B2 inventory role-gating, B3 hardcoded execution date/price.

## Where we are
Everything now lives in one **private monorepo: `github.com/AmrEbeid/Farm`** (npm workspaces) — `packages/ui` (design system), `docs/` (these product docs). Governed under the **AI Project Operating System v3** (CLAUDE.md / TRACKER / this brief / SPEC-0001 / MASTER-PLAN).

- **Design system — shipped (`@amrebeid/ui` v1.0).** Renamed from `@farm-os/ui` (the npm scope must match the GitHub owner). Full v1 catalog (~40 components: forms, data-display, overlays, nav/shell, Recharts charts, domain), two-tier white-label theming, token-purity gate, Changesets + **green GitHub Actions CI**. *(The original 9 components were synced to Claude Design "Farm OS UI" `115ae675…`; the expanded catalog has NOT been re-synced.)*
- **Farm OS app — MVP-0 BUILT (`apps/farm-os`), merged to `main`, CI green.** Next.js 16 + Supabase (local, via Docker) + Tailwind RTL, consuming `@amrebeid/ui`. Phases A–D: foundation, full data model + RLS + audit + Ebeid seed, the SPEC-0001 stock-coverage engine, all 14 screens, and a **Playwright e2e driving the full 11-step wedge loop (passing)**. 36 pgTAP + 11 Vitest + e2e all green.

**Important:** this is an *engineering* MVP-0 on a **local** DB. NOT deployed, NOT pilot-validated, NOT security-reviewed. Auth is email/password for seeded roles (phone-OTP UI is a skeleton).

## Approved to do next (the next safe slice)
Build is done; the remaining gates are **review + validation + infra**, all Owner-led:
1. **Independent security review — DONE this session** (branch `fix/mvp0-security-remediation`, 49/49 pgTAP). Next: Owner **merge sign-off** + the **Playwright e2e** on a healthy Docker stack; then the deferred B1/D1/D2/B2/B3 hardening (see the security-review doc).
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
