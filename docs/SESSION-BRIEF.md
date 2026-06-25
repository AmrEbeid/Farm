# Session Brief — Farm OS      Updated: 2026-06-25 by Claude (Owner: Amr Ebeid)
*Updated LAST, after meaningful work.*

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
- ⚠️ **Prod DB still at migration `0013`** — `0015`/`0016`/`0017`/`0018` are verified on `main` but a
  prod `db push` remains an Owner hard-stop (apply in order via `DEPLOY-RUNBOOK.md`; **`0018` is the
  core-engine change — ratify it specifically**). App runs without them.
- Also fixed: **CREATE-1** (#63) — `createPurchaseRequestFromShortage` find-or-create (reuse an open
  PR for the item+plan instead of duplicating + re-reserving). And **AUDIT-1** noted (INFO):
  `organization_member` has no audit trigger — not a vuln (client writes revoked), add it with
  role-management.
- **Open (Owner-gated / deferred):** **AUTHZ-1** (execute org-only, not role-gated — with the role
  model), **DEP-1** (`postcss<8.5.10` transitive via `next`, build-time only, low), **BUD-1** (INFO —
  budget gate is decision-support + owner-approval, AP-1/AP-5 server-side, no hard DB spend cap;
  `committed` display-only), **AUDIT-1** (INFO — see above). SoD finding renamed **AP-3→AP-5**
  (AP-3 was already the PR version-guard).

## 2026-06-25 — post-deploy hardening
With the app live, hardened + verified further: **prod re-verified** (all 6 role logins + per-role
RLS + `fn_stock_coverage` on the live stack); **app build now CI-gated** (`ci.yml` `app` job:
tsc + vitest + `next build --webpack`, #36); **README refreshed** to live state (#37); **B2 RESOLVED**
(#39, migration `0015`) — direct REST writes to inventory tables now require `inventory.write`,
closing a stock-forgery hole; unblocked by B1/D2 (app writes go through the bypassrls RPC). All green:
**pgTAP 78/78** + e2e + app/lib CI + Vercel. Also a **Playwright visual UX audit** (desktop +
mobile screenshots) found + fixed an **RTL mobile-sidebar overflow** on the field (`/m`) view (the
closed off-canvas drawer peeked ~90px) → **`@amrebeid/ui@1.1.1` published**; desktop screens
(dashboard/coverage/inventory/plan) reviewed clean. ⚠️ **Prod DB is at migrations 0001–0013**; `0015` (B2) is
verified on `main` but not yet `db push`ed to prod (prod migration = hard stop / Owner; app runs fine
without it). Remaining is unchanged: project-end deferred (key rotation, Stage 0, real-data, prod
db-push of 0015) + decision-gated minors (B3 actual-paid pricing; D1 FORCE RLS — low value).

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
- **Security key rotation — DEFERRED to project end (Owner decision, 2026-06-24).** The Supabase
  **DB password** + **service_role key** were pasted in the deploy chat; Owner will rotate at the
  end of the project. ⚠️ Caveat (Claude): rotate **before any real Ebeid data** regardless — the
  exposed service_role key bypasses RLS. Fine for now (synthetic data only). Also reset the demo password then.
- **Pilot validation — considered DONE (Owner, 2026-06-24):** the customer research was completed
  *before* the project (it produced the plan + the dummy/seed data), so the pilot-validation gate is satisfied.
- **Near-term: nothing required** — MVP-0 is deployed, live, and stable on synthetic data.
  **Deferred to project end (Owner):** key rotation (above), legacy **Stage 0** secret remediation,
  and real-Ebeid-data migration (after a privacy review). **Optional, agent-doable anytime:**
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
