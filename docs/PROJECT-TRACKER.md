# Project Tracker — Farm OS      Last updated: 2026-06-26 by Claude (for Owner: Amr Ebeid)

> **2026-06-26 (later) — prod pushed to `0035`, IN SYNC with `main` (live-verified):** applied
> **`0032`** (`pr_items_lock_and_version_bump`), **`0033`** (`fn_post_movement_floor_lock`, CONC-1),
> **`0034`** (`engine_stale_po_guard`, ENGINE-STALE-1 #197) and **`0035`** (`authorize_org_scoped`,
> AUTHZ-2 #181) to the prod Supabase (`veezkmytervjnpxcrbkw`) via the MCP, recorded under their exact repo
> versions. Verified live: `list_migrations` → `0035`; the `fn_stock_coverage` guard + `fn_post_movement`
> `FOR UPDATE` lock present; `authorize` is now the 2-arg org-scoped overload (1-arg dropped) and all 7
> policies + the 2 RPCs call it (`multi_org_members = 0`, so zero behavior change on current data);
> baseline coverage correct; `get_advisors` shows only pre-existing WARNs (no new regressions).
> **Authoritative current prod state: `0048`** — after the `0035` push, **`0036`** (FK perf indexes, #230)
> and **`0037`** (`authz3_reserve_wrapper`, AUTHZ-3 #182 — `fn_post_movement` made internal + gated
> `fn_reserve_stock` wrapper) were also applied + verified (fn_post_movement no longer
> authenticated-executable; the wrapper enforces inventory.write); then **`0038`** (`fn_add_plan_operation`,
> #196 — atomic plan-operation RPC); then **`0039`** (`fn_update_palm_status`, #238 — op.execute-gated
> atomic palm-status RPC), **`0040`** (`engine_rec1_fix`, #184 — removed the recommendation's period-1
> receipts double-subtract) and **`0041`** (`inventory_unit_cost`, #89-B — manual unit_cost, NULL when
> unknown, removes the fabricated *84) were applied + verified. Since then the **`0042`–`0046`** batch was
> applied + verified: **`0042`** plan_req_rolegate, **`0043`** budget_rolegate, **`0044`** expenses_rolegate
> (the Owner's RLS role-gates on plan-req/budget/expenses, closing the no-role-gate class B2/AUTHZ-1), **`0045`**
> partial_receipts (#155 — received_qty + partially_received + remaining-based projection + received_qty
> column-UPDATE lockdown), **`0046`** people_compensation (PII-1 #173 wage slice — `payroll.read` perm,
> `people_compensation` table, `people.rate` dropped). **Then `0047`** engine_nulldate_guard (#198 — `fn_stock_coverage`
> now coalesces a NULL `planned_at` to period 1 so null-dated demand is never silently dropped) was applied + verified
> (no-op for dated ops; potassium recommendation unchanged at 600). **Then `0048`** contact_pii_lockdown (PII-1 #173
> phone/email slice — deny-by-default: `revoke select on people from authenticated` + re-grant all columns except phone/email;
> phone column retained for service-role linking) was applied + verified (members can no longer read phone/email; non-PII still
> readable). **#173/PII-1 is now FULLY DONE — both the wage slice `0046` and the contact slice `0048`.**
> Verified (`list_migrations` → `20260622000048`); pgTAP 421/421.
> Also merged app-only (no migration): the `/m` field-view fixes (#268 — dropped a hardcoded plot name, corrected the
> "today" heading, subtype-derived execute defaults) and the plans-page fixes (#269 — plan-block labeled by real cause
> budget-vs-stock, not-found guard, stepper state). A comprehensive app bug-sweep this session confirmed
> auth/middleware/inventory/farm-sector/all action files clean.
> A duplicate non-repo perf-index record (`20260626053743`) was removed so prod history matches the repo exactly.
> *(This session prod went stale-docs→`0031`→`0034`→`0035`→`0037`→`0038`→`0041`→`0046`→`0047`→`0048`.)*
> This supersedes the stale figures elsewhere — the `0028`/`0029` prod claims in older entries (and `0023`
> in the READMEs) were mid-push or lagging snapshots, now corrected. No code/schema changed in this
> reconciliation. (Also surfaced this session: a local-only branch `feat/stage-2-farm-structure` holds
> **unratified** Stage 2 WIP — farm-structure read-views + a registry reconciliation oracle that hardcodes
> **5 sectors**, an open Owner decision per SPEC-0003; do not merge before SPEC-0003 ratification + the
> 4-vs-5 sector call. And three app-layer findings filed: **#187** (AR-ERR-1 Arabic error-mapping gaps,
> non-gated), **#188** (CREATE-1-RESERVE orphaned reservation, review-gated), plus a note on **#89**
> (hardcoded `needed_by` has an engine-projection consequence).)

> **2026-06-25 — Storybook 10 toolchain upgrade + `@amrebeid/ui` 1.2.0 published (merged):** the deferred
> Storybook major (Dependabot #131, ERESOLVE) landed properly via **PR #154** (`chore/storybook-10`).
> Whole Storybook stack `8.6.14`→`10.4.6` (`@storybook/react-vite` + core `storybook`), `@storybook/addon-essentials`
> **removed** (Storybook 9+ folded essentials into core — no v9/v10 release exists, by design; **not** an
> upstream block). `.storybook/main.ts`+`preview.ts` migrated (renderer→framework import; `backgrounds`
> `values`→`options`+`initialGlobals`); all **49** `*.stories.tsx` imports moved to `@storybook/react-vite`.
> Lockfile updated **surgically** to preserve `@types/react` hoisting (kept the `apps/farm-os` typecheck
> green); **no `--force`/`--legacy-peer-deps`**. All CI green (build job incl. **build-storybook**; app job;
> pgTAP) locally + on GitHub. Owner merged #154 (#131 auto-closed). The changesets flow then published
> **`@amrebeid/ui@1.2.0`** to npm + tag `@amrebeid/ui@1.2.0` (release PR #162), carrying this upgrade + the
> 4 queued UI changesets (a11y, datatable-mobile, recharts code-split, reduced-motion); `packages/ui` now `1.2.0`.
> Also merged by Owner this session (not authored here): **#163** (`#158`, lock `inventory_movements` INSERT
> to the RPC path — forgeable ENGINE-DC bypass) and **#164** (`#159`, floor `on_hand` at 0 in
> `fn_post_movement`) — both stock-engine/security fixes on `main` (HEAD `52fa7b0`); **confirm prod migration
> state separately before relying on them in prod.**
>
> **2026-06-25 — DB hardening session (merged + APPLIED to prod):** the queued security caveats
> from the prod-push assurance are now **closed in code and live on prod**. Prod Supabase
> (`veezkmytervjnpxcrbkw`) advanced **`0024`→`0028`**, fully in sync with `main` — all migrations
> applied + verified live; the full pgTAP suite is green locally and in CI at every step. Each landed
> as its own CI-green PR:
> - **AUTHZ-1 Option B** — PR #146, migration `0025_operation_tables_rls_authz`: REST-layer role gate on
>   the operation tables. `farm_event` (+ partitions) / `event_locations` / `quantities` gated to
>   `op.execute` (preserving the RLS-H1 parent-org `EXISTS` check); `plan_operations` gated to
>   `plan.write` (matches the planning action). Closes the direct-PostgREST forge-a-done-operation
>   surface. (test `26`)
> - **ENGINE-DC** — PR #144, migration `0026_engine_dc_constraint`: a `BEFORE INSERT` trigger on
>   `inventory_movements` (`type='receipt'`) rejecting a receipt while an approved-not-received PO for
>   the same `(org,item)` still exists — turns `0018`'s disjointness invariant into a hard DB control.
>   `fn_post_receipt` is claim-first so the legit path is safe. (test `27`)
> - **DELETE-posture** — PR #140, migration `0027_delete_posture_remediation`: `REVOKE DELETE` from
>   `authenticated,anon` on **27 tenant tables**; `plan_checks` intentionally kept deletable (the only
>   legit client delete). (test `28`)
> - **D1 FORCE RLS** — PR #142, migration `0028_force_rls_tenant_tables`: `FORCE ROW LEVEL SECURITY` on
>   all **35** RLS-enabled tenant tables. (test `29`)
>
> **pgTAP now 217 assertions, all green** (Docker-free shim harness + CI). **B2 inventory receipt
> role-gating assessed = ALREADY COVERED** (`fn_post_receipt` + the `0015` policy both enforce
> `inventory.write`) — no migration needed. **AP-5 insert-side SoD** (#76 item 2) confirmed **ALREADY
> merged earlier** (migration `0023`, test `21`) — **RESOLVED**. Other PRs merged this session: **#111**
> (generated Supabase types + typed clients), **#127** (`@playwright/test` patch), **#129**
> (`react`/`react-dom` → 19.2.7); #123/#125/#85/#139 merged earlier in the day. **Live verification:**
> manager login OK; authenticated reads (`farms`/`plans`) HTTP 200; DELETE `expenses` as manager →
> HTTP 403 (permission denied). Demo login fixed earlier — all 6 `@ebeid.test` accounts reset to
> `farm-os-pilot`. **Prod hygiene:** dropped the stray `pgtap` extension from prod `public` (a Supabase
> advisor WARN). **Dependabot majors DEFERRED** (open, commented): #128 TypeScript 6.0 (tsconfig
> `baseUrl` deprecation hard-errors), #130 ESLint 10 (`eslint-plugin-react` incompatible with the v10
> rule API), #131 Storybook 10 (ERESOLVE across the 8.6.x addon stack). **🔴 Still NOT done — KEY
> ROTATION** (blocked on tooling: no `SUPABASE_ACCESS_TOKEN`, supabase not linked, no Vercel CLI, MCP
> has no key-rotation tool) — needs the Owner to rotate `service_role` + DB password (+
> `NEXT_PUBLIC_SUPABASE_ANON_KEY` if the JWT secret rotates), update Vercel env, redeploy; and to
> enable **Leaked Password Protection** (HaveIBeenPwned) via the Auth dashboard toggle. Detail:
> [`SECURITY-REVIEW-FOLLOWUP-2026-06-25.md`](SECURITY-REVIEW-FOLLOWUP-2026-06-25.md).
>
> **2026-06-25 follow-up security review (merged):** a second independent pass closed **B2.1**
> (append-only stock ledger, migration `0016`, #42), **AP-5** (PR self-approval SoD trigger,
> migration `0017`, #47), **EXE-1** (idempotent operation execute / claim-first, #51), **RCP-1**
> (idempotent PR receipt / claim-first, #57), **ENGINE-DC** (stock-coverage receipt double-count
> → fixed via direction #2: scheduled receipts sourced from approved POs, migration `0018`, #61), and
> **CREATE-1** (idempotent PR-create / find-or-create, #63), and **AUDIT-1** (audit
> `organization_member` changes, migration `0019`, #68) — plus a lint fix (#43), findings/runbook docs
> (#45/#49/#54/#55/#58/#59/#60/#62/#64/#65/#66), the ENGINE-DC TODO regression (#56) + engine
> round-trip test (#67), and the **SPEC-0002 authorization-enforcement DRAFT (#69, Owner-gated)**. All
> merged to `main` after independent diff review + local pgTAP/e2e verification; **pgTAP 103/103** (17
> files) + wedge-loop e2e green. **Prod DB still at `0013`** — pushing `0015`/`0016`/`0017`/`0018`/`0019`
> remains an Owner hard-stop (**`0018` is the core-engine change — ratify specifically**; the
> EXE-1/RCP-1/CREATE-1 fixes are app code, no migration). Open findings (all Owner-gated / deferred):
> **AUTHZ-1** (app-layer `op.execute` gate landed #71; authoritative RLS enforcement — SPEC-0002
> Option A — awaits Owner ratification, then a migration), **DEP-1** (`postcss<8.5.10` transitive via
> `next`, build-time only), **BUD-1** (INFO — the budget gate is decision-support + owner-approval, not
> a hard DB spend cap; `committed` is display-only), **CREATE-2** (LOW — `addPlanOperation`
> non-idempotent/non-atomic, planning-path, conservative). SoD finding renamed AP-3→AP-5
> (AP-3 = the PR version-guard). Detail:
> [`SECURITY-REVIEW-FOLLOWUP-2026-06-25.md`](SECURITY-REVIEW-FOLLOWUP-2026-06-25.md).
>
> **2026-06-25 prod-push (applied):** after an 8-agent adversarial prod-push assurance returned
> **GO-WITH-CAVEATS**, migrations `0015`→`0022` were applied to the prod Supabase project via the
> Supabase MCP (`0018` engine change Owner-ratified). **Prod DB is now at `0022`** (`0001–0013` +
> `0015–0022`), fully seeded (1 org, 6 org members, 12 auth.users, full synthetic dataset; transactional
> tables empty — correct pilot state). New this session on branch `fix/authz-1-execute-rpc` (PR #75,
> commit `31ad992`): **`0021`** (lock SECURITY DEFINER EXECUTE grants — revoke `anon` on write RPCs
> `fn_execute_operation`/`fn_post_movement`; revoke public+anon+authenticated on trigger fns
> `pr_guard_approval`/`fn_audit`/`fn_audit_org_member`) and **`0022`** (revoke UPDATE on
> `inventory_movements`/`inventory_bin` → ledger fully append-only, closes #76 item 1), with pgTAP
> tests `19`+`20`. **pgTAP now 126/126** on a clean reset (was 103). Residual caveats (QUEUED, not
> blocking, not live-exploitable on synthetic single-tenant data): **AUTHZ-1 Option B** (gate operation
> tables `plan_operations`/`farm_event`/`event_locations`/`quantities` at the REST layer, not only in
> the `0020` RPC); **AP-5 insert-side SoD** (#76 item 2 — a born-approved PR sidesteps the BEFORE UPDATE
> trigger); **ENGINE-DC** disjointness is convention-enforced, not DB-constraint-enforced. PRs #75/#77
> are both green; merging either = prod deploy = **Owner gate**.
>
> **2026-06-25 — phone-OTP removed:** auth is **email + password only**. The phone-OTP UI skeleton
> (login footnote) is gone and `[auth.sms]` stays disabled in `supabase/config.toml`; Twilio / any SMS
> provider is **dropped from MVP-0 scope** (OWNER-DECISIONS §2 resolved). The seed `phone` field stays
> as a demo-linking key + contact data — it is not auth. (branch `chore/remove-phone-otp`.)

## Current focus
One private monorepo `github.com/AmrEbeid/Farm` (`packages/ui` + `apps/farm-os` + `docs/`). The **design system** (`@amrebeid/ui` **v1.1.0, published** to GitHub Packages, green CI) and the **Farm OS MVP-0 app** are both **BUILT** and on `main`. The **independent security review is DONE + merged** (RLS/grants/engine fixes, the `db-tests` pgTAP CI gate, the `fn_post_movement` B1 primitive). The full inventory path (B1 rewiring + **D2 ledger-backed `reserved`**) is **merged + verified** (74/74 pgTAP + the Playwright wedge-loop e2e pass on the real Supabase stack). The app is now **DEPLOYED + LIVE** (2026-06-24) on **farm-ui-one.vercel.app** + **ebeidfarm.business** with a dedicated Supabase project — login + RLS + the stock-coverage engine verified on prod (see `DEPLOY-STATUS.md`). **What's left:** **Key rotation — deferred to project end (Owner, 2026-06-24):** rotate the Supabase DB password + service_role key (pasted in the deploy chat) + reset the demo password — but do it **before any real data** regardless (the exposed service_role key bypasses RLS). **Pilot validation — considered DONE (Owner):** customer research was completed pre-project (it produced the plan + dummy data). **Near-term: nothing required** — MVP-0 is *deployed + security-reviewed + e2e-verified*, live and stable on synthetic data. **Deferred to project end (Owner):** key rotation, legacy **Stage 0** secret remediation, real-data migration (after a privacy review). **Done this session (2026-06-25):** AUTHZ-1 Option B, ENGINE-DC DB-constraint, the DELETE-exposure remediation, and D1 FORCE RLS — all merged + applied to prod (`0028`), pgTAP 217 green (see top banner). **Optional, agent-doable:** B3 (decision-gated minor); in-browser wedge walkthrough.

## Stages (risk-tiered; see MASTER-PLAN.md §4 for full plan)
| Stage | Title | Type | Risk | Status | Notes |
|---|---|---|---|---|---|
| R | Research & strategy | Research | Low | **Done** | 4 cited streams; white-space confirmed (docs 01) |
| D | Designs / prototypes | Documentation | Low | **Done** | `ebeid-farm-os-demo.html`, `farm-os-prototype.html`, `farm-os-full-demo.html` (mocks) |
| DS | Design system + component library | Execution | Low/Med | **Done (v1.2.0 published)** | `@amrebeid/ui` ~40 components, white-label theming, token-purity gate, Changesets, **green CI**. **`1.2.0` published to npm + tagged (2026-06-25)** — a11y, datatable-mobile, recharts code-split, reduced-motion + **Storybook 10 toolchain upgrade** (PR #154). (Catalog expanded beyond the 9 synced to Claude Design — re-sync pending.) |
| 0 | Security remediation & data cleanup | Execution+Apply | **Critical/High** | **OPEN — still required** | Legacy system: rotate exposed key, purge old-repo history, scrub Gmail/password, reconcile counts. Untouched by the new build. |
| **MVP-0** | **Proof-of-value pilot (1 reference tenant)** | Execution | **Low/Med** | **BUILT (local) — pending review+validation** | `apps/farm-os`: all 14 screens, wedge loop e2e passing, 36 pgTAP + 11 Vitest. Plan: `docs/superpowers/plans/2026-06-21-farm-os-mvp0.md`. Local DB only; needs security review + pilot validation + deploy. |
| 1 | SaaS foundation (orgs/RLS/roles/audit) | Execution | **High** | Todo | RLS is the tenant isolation gate |
| 2 | Farm structure + palm registry import | Execution | Medium | Todo | Import real Nov-2025 registry |
| 3 | Activity/event model + operations | Execution | Medium | Todo | asset+event+quantity spine |
| 4 | Planning workspace | Execution | Low/Med | Todo | 6-step builder |
| 5 | Inventory + **stock-coverage engine** | Execution | Medium | Todo | The wedge — define checks first (SPEC-0001) |
| 6 | Budget + approvals + purchase requests | Execution | **High** | Todo | Approval/entitlement logic |
| 7 | Accounting (expenses/sales/vouchers) | Execution | **High** | Todo | Financial integrity |
| 8 | People & labor/payroll | Execution | **High** | Todo | PII / regulated data. **PII-1 #173 FULLY DONE** — wage slice (`0046`: `payroll.read` + `people_compensation`, `people.rate` dropped) **and** contact slice (`0048`: deny-by-default on `people`, phone/email no longer member-readable). Broader Stage-8 build (attendance/payroll runs) still Todo |
| 9 | Weather integration | Execution | Medium | Todo | External API = untrusted + key |
| 10 | Care Academy content | Documentation | Med/High | Todo | Agronomy liability → expert sign-off |
| 11 | AI assistant عبدالجليل | Execution | **High** | Todo | Lethal-trifecta control required |
| M | Ebeid real-data migration (reference tenant) | External Apply | **High** | Todo | Real financials + PII |
| P | Production deploy (Vercel) | External Apply | **Critical** | **In progress** | MVP-0 deployed: Vercel `farm-ui` + dedicated non-Zeal Supabase `veezkmytervjnpxcrbkw`; **prod DB at `0048`** (`0001–0013` + `0015–0048`, **in sync with `main`**; `0032`–`0048` pushed + live-verified via `list_migrations`, incl. ENGINE-STALE-1 #197 + AUTHZ-2 #181 + AUTHZ-3 #182 + atomic plan-op #196 + FK perf indexes + palm-status RPC #238 + ENGINE-REC1 #184 + inventory unit_cost #89-B + the Owner RLS role-gate trio `0042`–`0044` (plan-req/budget/expenses) + partial receipts `0045` #155 + wage-confidentiality `0046` PII-1 #173 wage slice + engine null-date guard `0047` #198 + contact-PII lockdown `0048` PII-1 #173 phone/email slice) + full synthetic seed (transactional tables empty); backend verified (manager login + RLS; authenticated reads HTTP 200; DELETE `expenses` → HTTP 403; anon denied); pgTAP 421/421. Pending: **🔴 security rotation (DB pw + service key shared in chat) — only red item left** + enable Leaked Password Protection. (Twilio OTP dropped per Owner.) See [DEPLOY-STATUS.md](DEPLOY-STATUS.md). |

Status legend: Todo / Active / Blocked / In review / Done

## Pilot validation gates (MVP-0)
> **Owner (2026-06-24): considered SATISFIED** — the customer research/validation was done *before*
> the project (it produced the plan + the dummy/seed data), so this is not a remaining blocker.
> (Original ≥5/7 criteria + demo/interview plan retained for reference in [`PILOT-READINESS.md`](PILOT-READINESS.md) / [06 §10](06-MVP-0-BUILD-SPEC.md).)

## Definition of Done (paste per stage; see [10 §16](10-operations-and-readiness.md))
- [ ] Code complete · tests pass · RLS verified · Arabic-RTL · mobile · audit events · no secrets · Owner reviewed · reviewer approved (High/Critical) · tracker/spec/session updated · rollback documented

## Open gates / decisions needed
> **See [`OWNER-DECISIONS-2026-06-24.md`](OWNER-DECISIONS-2026-06-24.md)** — consolidated path-to-finish with a recommendation per decision (deploy infra, phone-OTP, Stage 0 runbook, B3 cost source, role model, pricing, pilot).
- [x] **Independent security review of the MVP-0 build — DONE + MERGED to main 2026-06-23** (PR #2; `@amrebeid/ui@1.1.0` published via PR #1/#3). On main (migrations `0010`/`0011` + tests `05`/`06`/`07`, **65/65 pgTAP** via the `db-tests` CI gate): GRANT-C1 unauthenticated `anon` DML+EXECUTE incl. the SECURITY DEFINER engine (CRITICAL); RLS-H1 child tables didn't validate parent org (cross-tenant write, HIGH); ENGINE-C1 expiry double-counted (CRITICAL); ENGINE-H1 phantom purchase rec (HIGH); ENGINE-H2/SS/M1; HIGH-1 org_member write lockdown; B4 input validation; B5 coverage-NaN; `fn_post_movement` (B1 RPC primitive); D3 RLS reference-columns. **PR #4 (B1 action rewiring) + PR #8 (D2 ledger-backed `reserved`) MERGED + e2e-verified** — **74/74 pgTAP + the Playwright wedge-loop e2e PASS on the real Supabase stack** (Docker repaired 2026-06-23; the full receipt/issue/reserve/release path now routes through `fn_post_movement`). **Remaining (decision-gated, minor):** D1 FORCE RLS (low value on Supabase — `postgres` is `bypassrls`), B2 inventory role-gating (needs role-model decision — supervisors execute ops), B3 hardcoded execution date/price (needs cost-source decision). — owner: Amr
- [x] **Cloud infra — DONE (2026-06-24):** dedicated non-Zeal Supabase project (`veezkmytervjnpxcrbkw`) + Vercel deployed and LIVE (farm-ui-one.vercel.app + ebeidfarm.business). Auth = email/password (no SMS — phone-OTP/Twilio dropped per Owner). **Key rotation deferred to project end (rotate before real data).** — owner: Amr
- [ ] **🔴 Rotate the Supabase `service_role` key + DB password** (both pasted in the deploy chat) — the demo password is already reset; this is the **only red item** left from the 2026-06-25 prod-push assurance; do before any real data (the service_role key bypasses RLS). **Blocked on tooling this session** (no `SUPABASE_ACCESS_TOKEN`, supabase not linked, no Vercel CLI, MCP has no key-rotation tool): the Owner rotates via the Supabase dashboard (or provides an access token + Vercel token), then updates Vercel env (`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` if the JWT secret rotated) and redeploys. — owner: Amr
- [ ] **Enable Supabase Auth Leaked Password Protection** (HaveIBeenPwned) — a dashboard toggle (advisor item). — owner: Amr
- [x] **Merge PRs #75 and #77** — done earlier; the prod DB has since advanced to `0028` (see banner). — owner: Amr
- [x] **AUTHZ-1 Option B + AP-5 insert-side SoD + ENGINE-DC DB-constraint — RESOLVED (2026-06-25).** AUTHZ-1 Option B = migration `0025` (#146, REST-layer role gate on `plan_operations`/`farm_event`/`event_locations`/`quantities`); ENGINE-DC = migration `0026` (#144, BEFORE INSERT receipt-vs-open-PO trigger); AP-5 insert-side SoD confirmed already merged (migration `0023`, test `21`). All applied to prod (`0028`), pgTAP 217 green. — owner: Amr
- [x] **DELETE/role posture for tenant tables — RESOLVED (2026-06-25):** migration `0027` (#140) `REVOKE DELETE` from `authenticated,anon` on the **27** exposed tenant tables (keeping `plan_checks` deletable for the plan builder); migration `0028` (#142) also `FORCE`s RLS on all 35 RLS tables. Live-verified: DELETE `expenses` as manager → HTTP 403. Full finding in [`SECURITY-FINDING-delete-exposure-2026-06-25.md`](SECURITY-FINDING-delete-exposure-2026-06-25.md). — owner: Amr
- [ ] **Owner sign-off on canonical palm count** (registry says 4,380/299) — owner: Amr
- [ ] **Approve Stage 0 security remediation** (key rotation + history purge) — owner: Amr
- [ ] **Confirm 4-vs-5 sector labels** and enterprise/crop list — owner: Amr
- [ ] **Engage a local agronomist** to sign off Academy numbers + Egyptian pesticide registrations — owner: Amr
- [ ] **Schedule 5 design-partner farm interviews** (close the Arabic customer-voice gap) — owner: Amr
- [ ] **Decide EGP pricing & setup-fee** anchors with those farms — owner: Amr

## Known risks (live register — full version in MASTER-PLAN.md §6)
- **Exposed secret in public repo / accounting sheet** (Gmail + anon key + Vercel project id) — *status: OPEN, Stage 0 fixes it.* 🔴
- **Cross-tenant data leak via weak RLS** — *mitigation: RLS-first, independent review on Stage 1.* 
- **AI assistant lethal trifecta** — *mitigation: read-only RPCs, no mass outbound, untrusted-input handling (Stage 11).*
- **Agronomy/pesticide liability** — *mitigation: templates + expert sign-off (Stage 10).*
- **Real financial/PII data into third-party model** — *mitigation: privacy review before migration (Stage M).*
- **Onboarding friction → churn** (industry #1) — *mitigation: white-glove Arabic onboarding (GTM doc).*
