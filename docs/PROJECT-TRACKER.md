# Project Tracker — Farm OS      Last updated: 2026-06-25 by Claude (for Owner: Amr Ebeid)

> **2026-06-25 follow-up security review (merged):** a second independent pass closed **B2.1**
> (append-only stock ledger, migration `0016`, #42), **AP-3** (PR self-approval SoD trigger,
> migration `0017`, #47), and **EXE-1** (idempotent operation execute / claim-first, #51) — plus a
> lint fix (#43) and findings docs (#45/#49). All merged to `main` after independent diff review;
> **pgTAP 92/92** + wedge-loop e2e green. **Prod DB still at `0013`** — pushing `0015`/`0016`/`0017`
> remains an Owner hard-stop. Only open finding: **AUTHZ-1** (execute org-only, not role-gated) —
> deferred with the role model. Detail: [`SECURITY-REVIEW-FOLLOWUP-2026-06-25.md`](SECURITY-REVIEW-FOLLOWUP-2026-06-25.md).

## Current focus
One private monorepo `github.com/AmrEbeid/Farm` (`packages/ui` + `apps/farm-os` + `docs/`). The **design system** (`@amrebeid/ui` **v1.1.0, published** to GitHub Packages, green CI) and the **Farm OS MVP-0 app** are both **BUILT** and on `main`. The **independent security review is DONE + merged** (RLS/grants/engine fixes, the `db-tests` pgTAP CI gate, the `fn_post_movement` B1 primitive). The full inventory path (B1 rewiring + **D2 ledger-backed `reserved`**) is **merged + verified** (74/74 pgTAP + the Playwright wedge-loop e2e pass on the real Supabase stack). The app is now **DEPLOYED + LIVE** (2026-06-24) on **farm-ui-one.vercel.app** + **ebeidfarm.business** with a dedicated Supabase project — login + RLS + the stock-coverage engine verified on prod (see `DEPLOY-STATUS.md`). **What's left:** **Key rotation — deferred to project end (Owner, 2026-06-24):** rotate the Supabase DB password + service_role key (pasted in the deploy chat) + reset the demo password — but do it **before any real data** regardless (the exposed service_role key bypasses RLS). **Pilot validation — considered DONE (Owner):** customer research was completed pre-project (it produced the plan + dummy data). **Near-term: nothing required** — MVP-0 is *deployed + security-reviewed + e2e-verified*, live and stable on synthetic data. **Deferred to project end (Owner):** key rotation, legacy **Stage 0** secret remediation, real-data migration (after a privacy review). **Optional, agent-doable:** D1 FORCE RLS (low value on Supabase); B2 role-gating / B3 (decision-gated minors); in-browser wedge walkthrough.

## Stages (risk-tiered; see MASTER-PLAN.md §4 for full plan)
| Stage | Title | Type | Risk | Status | Notes |
|---|---|---|---|---|---|
| R | Research & strategy | Research | Low | **Done** | 4 cited streams; white-space confirmed (docs 01) |
| D | Designs / prototypes | Documentation | Low | **Done** | `ebeid-farm-os-demo.html`, `farm-os-prototype.html`, `farm-os-full-demo.html` (mocks) |
| DS | Design system + component library | Execution | Low/Med | **Done (v1.0)** | `@amrebeid/ui` ~40 components, white-label theming, token-purity gate, Changesets, **green CI**. (Catalog expanded beyond the 9 synced to Claude Design — re-sync pending.) |
| 0 | Security remediation & data cleanup | Execution+Apply | **Critical/High** | **OPEN — still required** | Legacy system: rotate exposed key, purge old-repo history, scrub Gmail/password, reconcile counts. Untouched by the new build. |
| **MVP-0** | **Proof-of-value pilot (1 reference tenant)** | Execution | **Low/Med** | **BUILT (local) — pending review+validation** | `apps/farm-os`: all 14 screens, wedge loop e2e passing, 36 pgTAP + 11 Vitest. Plan: `docs/superpowers/plans/2026-06-21-farm-os-mvp0.md`. Local DB only; needs security review + pilot validation + deploy. |
| 1 | SaaS foundation (orgs/RLS/roles/audit) | Execution | **High** | Todo | RLS is the tenant isolation gate |
| 2 | Farm structure + palm registry import | Execution | Medium | Todo | Import real Nov-2025 registry |
| 3 | Activity/event model + operations | Execution | Medium | Todo | asset+event+quantity spine |
| 4 | Planning workspace | Execution | Low/Med | Todo | 6-step builder |
| 5 | Inventory + **stock-coverage engine** | Execution | Medium | Todo | The wedge — define checks first (SPEC-0001) |
| 6 | Budget + approvals + purchase requests | Execution | **High** | Todo | Approval/entitlement logic |
| 7 | Accounting (expenses/sales/vouchers) | Execution | **High** | Todo | Financial integrity |
| 8 | People & labor/payroll | Execution | **High** | Todo | PII / regulated data |
| 9 | Weather integration | Execution | Medium | Todo | External API = untrusted + key |
| 10 | Care Academy content | Documentation | Med/High | Todo | Agronomy liability → expert sign-off |
| 11 | AI assistant عبدالجليل | Execution | **High** | Todo | Lethal-trifecta control required |
| M | Ebeid real-data migration (reference tenant) | External Apply | **High** | Todo | Real financials + PII |
| P | Production deploy (Vercel) | External Apply | **Critical** | **In progress** | MVP-0 deployed: Vercel `farm-ui` + dedicated non-Zeal Supabase `veezkmytervjnpxcrbkw`; migrations 0001–0013 + seed live; backend verified (owner login + RLS 28/28; anon denied). Pending: Twilio OTP, security rotation (DB pw + service key shared in chat), frontend smoke. See [DEPLOY-STATUS.md](DEPLOY-STATUS.md). |

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
- [ ] **Decide the DELETE/role posture for tenant tables** (ties into the role-model decision) — independent review (2026-06-25) found any org member can directly DELETE rows on **28 tenant tables** (incl. `expenses`, `farm_event`, `quantities`, `people`) via PostgREST; only `audit_log`/org-spine + the inventory ledger (PR #42, B2.1) are locked. Within-tenant insider/integrity gap, not cross-tenant. The product only deletes `plan_checks` as a client, so the rest is open-but-unused surface. Full finding + tiered remediation in [`SECURITY-FINDING-delete-exposure-2026-06-25.md`](SECURITY-FINDING-delete-exposure-2026-06-25.md). — owner: Amr
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
