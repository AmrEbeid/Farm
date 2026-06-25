# SECURITY-NOTES — accepted findings & residual-risk register   (2026-06-25)

Purpose: a durable record of the **known, accepted, low-risk** security findings on Farm OS MVP-0,
so future Supabase advisor runs and independent reviews have context and do not re-litigate settled
decisions. Each entry states **what it is**, **why it is accepted / low-risk**, and **the follow-up
condition** (what would change the verdict, or what is still owed).

Scope: `apps/farm-os` (live Supabase project `veezkmytervjnpxcrbkw`, prod DB at migration `0022`).
This file is a register, not a new review — every item below is grounded in the existing security
docs and migrations. It does **not** invent new issues. Sources:
- [`SECURITY-REVIEW-MVP0-2026-06-23.md`](SECURITY-REVIEW-MVP0-2026-06-23.md)
- [`SECURITY-REVIEW-FOLLOWUP-2026-06-25.md`](SECURITY-REVIEW-FOLLOWUP-2026-06-25.md)
- [`SECURITY-FINDING-delete-exposure-2026-06-25.md`](SECURITY-FINDING-delete-exposure-2026-06-25.md)
- [`SECURITY-FINDING-engine-receipt-doublecount-2026-06-25.md`](SECURITY-FINDING-engine-receipt-doublecount-2026-06-25.md)
- [`DEPLOY-RUNBOOK.md`](DEPLOY-RUNBOOK.md) §1a (prod-push) · [`PROJECT-TRACKER.md`](PROJECT-TRACKER.md) · [`SESSION-BRIEF.md`](SESSION-BRIEF.md)

Posture baseline: multi-tenant isolation is enforced in **Postgres RLS** (deny-by-default, `org_id`
on every tenant table), not the app layer. The 2026-06-25 prod-push followed an 8-agent adversarial
assurance that returned **GO-WITH-CAVEATS**; pgTAP is **126/126** on a clean reset and is gated in CI
(`.github/workflows/db-tests.yml`). The current data is **synthetic, single-tenant** — that context
is load-bearing for every "low-risk" verdict below.

---

## 1. Supabase advisor categories — accepted by design

The advisor flags are understood and intentional. None is a defect.

### 1.1 `authorize()` and `user_org_ids()` are anon/authenticated-EXECUTABLE — BY DESIGN
- **What:** the advisor flags these two `public` functions as executable by `anon`/`authenticated`.
- **Why accepted:** they are the **RLS helper functions** themselves. Both are `SECURITY DEFINER`
  with a locked `search_path` and return **only the caller's own context** —
  `user_org_ids()` returns the orgs the *caller* is a member of, and `authorize(perm)` returns whether
  the *caller's* role grants `perm` (both key on `auth.uid()`; an anon caller has a null `uid` and
  gets the empty/false result). They must be executable by the roles whose policies call them — that
  is how every tenant RLS policy evaluates. Definitions: migration `0001`
  (`20260622000001_extensions_tenancy_rbac.sql`, lines 45–75).
