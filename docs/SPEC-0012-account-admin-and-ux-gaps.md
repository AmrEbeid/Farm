# SPEC-0012 — Account administration & UX-gap closure (member/role UI, profile, theme, field-UX)

*Status: **DRAFT for Owner review** — design + scope only; **no code, no prod apply** (Owner-gated). Informed by a
market/UX research pass (2026-06-27) over comparable farm/orchard software. Companion to
[`PROJECT-TRACKER.md`](PROJECT-TRACKER.md) Stage 1 (Done) and the "onboarding friction → churn" risk. This spec
deliberately does **not** rebuild anything Stage 1 already shipped.*

Risk level: **Medium** (touches access-control surface — member/role management — so the role-UI slice is
review-gated). Last updated: 2026-06-27.

---

## 0. Research basis (why these gaps, not invented ones)
A salvaged deep-research pass (workflow synthesis collapsed; 8 sources fetched directly) over comparable
products. Findings used here, with confidence:

- **High (3+ independent sources)** — the recurring user *praise/complaint* pattern across Farmbrite, Agrivi,
  Croptracker reviews:
  - Praise: responsive support, all-in-one consolidation, intuitive layout, auto-generated compliance reports,
    instant-overview dashboards.
  - Complaints → the gaps to design around: **setup/onboarding learning curve**; **no offline / internet
    dependency kills field use**; **incomplete mobile**; **no bulk edit/batch ops**; **non-customizable reports**;
    **navigation depth**; **field UI fails physically** (scanning in sunlight, gloved hands).
- **Medium (single-source)** — product feature points:
  - **Mazoon Soft "Palm & Fruit Farm Management"** (Omani, Arabic/English) — the *closest direct competitor*:
    per-palm expenses/revenues, **users & permissions**, inventory/purchases/suppliers, VAT + **e-invoice/QR**,
    HR, date-range reports → Excel, mobile/tablet, Arabic+English.
    `https://mazoonsoft.com/en/our_software/palm-and-fruit-farm-management-program`
  - **AgriWebb** — the role-management reference: ~12 granular roles, **per-farm role assignment**, **email
    invite (28-day expiry)**, **unlimited user licenses**, "Default Access = No access" default-deny pattern.
    `https://help.agriwebb.com/en/articles/2630040-user-management`
  - **FarmERP** — multilingual incl. **Arabic**, **native mobile with offline data capture**, role-based.
    `https://www.farmerp.com/`
  - **Croptracker** — block/row structure (≈ sectors/hawshat/lines), mobile scanning, GAP audit reports;
    reviews cite **connectivity loss** + **scanning fails in sunlight** as the top field complaints.
    `https://www.croptracker.com/product/orchard-management-software.html`
  - **a-bots (KSA custom-app guidance)** — GCC needs: **real Arabic agricultural terminology (not generic
    translation)**, offline-first, **field-ready UI** (high-contrast for sunlight, large gloved-hand targets),
    regulatory water reporting. `https://a-bots.com/blog/custom-agriculture-app-saudi-arabia`

---

## 1. Requirements (the what/why)

### Problem
The user reports gaps in **plan / UX / process / setup**. The market scan confirms several are real and
expected-everywhere, while the tracker shows others are *already handled* and must not be rebuilt.

**Already handled — explicitly OUT of scope (do not rebuild):**
- Multi-org per-org roles + **org switcher** + instant member-removal-by-RLS — **Stage 1, Done 2026-06-27**.
- Org-level settings (`fn_update_org_settings`, owner-gated) — built.
- Farm **setup** = the editable structure CRUD (sectors/hawshat/lines/palms) — tracker treats this as the
  setup wizard already; only *guided first-run polish* is in scope here, not a parallel structure builder.
- Arabic-RTL throughout — a CLAUDE.md non-negotiable, already implemented (a genuine competitive strength;
  matches the a-bots "real Arabic terminology" requirement and Mazoon parity).
- Onboarding-friction risk + "white-glove Arabic onboarding" mitigation — already in the GTM/risk register.

