# SPEC-0013 — Commercial SaaS Layer (subscriptions, tenant lifecycle, onboarding, admin)

*Status: **DRAFT for Owner review** — design + scope only; **no code, no prod apply, no billing-provider
signup** (Owner-gated). Builds on the verified capability map in
[`RECONCILE-001-main-ground-truth-2026-06-27.md`](RECONCILE-001-main-ground-truth-2026-06-27.md): the
multi-tenant foundation, RLS, inventory/coverage/event/planning/PR loop, and attachments are **already built
and live**. This spec covers the **one genuinely-missing layer that turns the working product into a sellable
SaaS** — it does NOT re-spec any feature RECONCILE-001 marks ✅.*

Owner: Amr Ebeid. Risk level: **High** (billing/money + tenant entitlements + access-control boundaries +
external provider + self-serve provisioning bypasses white-glove control). Independent review required on the
entitlement-enforcement and billing-webhook slices. Last updated: 2026-06-27.

---

## 0. Basis (why this spec, and why now)
- **RECONCILE-001** found the commercial layer is the largest real gap: `grep` over the schema returns **no**
  `subscription` / `billing` / `plan_tier` / `stripe` objects; there is no signup, onboarding, import wizard,
  demo tenant, or admin console.
- The 2026-06-27 market scan (Cropwise, Farmbrite, AGRIVI, Agworld, FarmERP, Mazoon, Odoo-Egypt) confirms every
  comparable product ships tiers + onboarding + import; our differentiator is the wedge, **not** these — so this
  layer is table-stakes-to-sell, deliberately thin, and must not dilute the wedge.
- **Hard prerequisite:** multi-user onboarding depends on **SPEC-0012 S2** (member invite + role admin,
  migration `0090`). SPEC-0013 assumes S2 lands first; the import/onboarding slices reuse it.

## 1. Requirements (the what/why)

### Problem
The product works and is live on synthetic data for one tenant (Ebeid). To sell it to a second farm we need to:
provision a new org self-or-assisted, place it on a plan with enforced limits, onboard + import its real data
safely, bill it, and operate a fleet of tenants from an admin console — **without** weakening the deny-by-default
RLS or the per-farm pricing model, and **without** putting real data into the product before the Stage M privacy
review.

### Stories
- As a **prospective customer**, I want to start a trial / demo tenant so I can evaluate the product in Arabic
  before committing.
- As a **new org owner**, I want a guided onboarding (create org → farm type → import my structure/expenses
  Excel → map columns → reconcile sectors/crops → invite team → confirm opening stock) so setup isn't a
  database job.
- As **Amr (platform operator)**, I want an admin console to see every tenant, its plan, usage vs limits, and
  lifecycle state, and to suspend/extend/upgrade a tenant.
- As the **billing system**, I want plan + entitlement state to be the single source of truth that the app
  enforces server-side, so a tenant can't exceed its plan by calling the API directly.

### Acceptance criteria (the oracle — refine per slice at ratification)
- [ ] A `subscription` (or `org_plan`) record exists per org with `plan_tier`, `status`
      (`trial`/`active`/`past_due`/`suspended`/`cancelled`), `trial_ends_at`, limits snapshot — **RLS-readable
      only within the org; writable only by service-role/admin**, never by tenant users.
- [ ] **Entitlement enforcement is server-side** (RLS / RPC / middleware), not UI-only: exceeding a limit
      (e.g. add farm beyond plan) is rejected with a clear Arabic error (`42501`/custom), proven by a test that
      calls the path directly.