- **Follow-up:** none. Revoking these would break RLS itself. Re-confirm only that their bodies still
  read solely `auth.uid()`-derived context (no parameter that selects another user's data).

### 1.2 Business RPCs are authenticated-EXECUTABLE — BY DESIGN (gated in-body; anon revoked)
- **What:** `fn_post_movement`, `fn_execute_operation`, `fn_bin_rebuild`, `fn_stock_coverage` are
  executable by `authenticated`; the advisor lists them as `SECURITY DEFINER` callable functions.
- **Why accepted:** these are the intended write/read entry points. They are `SECURITY DEFINER` with a
  pinned `search_path` and **gate authorization in the body** against the *caller* (`SECURITY DEFINER`
  does not change `auth.uid()`, so `authorize()`/the org guard still evaluate the caller):
  - `fn_execute_operation` checks `authorize('op.execute')` + a cross-org guard at the top, then runs
    the whole execution as one transaction (`0020`).
  - `fn_post_movement` is org-guarded and rejects anon / non-positive qty (`0011`); it is the only
    sanctioned inventory-write path (the ledger is append-only — see 2.1).
  - `fn_stock_coverage` / `fn_bin_rebuild` are RLS-scoped reads/reconciliation (`0009`).
  - **anon is explicitly revoked** on the write RPCs in migration `0021`
    (`20260622000021_lock_definer_exec_to_caller_roles.sql`): `revoke execute … from anon` on
    `fn_execute_operation` and `fn_post_movement`. (`fn_stock_coverage` anon was already revoked in
    `0010`.) Trigger functions `pr_guard_approval`/`fn_audit`/`fn_audit_org_member` are revoked from
    `public`, `anon`, **and** `authenticated` in `0021` (never client-invoked).
- **Follow-up:** none for the grant layer. AUTHZ-1 (REST-layer gating of the operation *tables*) is a
  separate, queued item — see 3.1.

### 1.3 `pgtap` extension in `public` — test cruft
- **What:** the advisor flags the `pgtap` extension installed in `public`.
- **Why accepted:** `pgtap` is the unit-test framework for `supabase test db` (migration `0001`,
  line 8). It exposes no tenant data and is only used by the pgTAP suite. Its presence is a
  test-tooling artifact, not an attack surface.
- **Follow-up:** optional cosmetic — move it to a dedicated `extensions`/`tap` schema if a future
  advisor pass wants `public` clean. No security value; do not prioritize.

### 1.4 Leaked-password protection disabled — dashboard toggle
- **What:** the advisor flags that Supabase Auth leaked-password protection (HaveIBeenPwned check) is
  off.
- **Why accepted / low-risk now:** it is a **dashboard toggle**, not a code/migration concern, and the
  current accounts are synthetic demo users. It is a hardening nicety, not a hole.
- **Follow-up:** enable the toggle in the Supabase dashboard (Auth → Policies) **before real users**;
  pair with the demo-password reset already owed at key rotation (see 4.1).

---

## 2. Resolved hardening (recorded for continuity — do NOT re-flag)

These were real findings that are **fixed and verified**; listed so an advisor/review does not mistake
the historical wording for an open issue.

### 2.1 Inventory ledger is append-only for every client role
- `revoke delete … from authenticated, anon` on `inventory_movements`/`inventory_bin` (`0016`, B2.1)
  and `revoke update …` (`0022`) → the ledger is **append-only**; corrections are compensating
  movements via the `bypassrls` `fn_post_movement` RPC. Inventory writes are role-gated to
  `authorize('inventory.write')` (`0015`, B2). pgTAP tests `10`/`11`.

### 2.2 PR self-approval (AP-5) frozen at the DB
- `BEFORE UPDATE` trigger freezes `requested_by` and stamps `approved_by`/`approved_at` from the
  session (`0017`), closing the self-approval-by-rewrite bypass. (Insert-side residual: see 3.2.)

### 2.3 Idempotency / atomicity (EXE-1, RCP-1, CREATE-1) and ENGINE-DC
- Claim-first guards make `executeOperation`/`recordReceipt` idempotent; ENGINE-DC double-count is
  fixed by sourcing scheduled receipts from approved purchase_requests (`0018`) — Owner-ratified
  before the prod push. (Convention caveat: see 3.3.)

### 2.4 Org-spine / audit lockdown
- `organization`/`organization_member` client writes revoked (HIGH-1, `0010`); `organization_member`
  has a dedicated audit trigger (AUDIT-1, `0019`); `audit_log` append-only.

---

## 3. Queued residual caveats — NOT live-exploitable on synthetic single-tenant data

From the 2026-06-25 prod-push assurance (GO-WITH-CAVEATS). All three are tracked for a follow-up
change window; none is exploitable on the current single-tenant synthetic dataset. Sources:
[`DEPLOY-RUNBOOK.md`](DEPLOY-RUNBOOK.md) §1a, [`PROJECT-TRACKER.md`](PROJECT-TRACKER.md) (prod-push note),
[`SESSION-BRIEF.md`](SESSION-BRIEF.md).

### 3.1 AUTHZ-1 Option B — operation tables gated only in the RPC, not at the REST layer
- **What:** `fn_execute_operation` (`0020`) enforces `authorize('op.execute')`, but the operation
  tables it writes — `plan_operations`, `farm_event`, `event_locations`, `quantities` — keep the
  org-only `tenant_all` policy. So a member **without** `op.execute` could still write those tables
  **directly via PostgREST/REST**, bypassing the RPC's role check (the app path is already gated:
  `executeOperation` calls `authorize('op.execute')`, #71).
- **Why accepted/low-risk:** within a single tenant this is an **insider-authorization** gap, not a
  cross-tenant leak (RLS still scopes to the caller's org). The data is synthetic; no untrusted
  members exist. The intended `authorize()`-in-`WITH CHECK` pattern is proven (B2/`0015`) but was not
  generalized to the operation tables because splitting `tenant_all` regressed the PostgREST
  nested-embed reads the wedge loop depends on (documented in the B2 note).
- **Follow-up:** land **SPEC-0002 Option A/B** — gate the operation tables at the REST/RLS layer when
  the role model lands, keeping execution routed through the `bypassrls` RPC so supervisors/engineers
  can still execute. Pin with pgTAP. Required **before multi-tenant or untrusted members**.

### 3.2 AP-5 insert-side SoD — a born-approved PR sidesteps the BEFORE UPDATE trigger
- **What:** the AP-5 SoD guard (`0017`) is a `BEFORE UPDATE` trigger; a PR **inserted already in an
  approved state** does not pass through it (issue #76 item 2).
- **Why accepted/low-risk:** the app never creates born-approved PRs (creation goes through the
  draft→submit→approve flow); AP-1 still requires `authorize('pr.approve')` (owner-only) to set
  approval, and the budget routing is decision-support (see BUD-1 in the follow-up review). Single
  tenant, synthetic data.
- **Follow-up:** add the symmetric **insert-side SoD check** (a `BEFORE INSERT` guard / `WITH CHECK`
  that rejects an approved-on-insert row, or stamps approver from the session) — branch
  `fix/ap5-insert-side-sod` exists. Close with the role-model / multi-tenant work; pin with pgTAP.

### 3.3 ENGINE-DC disjointness is convention-enforced, not constraint-enforced
- **What:** the ENGINE-DC fix (`0018`) keeps `on_hand` (actual ledger) and forward scheduled receipts
  (open POs / approved purchase_requests) **disjoint by construction** — but that disjointness rests
  on the **convention** that the actual-movement ledger holds only received/past movements, not on a
  DB constraint. A future code path that posted a future-dated receipt movement could reintroduce the
  double-count.
- **Why accepted/low-risk:** the only sanctioned write path (`fn_post_movement`) posts actual
  movements, and the receipt flow flips the PR `→received` as the receipt enters `on_hand`, so the
  invariant holds in practice. Regression is pinned by pgTAP tests `14`/`16`.
- **Follow-up:** consider a CHECK/trigger (or a typed scheduled-vs-actual distinction) that *enforces*
  the disjointness, so the engine can never count a receipt twice even if a new write path appears.
  Engine = "independent review required" area; do not edit blind.

---

## 4. Owner-gated outstanding items

These are explicit Owner decisions (per `docs/CLAUDE.md`: access-control / deploy / data-migration =
Owner only). Recorded here so they are not lost, not because they are new.

### 4.1 Key rotation — deferred to project end (rotate BEFORE any real data)
- **What:** the Supabase **DB password** and **`service_role` key** were pasted in the deploy chat;
  the demo password is shared.
- **Status:** the **only red item** from the 2026-06-25 assurance. Owner deferred rotation to project
  end (2026-06-24 decision) because the data is synthetic.
- **Follow-up (hard condition):** rotate the DB password + `service_role` key **and** reset the demo
  password **before any real Ebeid data** — the exposed `service_role` key bypasses RLS. Also enable
  leaked-password protection then (see 1.4). Source: `PROJECT-TRACKER.md`, `SESSION-BRIEF.md` §key
  rotation.

### 4.2 DEP-1 — `postcss < 8.5.10` (transitive via `next`), build-time only
- **What:** `npm audit --omit=dev` reports 2 moderate advisories for transitive `postcss`
  (GHSA-qx2v-qp2m-jg93, XSS via unescaped `</style>` in CSS-stringify output).
- **Why low-risk:** postcss runs at **build time** over the app's own Tailwind/CSS, not untrusted
  input. `npm audit fix --force` proposes a bogus `next@9` downgrade — do **not** run it.
- **Follow-up:** clean fix is an npm `overrides` entry `"postcss": "^8.5.10"` (root `package.json`
  already uses `overrides`), applied with a full `next build` + Vercel re-verify (the Linux-native /
  Tailwind-v4 build chain is fragile — PRs #22–#33). Low urgency; Owner-gated (dependency change).

### 4.3 Real-data migration — Stage M (privacy review first)
- **What:** migrating real Ebeid financials + staff PII into the reference tenant.
- **Why gated:** putting real financial/PII data into the system (and any third-party model touching
  it) requires a **privacy review** first (PROJECT RULES hard stop). Current seed is synthetic.
- **Follow-up:** Stage M — do **not** use `seed.sql` for real data; migrate only after the privacy
  review, and only after key rotation (4.1). Source: `DEPLOY-RUNBOOK.md` §"For real Ebeid data",
  `PROJECT-TRACKER.md` Stage M.

---

## How to use this file

When an advisor run or review surfaces something here, check this register first. If it matches an
accepted item (§1) or a resolved one (§2), cite the migration/test and move on. If it matches a
queued caveat (§3) or an Owner-gated item (§4), the disposition is already decided — escalate to the
Owner only when the **follow-up condition** is met (multi-tenant, untrusted members, real data, or
the named change window). Only genuinely *new* findings warrant a fresh entry.