**Genuine, code-verified gaps (this spec's scope):**
1. **No member-management / invite UI.** Roles (`owner`/`farm_manager`/`supervisor`/`storekeeper`/
   `agri_engineer`) live in `organization_member` + RLS, but there is **no `/members` route**, no add/invite,
   no role-change UI. Every comparable product (AgriWebb, Mazoon, Farmbrite) ships this. *(verified: no route)*
2. **No profile / per-user account page** (`/profile`). *(verified: no route)*
3. **No theme control** — `ThemeProvider` is hard-pinned `scheme="light"` in `app/layout.tsx`; a
   `[data-theme="dark"]` token set exists but is unwired. *(verified)*
4. **Offline / field-UX for `/m` — unverified.** CLAUDE.md mandates "mobile/offline-tolerant"; market says
   it's make-or-break. Needs a read-only audit before any build. *(to confirm)*
5. **Bulk edit / batch ops and report export/customization — unverified** at scale. *(to confirm)*

### Stories
- As an **owner/farm_manager**, I want to invite a teammate by email and assign their role, so I stop
  provisioning members by hand in the database.
- As an **owner**, I want to change/remove a member's role from the app, so access stays current as staff change.
- As **any user**, I want a profile page to see my role and update my name/preferences.
- As a **field user**, I want the mobile view to keep working with no/À-spotty signal and be readable in
  sunlight with gloves.

### Acceptance criteria (the oracle — per slice; expand at ratification)
- [ ] Member list shows every `organization_member` for the active org with role + status; owner/farm_manager
      only (server-enforced, not just hidden in UI).
- [ ] Invite-by-email creates a pending membership; a non-owner/manager attempt is rejected server-side (`42501`).
- [ ] Role change/removal is RLS-enforced and **audited** (`audit_log`), and respects the per-farm (not
      per-seat) pricing model — **no seat limits introduced**.
- [ ] Profile page renders the current user's identity + role; edits persist.
- [ ] (If pursued) theme toggle persists per user and applies the existing dark token set.
- [ ] Offline audit produces a written pass/fail on `/m` field behavior before any offline build is scoped.

### Non-goals
- VAT / ZATCA e-invoicing & the sales/financial side (Mazoon has it) → **Stage 7 (Accounting)**, not here.
- Any change to the **role model itself** (role set/permissions) — that is an **open Owner decision**
  (tracker "role model"); this spec builds UI over whatever role model the Owner ratifies, it does not decide it.
- IoT/sensors/irrigation telemetry (a-bots emphasis) — not in MVP scope.
- No prod apply; no real member data entered.

---

## 2. Design (the how)
- **Approach:** thin UI + RPC layer over the *existing* `organization_member` + RLS. Mirror AgriWebb's pattern
  (email invite, per-org role, default-deny) but **per-farm/unlimited-users** per CLAUDE.md #3. Reuse the
  Stage-1 active-org plumbing and the existing `requireRole` + `authorize()` gates; add `fn_invite_member` /
  `fn_set_member_role` / `fn_remove_member` style RPCs (SECURITY DEFINER, `search_path=''`, owner/manager-gated,
  audited) rather than client-side table writes — same posture as the structure/plan RPCs.
- **Affected areas:** `app/(app)/members/*` (new), `app/(app)/profile/*` (new), `app/(app)/settings/*` (extend),
  `components/*`, new migration(s) for the member-admin RPCs + their RLS/grants, pgTAP tests, generated types.
- **Test strategy:** define checks first — pgTAP for each RPC (positive + cross-org `42501` + audit-row
  assertion), tsc + `next build`, Vitest where logic warrants. Local pgTAP harness stays green. Independent
  review required on the member/role slice (access-control surface).
- **Auth caveat (from supabase skill):** authorization data must live in `app_metadata`/DB, never
  user-editable `user_metadata`; invites must not weaken the deny-by-default RLS.

---

## 3. Tasks (small, reviewable slices — none start before Owner ratification)
- [ ] **S1 — Offline/field-UX audit of `/m`** *(Low; read-only; os-audit).* Confirm current offline behavior,
      sunlight/glove readiness; output a pass/fail memo. **Do this first — it may shrink or grow S4.**
- [ ] **S2 — Member/role management** *(Medium; access-control; review-gated).* `fn_invite_member` /
      `fn_set_member_role` / `fn_remove_member` (+ RLS/grants/audit) + `/members` list & forms. Blocked on the
      Owner **role-model** decision. Cross-link Stage 1.
- [ ] **S3 — Profile/account page** *(Low).* `/profile`: identity, role, basic preferences.
- [ ] **S4 — Field-UX + offline hardening for `/m`** *(scope set by S1).* High-contrast/large-target pass;
      offline-tolerant core actions if S1 finds gaps.
- [ ] **S5 — Theme toggle (light/dark)** *(Low; cosmetic).* Wire the existing dark token set + per-user persist.
- [ ] **S6 — Report export + bulk-edit review** *(scope set by a quick audit).* Only if audits confirm gaps.

---

## Risks & mitigations
- **Access-control regression** in member RPCs → independent review (actor ≠ reviewer) + pgTAP cross-org tests;
  deny-by-default preserved.
- **Per-seat creep** (the market norm is per-seat; ours is per-farm) → explicit acceptance criterion forbidding
  seat limits.
- **Overbuild vs Stage 1** → "already handled" list above; verify against code before building any screen
  (standing project lesson: audit gap-lists overstate remaining work).
- **Role-model churn** → S2 blocked until the Owner ratifies the role model.

## Decisions log
- 2026-06-27 — Spec created from a market/UX research pass (user-requested). Synthesis stage of the
  deep-research workflow failed; report salvaged via direct source fetch. Gaps tiered against verified code
  state, not an audit list. **Awaiting Owner ratification; nothing started.**

## Open Owner decisions (carry into the tracker)
- [ ] **Ratify the role model** (role set + per-role permissions) — unblocks S2.
- [ ] **Confirm scope:** which slices (S1–S6) are in, and priority order.
- [ ] **Theme** — is dark mode wanted at all, or keep light-only?