- [ ] Limits are **per-farm / area / assets / storage / AI-usage — NOT per-seat** (CLAUDE.md #3). A test asserts
      no seat cap is introduced.
- [ ] Onboarding wizard provisions a new org end-to-end on **synthetic/sample data**; import validates + previews
      before writing; a failed/partial import is atomic (no half-imported org).
- [ ] Demo tenant is isolated (its own org), clearly labelled, and resettable; demo data never mixes with a real
      tenant.
- [ ] Admin console is gated to a **platform-operator role distinct from any tenant role**; tenant users can
      never reach it; all admin actions are audited.
- [ ] Billing webhooks are signature-verified, idempotent, and update entitlement state transactionally; a
      replay or forged webhook changes nothing.
- [ ] Trial→paid, upgrade, downgrade, and cancellation each move `status`/limits correctly and are audited.

### Non-goals (explicitly out of scope)
- Re-building org/RLS/roles/inventory/events/planning/PR/attachments — **all ✅ in RECONCILE-001**.
- Member invite/role UI itself — that is **SPEC-0012 S2** (dependency, not duplicated here).
- VAT / ZATCA e-invoicing → Stage 7 (Accounting).
- Putting **real** tenant financials/PII into the product — **Stage M**, gated on privacy review; this spec
  builds + tests on synthetic/demo data only.
- Choosing the pricing numbers (EGP anchors) — an open Owner/GTM decision; this spec builds the *mechanism*.

## 2. Design (the how)
- **Approach:** a thin entitlement + lifecycle layer over the existing tenancy. New `subscription`/`plan` tables
  are **org-scoped and service-role-writable only** (same posture as `audit_log` — tenant-readable, not
  tenant-writable). Entitlement checks reuse the `authorize()` + RLS pattern; add an `enforce_limit(kind)`
  helper (SECURITY DEFINER, `search_path=''`) called by the create-paths (add farm/asset/member/upload) so the
  cap is enforced in Postgres, never only in the app. Feature flags = a per-plan capability set read at request
  time (mirrors `assistant-policy` deny-by-default).
- **Billing provider:** **open decision** (see Decisions log) — Egypt/EGP payment support is the gating
  constraint (Stripe EGP support is limited; Paymob/Fawry/Kashier are local options). The webhook/entitlement
  contract is provider-agnostic; the provider is pluggable behind one server module.
- **Onboarding/import:** reuse the existing structure/event/inventory write RPCs; the import wizard is a
  staged **preview → map → validate → atomic-commit** flow (no direct table writes), reusing
  `fn_save_sector/hawsha/line/palm` and the expense/inventory RPCs. Column-mapping + reconciliation against the
  canonical palm registry (CLAUDE.md #5) is mandatory; never fabricate missing data.
- **Admin console:** a separate route group gated to a platform-operator principal (NOT a tenant role); strictly
  read + lifecycle-mutate via audited RPCs; no raw table access.
- **Affected areas:** new migrations (subscription/plan/limits + `enforce_limit` + admin RPCs + RLS/grants),
  `app/(app)/onboarding/*`, `app/admin/*` (new, operator-gated), `lib/entitlements.ts`, `lib/import/*`,
  billing webhook route under `app/api/*` (server-only, secret-scoped), pgTAP tests, generated types.
- **Test strategy:** define checks first — pgTAP per RPC (limit-exceeded direct-call rejection; cross-org
  isolation `42501`; webhook idempotency/forgery; admin-role gating; audit-row assertions); Vitest for the
  entitlement + import-mapping logic; `tsc`/`next build` green. Independent review on entitlement enforcement +
  billing webhook (money + access-control).

## 3. Tasks (small, reviewable slices — ratify before building each)
- [ ] **S0 — Plan model + entitlements (read path)** *(Med).* `plan`/`subscription` tables (org-scoped,
      service-role-writable), default every existing org to an internal "owner/unlimited" plan so **nothing
      regresses**; `lib/entitlements.ts` read helper + feature-flag set. No enforcement yet. New migration lane =
      next free past `0090` (SPEC-0012 S2). pgTAP: RLS read-only-within-org.
- [ ] **S1 — Server-side limit enforcement** *(High; review-gated).* `enforce_limit(kind)` wired into the
      create-paths (farm/asset/member/upload); Arabic over-limit errors. pgTAP: direct-call rejection per limit;
      assert **no per-seat** cap. Cross-link Stage 1 + SPEC-0012 S2.
- [ ] **S2 — Onboarding wizard (synthetic)** *(Med).* create org → farm type → invite (via S2/0090) → confirm
      opening stock. Atomic; no real data. Reuses structure/inventory RPCs.
- [ ] **S3 — Import wizard** *(High).* Excel/PDF upload → preview → column map → validate + reconcile to the
      registry → atomic commit; partial-failure rollback. **Real-data import stays behind Stage M privacy
      review** — S3 is built/tested on sample files only.
- [ ] **S4 — Demo tenant** *(Low/Med).* Provision + label + reset an isolated demo org from the synthetic seed.
- [ ] **S5 — Admin / support console** *(High; review-gated).* Operator-gated tenant list + usage-vs-limit +
      lifecycle (suspend/extend/upgrade), all audited; tenant users denied. pgTAP: operator-vs-tenant gating.
- [ ] **S6 — Billing provider integration** *(Critical; review-gated; External Apply to go live).* Provider
      chosen (Decisions); signature-verified idempotent webhook → transactional entitlement update; trial→paid,
      upgrade, downgrade, cancel, past_due flows. Sandbox first; real keys + live mode = Owner external-apply gate.
- [ ] **S7 — Commercial launch checklist** *(Doc).* key rotation done (the open 🔴), Stage 0 remediation,
      privacy review (Stage M), ToS/privacy policy, pricing anchors set, support runbook, demo→paid path verified.

## Risks & mitigations
- **Entitlement bypass** (tenant exceeds plan via direct API) → enforce in Postgres (`enforce_limit` + RLS),
  not UI; pgTAP direct-call tests; independent review (actor ≠ reviewer).
- **Per-seat creep** (market norm) → explicit acceptance criterion + test forbidding seat caps (CLAUDE.md #3).
- **Billing/money errors** → idempotent signature-verified webhooks; transactional state changes; sandbox before
  live; independent review; live mode behind an external-apply gate.
- **Self-serve vs white-glove conflict** → GTM is white-glove Arabic onboarding; self-serve trial/demo must not
  let an unvetted tenant load real data or bypass onboarding support. Demo isolated + labelled.
- **Real data too early** → S3 import tested on sample files only; real import blocked on Stage M privacy review.
- **Provider lock-in / EGP support** → provider-agnostic webhook contract behind one pluggable module.
- **Admin-console blast radius** → operator role distinct from tenant roles; audited; no raw table access.

## Decisions log
- 2026-06-27 — Spec created from the external commercial-readiness assessment, **after** RECONCILE-001 confirmed
  the rest of the product is already built (so this spec re-specs nothing already ✅).

## Open Owner decisions (carry into the tracker)
- [ ] **Billing provider** — Paymob / Fawry / Kashier / Stripe? (gated by EGP support + the per-farm model).
- [ ] **Plan tiers & limit dimensions** — which limits (farms / planted area / assets / storage / AI usage) and
      what each tier includes. Pricing numbers are a separate GTM decision.
- [ ] **Self-serve trial vs white-glove only** — does GTM want public signup, or operator-provisioned tenants
      with a demo? (affects S2/S4/S6 scope).
- [ ] **WhatsApp owner-approval** — wanted? It is a Hard Stop (external send + trifecta); SMS/Twilio was dropped
      from MVP-0.
- [ ] **Platform-operator identity model** — a super-admin outside the tenant role set; where it lives.
