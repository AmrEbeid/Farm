# Session Brief — Farm OS      Updated: 2026-06-25 by Claude (Owner: Amr Ebeid)
*Updated LAST, after meaningful work.*

## 2026-06-25 (latest) — adopted amr-operating-method + independent review (5 findings) + repo relocation
**Working method:** adopted **`amr-operating-method`** (the gated protocol — propose → validate →
report → **STOP**, owner gates merges/migrations; no self-merge). Going forward, findings are filed
as issues + un-merged PRs for the Owner to gate.

**Repo relocated (Owner request):** the working copy is now **`~/projects/farm`** (old `~/farm-os-ui`
deleted; local `.env.local` + `.vercel/` migrated; verified functional — tsc + pgTAP 287/287). A
personal skills inventory was generated at `~/skills.md` (+ regen script `~/.claude/gen-skills.mjs`).

**Independent read-only security + core-engine review — 5 findings (1 fixed, 4 filed; all fixes
Owner-gated):**
- **CONC-1** ✅ fixed + merged (#168, migration `0033`): the #159 stock floor was a TOCTOU under
  concurrency; added `SELECT … FOR UPDATE` to serialize movements per bin.
- **AUTHZ-2** (#181, HIGH·latent): `authorize(perm)` is **not org-scoped** → a multi-org member can
  exercise a privileged role in an org where they hold only a low role. Violates Stage-1 acceptance.
- **AUTHZ-3** (#182, MED): `fn_post_movement` is `authenticated`-callable with **no `inventory.write`
  check** (definer bypasses table RLS; `0030` removed the only gated path) → B2's control isn't
  enforced on the real write path. Fix = revoke from `authenticated` + a gated reserve wrapper.
- **ENGINE-REC1** (#184, MED–HIGH): the purchase recommendation **double-subtracts period-1
  scheduled receipts** (shortfall is already net of them) → emits `shortage=true` **and**
  `recommend_qty=0` + "stock sufficient" — a contradictory, shortage-masking output (SPEC-0001 #1 risk).
- **PII-1** (#173, MED): `people.rate`/phone/email org-readable by any member (no role gate); fix
  designed in SPEC-0006.
- **SPEC-0002 updated** to consolidate AUTHZ-1/2/3 + PII-1 and correct a now-false claim
  (`fn_post_movement` is *not* gated) → **PR #183 (OPEN, awaiting your gate — not merged).**

**Confirmed sound:** auth/route boundary (middleware + `requireMembership` redirect + per-action
self-protect + only one guarded `api` route), `op.execute` enforcement (`0020`/`0025`), SoD (AP-5),
`fn_post_receipt` atomicity + concurrency-safe claim, delete-posture (`0027`), `audit_log`
immutability (AP-4), `authorize` injection-safety, PvA variance math.

**Theme across the authz findings:** *role/permission gates must be enforced at the definer-RPC/data
layer and **org-scoped** — not on table RLS that definers bypass, nor globally across a user's
memberships.* Natural next step: ratify the expanded SPEC-0002 (#183) → build the enforcement
migration in gated slices. **Open queue for the Owner:** issues #173/#181/#182/#184, PR #183; plus the
still-pending prod push of `0030`–`0033` (now incl. CONC-1 `0033`).

## 2026-06-25 — Arabic error-mapping thread closed (#178–#180 merged)
Finished mapping every RPC-calling field action's Postgres SQLSTATEs to Arabic, so a DB-raised error
never leaks raw English to field users (non-negotiable #2). All three **merged to `main`**, all CI
green (app typecheck/lint/test/build, pgTAP, Storybook, CodeRabbit, Vercel):
- **#178** — `executeOperation`: map `23514` (insufficient stock) → «المخزون غير كافٍ لتنفيذ هذه الكمية».
- **#179** — `reserve` (coverage): map the reserve-RPC errors → Arabic, consistent with #178.
- **#180** — `recordReceipt`: map `22023` → «بند في الطلب يحمل كمية غير صالحة». The last raw-message
  fall-through: a malformed PR line (qty ≤ 0) makes `fn_post_movement` raise `22023` via the
  `fn_post_receipt` chain (type is the constant `'receipt'`, so `22023` here can only mean bad qty —
  the message is precise). **App-layer only — no migration, no engine/RLS surface touched.**
- **State:** all merged; `main` green (HEAD `b0aaf3b`); **no open PRs**. ⚠️ **prod still at `0029`**
  (unchanged by this thread — these are app-code-only, ship via the Vercel deploy on merge). The prod
  push of `0030`–`0033` (incl. CONC-1) remains Owner-gated, as do the items below.
- **Stale branches** (not on critical path): `docs/review-followup-0625` (3 ahead),
  `fix/pr-approval-sod-bypass` (2 ahead), `fix/74-silent-failures` (0 ahead — safe to delete).

## 2026-06-25 — independent review (CONC-1 fix + PII-1) + complete SPEC corpus + roadmap
A follow-on session that **reconciled to the advanced `main`** (it had moved to migration `0031` +
prod `0029` via the 8-agent re-audit; an earlier fork was stale — re-read the repo first) and then:
- **CONC-1 (fixed, #168, migration `0033`):** the #159 stock floor (`0031`) was a TOCTOU under
  concurrency — the floor read `on_hand` with no lock + `fn_bin_rebuild` locks only at its closing
  UPDATE, so two simultaneous outflows could drive `on_hand` negative. Fixed: `SELECT … FOR UPDATE`
  the bin row before the floor check (serializes movements per bin). Shim harness 287/287.
- **PII-1 (filed, issue #173, MED):** `people.rate` (wages) + phone/email are org-readable by any
  member (`tenant_all`, no role gate) via PostgREST — UI-gated, not RLS-gated. Fix is Stage 8 (a
  `people_compensation` table) — designed in SPEC-0006, not a blind patch.
- **#161 L2 + L5 (fixed, #176):** seed-auth route got a `VERCEL_ENV !== 'production'` belt-and-braces
  gate; `lib/stock-calc.ts` aligned to the SQL (`available = on_hand − reserved`, expiry already
  netted into on_hand per ENGINE-C1) + oracle tests corrected. (L1/L3/L4/L6 left — deferred/design/
  non-exploitable.)
- **Re-confirmed sound:** `0025` (AUTHZ-1 operation-tables RLS — every app write path matches its
  gate), `0027` (delete posture).
- **Completed the SPEC corpus:** every stage now has a DRAFT spec for Owner ratification — SPEC-0003
  (Stage 2 palm import), 0004 (Stage 7 accounting), 0005 (Stage 11 AI / trifecta-safe), 0006 (Stage 8
  payroll/PII), 0007 (Stage 9 weather), 0008 (Stage 10 Care Academy) — plus
  **`ROADMAP-path-to-finish-2026-06-25.md`** (the dependency-ordered plan).
- **State:** all merged; `main` green; **no open PRs**. ⚠️ **prod still at `0029`** — `0030`–`0033`
  (incl. CONC-1; `0018`/`0033` are core-engine) verified on `main`, pending the Owner prod push. The
  project is now **decision-bound, not design-bound** — next moves need Owner ratification of a SPEC,
  the prod push, the HIGH forks (#155/#156/#157/#173/#89), and the agronomist (Stage 10 long-pole).

## 2026-06-25 — Storybook 8.6→10.4 toolchain upgrade + @amrebeid/ui 1.2.0 published
Coordinated **MAJOR** Storybook upgrade for `packages/ui` (the `@amrebeid/ui` design system),
landing the deferred Dependabot bump #131 properly (it had failed install with ERESOLVE because
only `@storybook/react-vite` was bumped while the rest of the 8.6.x stack stayed put).
- **Full footprint inventoried** — only **3** Storybook packages, not a 14-addon stack:
  `@storybook/react-vite`, `storybook` (core), `@storybook/addon-essentials`, declared in the repo
  root + `packages/ui`; one config dir `packages/ui/.storybook/`; 49 `*.stories.tsx`. `apps/farm-os`
  and `docs/export` have **zero** Storybook deps.
- **Upstream availability checked** per package: `@storybook/react-vite` + `storybook` exist at `10.4.6`
  (latest). `@storybook/addon-essentials` has **no v9 stable / no v10** — by design: Storybook 9+ folded
  the essentials addons (controls, actions, backgrounds, viewport, docs, measure, outline) into core
  `storybook` and stopped publishing the standalone addon. **Not a block** (unlike the ESLint-10 /
  `eslint-plugin-react` case) — the correct action is to remove it.
- **Changes:** bumped `@storybook/react-vite` + `storybook` `8.6.14`→`^10.4.6` (root + `packages/ui`);
  **removed** `@storybook/addon-essentials` (deps + the `addons` array in `.storybook/main.ts`);
  migrated `.storybook/preview.ts` (Preview type import `@storybook/react`→`@storybook/react-vite`;
  `backgrounds` `values[]`+`default` → `options` map + `initialGlobals`; defaults off the deprecated
  `globalTypes.defaultValue` → `initialGlobals`); migrated all **49** story imports
  `@storybook/react`→`@storybook/react-vite`. Kept TypeScript at the repo's `^6.0.3` (did NOT take
  Dependabot's incidental TS 6→5.6.3 downgrade).
- **Lockfile:** updated **surgically** (pruned only the `@storybook/*`+`storybook` entries and
  re-resolved) to preserve the existing `@types/react` hoisting (`19.2.17` root / `18.3.31` nested under
  `packages/ui`) — a full from-scratch regen flipped it and broke the `apps/farm-os` typecheck; the
  surgical approach keeps both CI jobs green. **No `--force` / `--legacy-peer-deps` / overrides hacks.**
- **All CI gates verified green** locally AND on GitHub runners (build job: typecheck, tokens:present,
  tokens:purity, 270 unit+a11y tests, tsup build, **build-storybook**; app job: typecheck, eslint,
  75 tests, `next build`; pgTAP).
- **PR #154** (`chore/storybook-10`) merged to `main` by the Owner; superseded Dependabot **#131**
  (auto-closed). The changesets release flow then published **`@amrebeid/ui@1.2.0`** to npm + pushed tag
  `@amrebeid/ui@1.2.0` (PR #162 release-PR merge) — carrying this upgrade plus the 4 queued UI changesets
  (a11y, datatable-mobile, recharts code-split, reduced-motion). `packages/ui/package.json` now `1.2.0`.
- **Also landed by Owner this session (not authored here):** PR **#163** (`#158`, lock
  `inventory_movements` INSERT to the RPC path — closes a forgeable ENGINE-DC bypass) and PR **#164**
  (`#159`, floor `on_hand` at 0 in `fn_post_movement` — no negative stock). Both stock-engine/security
  fixes are merged on `main` (HEAD `52fa7b0`); confirm prod DB migration state separately.
- **Safe stop:** the upgrade + release are complete. **No agent-doable, non-gated task remains on the
  critical path** — everything left is Owner-gated (🔴 key rotation; Leaked Password Protection toggle;
  pricing #89; Stage-0 ratification; Stage M) or "do not start the next stage automatically" per
  `docs/CLAUDE.md`. Stopping per project rules.

## 2026-06-25 — phone-OTP removed (email/password only)
Auth is now **email + password only**. The phone-OTP UI skeleton (the login footnote) was removed and
a brief comment was added above `[auth.sms]` in `supabase/config.toml` (SMS already disabled). **Twilio /
any SMS provider is dropped from MVP-0 scope** — OWNER-DECISIONS §2 marked RESOLVED, and the active docs
(deploy runbook, pilot-readiness, screen-map, architecture) now say "email + password (phone-OTP
removed)". The seed `phone` field is untouched — it is a demo-linking key + contact data, not auth.
Branch `chore/remove-phone-otp` (PR open, **not merged** — Owner gate). `tsc`/lint/tests verified (the 3
known pre-existing `bigint`-not-`ReactNode` `tsc` errors in `layout.tsx`/`AppChrome.tsx`/`SimpleTable.tsx`
are unrelated and unchanged).

## 2026-06-25 — prod migration push (0015→0022) + authz/ledger hardening
After an **8-agent adversarial prod-push assurance** returned **GO-WITH-CAVEATS**, migrations
**`0015`→`0022`** were applied to the prod Supabase (`veezkmytervjnpxcrbkw`) via the Supabase MCP
(`0018` engine change **Owner-ratified** first). **Prod DB is now at `0022`** (`0001–0013` +
`0015–0022`, recorded under their repo versions), **fully seeded** (1 org, 6 organization_member,
12 auth.users, full synthetic dataset: 1 farm, 60 assets, 28 hawshat, 5 sectors, 6 inventory
items/bins/movements, 1 plan w/ 3 operations + checks + budget). Transactional tables (`farm_event`,
`purchase_requests`, `expenses`, `audit_log`) start **empty** — correct pilot state.
- **New this session** (branch `fix/authz-1-execute-rpc`, PR #75, commit `31ad992`): **`0021`** locks
  SECURITY DEFINER fn EXECUTE grants (revoke `anon` on write RPCs `fn_execute_operation`/
  `fn_post_movement`; revoke public+anon+authenticated on trigger fns `pr_guard_approval`/`fn_audit`/
  `fn_audit_org_member`) and **`0022`** revokes UPDATE on `inventory_movements`/`inventory_bin` →
  ledger now **fully append-only**, closing **#76 item 1**. New pgTAP tests `19`+`20`.
- **Verified: pgTAP 126/126** on a clean reset (was 103).
- **Residual caveats — QUEUED, not blocking, not live-exploitable on synthetic single-tenant data:**
  **AUTHZ-1 Option B** (gate operation tables `plan_operations`/`farm_event`/`event_locations`/
  `quantities` at the REST layer, not only the `0020` RPC); **AP-5 insert-side SoD** (#76 item 2 —
  a born-approved PR sidesteps the BEFORE UPDATE trigger); **ENGINE-DC** disjointness is
  convention-enforced, not DB-constraint-enforced.
- **Still OWNER-GATED / open:** 🔴 rotate the Supabase `service_role` key + DB password + reset the
  demo password (the **only red item** from the assurance); ~~Twilio phone-OTP~~ (resolved 2026-06-25 —
  dropped; email/password only); Stage-0 legacy
  remediation; real Ebeid data (Stage M); per-farm EGP pricing; agronomist sign-off; **merging PRs
  #75 and #77** (both green) — a merge = prod deploy = Owner gate.
- Note: the local Docker DB was found empty after a reboot (volume not persisted) — irrelevant; the
  **cloud DB is the source of truth**.

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
- ⚠️ **(superseded — see the 2026-06-25 (latest) entry above):** at the time of this entry the prod DB
  was still at migration `0013` with `0015`–`0019` verified on `main` but unpushed; the `0015`→`0022`
  push (incl. the Owner-ratified `0018`) was subsequently applied to prod — **prod DB is now at `0022`**.
- Also fixed: **CREATE-1** (#63, find-or-create) and **AUDIT-1** (#68, migration `0019`, test `17` —
  a dedicated `fn_audit_org_member` trigger puts membership/role changes on the append-only audit_log).
- Test coverage added: **#67** (test `16` engine approve→receive round-trip disjointness), **#56**
  (test `14` ENGINE-DC). Runbook **#65** documents the gated `0015→0019` prod push. **pgTAP 103/103**
  (17 files) + wedge-loop e2e green.
- **AUTHZ-1 partial fix (#71)** + **SPEC-0002 DRAFT (#69)**: the app-layer `op.execute` gate landed
  (`executeOperation` now calls `authorize('op.execute')`; e2e executes as supervisor, passes) —
  defense-in-depth. SPEC-0002 records that the role model already exists (migration `0001`) and
  proposes the authoritative RLS/`bypassrls` enforcement (Option A). **That enforcement migration is
  Owner-gated** (ratify SPEC-0002 first); until then the operation tables stay directly REST-writable.
- **Open (Owner-gated / deferred):** **AUTHZ-1** (authoritative Option A — SPEC-0002 ratify → migration),
  **DEP-1** (`postcss<8.5.10` transitive via `next`, build-time only, low), **BUD-1** (INFO — budget
  gate is decision-support, AP-1/AP-5 server-side, no hard DB spend cap), **CREATE-2** (LOW —
  `addPlanOperation` non-idempotent/non-atomic, planning-path, conservative). SoD finding renamed
  **AP-3→AP-5** (AP-3 was already the PR version-guard).

## 2026-06-25 — post-deploy hardening
With the app live, hardened + verified further: **prod re-verified** (all 6 role logins + per-role
RLS + `fn_stock_coverage` on the live stack); **app build now CI-gated** (`ci.yml` `app` job:
tsc + vitest + `next build --webpack`, #36); **README refreshed** to live state (#37); **B2 RESOLVED**
(#39, migration `0015`) — direct REST writes to inventory tables now require `inventory.write`,
closing a stock-forgery hole; unblocked by B1/D2 (app writes go through the bypassrls RPC). All green:
**pgTAP 78/78** + e2e + app/lib CI + Vercel. Also a **Playwright visual UX audit** (desktop +
mobile screenshots) found + fixed an **RTL mobile-sidebar overflow** on the field (`/m`) view (the
closed off-canvas drawer peeked ~90px) → **`@amrebeid/ui@1.1.1` published**; desktop screens
(dashboard/coverage/inventory/plan) reviewed clean. ⚠️ **(prod-DB note superseded — prod is now at
`0022`; see the 2026-06-25 (latest) entry above)** at the time of this entry prod was at migrations
0001–0013 with `0015` (B2) verified on `main` but not yet `db push`ed. Remaining is unchanged:
project-end deferred (key rotation, Stage 0, real-data) + decision-gated minors (B3 actual-paid
pricing; D1 FORCE RLS — low value).

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
