# Project Tracker — Farm OS      Last updated: 2026-06-21 by Claude (for Owner: Amr Ebeid)

## Current focus
Governance scaffolded under the AI Project Operating System v3. Research/strategy, full product docs (00–10), and the **design system** are done: the `@farm-os/ui` component library is built and **synced live to Claude Design** ("Farm OS UI"). Product build is at **Phase 0 (security/data cleanup) → MVP-0 pilot**. The Farm OS *application* code is not built yet; the component library (its UI layer) is.

## Stages (risk-tiered; see MASTER-PLAN.md §4 for full plan)
| Stage | Title | Type | Risk | Status | Notes |
|---|---|---|---|---|---|
| R | Research & strategy | Research | Low | **Done** | 4 cited streams; white-space confirmed (docs 01) |
| D | Designs / prototypes | Documentation | Low | **Done** | `ebeid-farm-os-demo.html`, `farm-os-prototype.html`, `farm-os-full-demo.html` (mocks) |
| DS | Design system + component library | Execution | Low/Med | **Done** | `farm-os-ui` (9 components, builds + Storybook); synced live to Claude Design ("Farm OS UI", `115ae675…`) |
| 0 | Security remediation & data cleanup | Execution+Apply | **Critical/High** | **Active — do first** | Rotate exposed key, purge secret, reconcile counts, split drawings |
| **MVP-0** | **Proof-of-value pilot (1 reference tenant)** | Execution | **Low/Med** | **Spec ready — [06](06-MVP-0-BUILD-SPEC.md)** | 14 screens, table subset, the wedge loop; validates H1–H4 before full MVP |
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
