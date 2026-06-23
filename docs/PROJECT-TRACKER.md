# Project Tracker — Farm OS      Last updated: 2026-06-22 by Claude (for Owner: Amr Ebeid)

## Current focus
One private monorepo `github.com/AmrEbeid/Farm` (`packages/ui` + `apps/farm-os` + `docs/`). The **design system** (`@amrebeid/ui` v1.0, ~40 components, green CI) and the **Farm OS MVP-0 app** are both **BUILT** — `apps/farm-os` runs the full wedge loop end-to-end against local Supabase (Playwright e2e passing), merged to `main`. **What's left is not more building — it's gates:** the independent security review (RLS/grants/engine), pilot validation (H1–H4), legacy **Stage 0** secret remediation, and a cloud deploy. The MVP-0 build is *engineering-complete on a local DB* — not deployed, validated, or reviewed.

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
| P | Production deploy (Vercel) | External Apply | **Critical** | Todo | After risky changes → staged + rollback |

Status legend: Todo / Active / Blocked / In review / Done

## Pilot validation gates (MVP-0 — must hit ≥5/7 before building full MVP; see [06 §10](06-MVP-0-BUILD-SPEC.md))
- [ ] 5 farms interviewed · [ ] 2 share real data · [ ] 1 builds a monthly plan · [ ] 1 validates stock coverage · [ ] 1 owner confirms WTP · [ ] 1 accountant confirms reports · [ ] 1 supervisor confirms mobile (<60s)

## Definition of Done (paste per stage; see [10 §16](10-operations-and-readiness.md))
- [ ] Code complete · tests pass · RLS verified · Arabic-RTL · mobile · audit events · no secrets · Owner reviewed · reviewer approved (High/Critical) · tracker/spec/session updated · rollback documented

## Open gates / decisions needed
- [~] **Independent security review of the MVP-0 build** — DONE 2026-06-23 (3 adversarial subagents: RLS / grants / engine). Findings fixed on branch `fix/mvp0-security-remediation` (migration `0010` + test `05`): GRANT-C1 unauthenticated `anon` had full DML+EXECUTE incl. the SECURITY DEFINER engine (CRITICAL); RLS-H1 child tables didn't validate parent org (cross-tenant write, HIGH); ENGINE-C1 expiry double-counted (CRITICAL); ENGINE-H1 phantom purchase rec (HIGH); ENGINE-H2 horizon clamp + ENGINE-SS `first_warning_period`. **44/44 pgTAP green** (36 existing preserved + 8 new) verified on a local PG (Docker stack was down). Remaining: Owner merge sign-off + Playwright e2e on the Docker/PostgREST stack. Deferred (next slice): FORCE RLS, explicit `organization_member` write-deny, `bin.reserved` reconciliation, stockout-date origin. — owner: Amr
- [ ] **Cloud infra decision** — provision a dedicated (non-Zeal-org) Supabase project + Vercel for deploy; wire real phone-OTP auth (currently email/password + local Supabase) — owner: Amr
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
