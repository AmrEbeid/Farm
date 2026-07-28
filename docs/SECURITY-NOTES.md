# SECURITY-NOTES — accepted findings & residual-risk register   (reconciled 2026-07-13; §5 added, §4.2 updated 2026-07-28)

Purpose: a durable record of the **known, accepted, low-risk** security findings on Farm OS MVP-0,
so future Supabase advisor runs and independent reviews have context and do not re-litigate settled
decisions. Each entry states **what it is**, **why it is accepted / low-risk**, and **the follow-up
condition** (what would change the verdict, or what is still owed).

Scope: `apps/farm-os` (live Supabase project `veezkmytervjnpxcrbkw`; production ledger head
`20260712120000` at this reconciliation).
This file is a register, not a new review — every item below is grounded in the existing security
docs and migrations. It does **not** invent new issues. Sources:
- [`SECURITY-REVIEW-MVP0-2026-06-23.md`](SECURITY-REVIEW-MVP0-2026-06-23.md)
- [`SECURITY-REVIEW-FOLLOWUP-2026-06-25.md`](SECURITY-REVIEW-FOLLOWUP-2026-06-25.md)
- [`SECURITY-FINDING-delete-exposure-2026-06-25.md`](SECURITY-FINDING-delete-exposure-2026-06-25.md)
- [`SECURITY-FINDING-engine-receipt-doublecount-2026-06-25.md`](SECURITY-FINDING-engine-receipt-doublecount-2026-06-25.md)
- [`DEPLOY-RUNBOOK.md`](DEPLOY-RUNBOOK.md) §1a (prod-push) · [`PROJECT-TRACKER.md`](PROJECT-TRACKER.md) · [`SESSION-BRIEF.md`](SESSION-BRIEF.md)

Posture baseline: multi-tenant isolation is enforced primarily in **Postgres RLS** (deny-by-default,
`org_id` on tenant tables), with invoker-security required for exposed views. The 2026-06-25 prod push followed an
8-agent adversarial assurance that returned **GO-WITH-CAVEATS**; the pgTAP suite remains gated in CI
(`.github/workflows/db-tests.yml`). Production now contains real farm financial data, so no current risk verdict may
rely on the old synthetic-data assumption. The July 12 #899 fix is the latest recorded cross-org exposure closure.

---

## 0. 2026-07-09 — time-bounded security review outcome

A six-lane review covered RLS/tenant isolation, `SECURITY DEFINER` routines, the `authorize()` role map,
secrets/service-role use, server actions/AI, and active-org auth. Every reported finding was checked against source
before action. This records what was fixed on July 9; it is not a permanent clean bill. A separate cross-org leak
through two security-definer views was found and fixed on July 12 in #899.

**Fixed and merged:**
- **HIGH — service-role gallery deletion:** `saveSiteContent` could invoke RLS-bypassing storage cleanup before the
  owner-gated save RPC, using a client-supplied org id. The admin path now requires owner role and equality with the
  session-derived org before deletion. PR #880 (`5595b48`).
- **MEDIUM — CSV formula injection:** exported string cells beginning with formula-trigger characters are now
  prefixed safely while numeric values remain numeric. PR #881 (`2ed8f61`).
- **LOW — `_recovery.*` financial backup tables lacked a database-level deny layer:** migration `20260709120000`
  enables + forces RLS with no client policy and was applied to production and verified. PR #882 (`76482e3`); see
  `DEPLOY-STATUS.md` for live evidence.
- **Regression coverage:** #881 added policy-predicate invariants and pinned the `authorize()` role map. The existing
  dynamic function-grant checks already covered the reviewed default `EXECUTE` concern, so no default-privilege
  change was shipped.

### 0.1 Follow-up condition — verify `custom_access_token_hook` before a second org

Hosted enablement of `custom_access_token_hook` has not been verified. `supabase/config.toml` proves local config
only; it does not prove the production dashboard setting. Before onboarding a second org, confirm the hook is enabled
and verify that a newly minted token carries the membership-validated `active_org_id`. If disabled, a multi-org user
could receive a merged view of orgs they genuinely belong to; `user_org_ids()` still prevents access to a
non-member org. Treat this as a required verification gate, not as a confirmed production defect.

---

## 1. Supabase advisor categories — current dispositions

These are the current dispositions for recurring advisor findings. Accepted design choices and open dashboard
actions are distinguished below.

### 1.1 `authorize()` and `user_org_ids()` are anon/authenticated-EXECUTABLE — BY DESIGN
- **What:** the advisor flags these two `public` functions as executable by `anon`/`authenticated`.
- **Why accepted:** they are the **RLS helper functions** themselves. Both are `SECURITY DEFINER`
  with a locked `search_path` and return **only the caller's own context** —
  `user_org_ids()` returns the caller's active-org-narrowed membership set, and `authorize(perm, p_org)` returns whether
  the *caller's* role grants `perm` (both key on `auth.uid()`; an anon caller has a null `uid` and
  gets the empty/false result). They must be executable by the roles whose policies call them — that
  is how tenant RLS policies evaluate. Current definitions: `user_org_ids()` in migration `0085`
  (`20260622000085_active_org.sql`) and the latest `authorize(perm, p_org)` re-emit in `20260701420000_site_content.sql`.
- **Follow-up:** none. Revoking these would break RLS itself. Re-confirm that both remain rooted in `auth.uid()` and
  that `authorize()` constrains its `p_org` argument to the caller's real membership.

### 1.2 Client-callable business RPCs are authenticated-EXECUTABLE — BY DESIGN
- **What:** `fn_execute_operation` and `fn_stock_coverage` are executable by `authenticated`; the advisor lists
  them as `SECURITY DEFINER` callable functions. `fn_post_movement` and `fn_bin_rebuild` are internal-only and are
  **not** executable by `anon` or `authenticated`.
- **Why accepted:** the client-callable pair are intended write/read entry points. They are `SECURITY DEFINER` with a
  pinned `search_path` and **gate authorization in the body** against the *caller* (`SECURITY DEFINER`
  does not change `auth.uid()`, so `authorize()`/the org guard still evaluate the caller):
  - `fn_execute_operation` checks org-scoped `authorize('op.execute', …)` + a cross-org guard at the top, then runs
    the whole execution as one transaction (`0020`).
  - `fn_stock_coverage` is an authenticated read/reconciliation entry point (`0009`).
  - `fn_post_movement` is the internal inventory-write primitive and `fn_bin_rebuild` is internal reconciliation;
    both have client execute revoked.
  - **anon is explicitly revoked** on the client-callable RPCs. Trigger functions
    `pr_guard_approval`/`fn_audit`/`fn_audit_org_member` are revoked from
    `public`, `anon`, **and** `authenticated` in `0021` (never client-invoked).
- **Follow-up:** none for the grant layer. The former AUTHZ-1 REST-layer gap was closed by migration `0025`; see
  2.5 and §3.

### 1.3 `btree_gist` extension in `public` — accepted placement
- **What:** the current advisor flags `btree_gist` in `public`; it supports the locked-period overlap exclusion
  constraint from migration `20260712100000`.
- **Why accepted:** this is an extension-placement warning, not an exposed-data finding. Moving an installed
  extension can affect dependent objects and is not justified without a tested migration.
- **Follow-up:** reassess only with a dependency-aware migration and full period-lock regression coverage.

### 1.4 Leaked-password protection disabled — dashboard toggle
- **What:** the advisor flags that Supabase Auth leaked-password protection (HaveIBeenPwned check) is
  off.
- **Why it remains here:** it is a **dashboard setting**, not a code or migration defect, but production is no
  longer synthetic. Do not use the old demo-data rationale to defer it.
- **Follow-up:** enable the toggle in the Supabase dashboard (Auth → Policies) and verify it with a fresh advisor
  run. This is an open Owner configuration action; key rotation itself is complete (see 4.1).

---

## 2. Resolved hardening (recorded for continuity — do NOT re-flag)

These were real findings that are **fixed and verified**; listed so an advisor/review does not mistake
the historical wording for an open issue.

### 2.1 Inventory ledger is append-only for every client role
- `revoke delete … from authenticated, anon` on `inventory_movements`/`inventory_bin` (`0016`, B2.1)
  and `revoke update …` (`0022`) → the ledger is **append-only**; corrections are compensating
  movements via the `bypassrls` `fn_post_movement` RPC. Inventory writes are role-gated with the caller's org via
  `authorize('inventory.write', …)`. pgTAP tests `10`/`11`.

### 2.2 PR self-approval (AP-5) frozen at the DB
- `BEFORE UPDATE` trigger freezes `requested_by` and stamps `approved_by`/`approved_at` from the
  session (`0017`), closing the self-approval-by-rewrite bypass. Migration `0023` added the symmetric insert-side
  guard, closing the born-approved path as well.

### 2.3 Idempotency / atomicity (EXE-1, RCP-1, CREATE-1) and ENGINE-DC
- Claim-first guards make `executeOperation`/`recordReceipt` idempotent; ENGINE-DC double-count is
  fixed by sourcing scheduled receipts from approved purchase requests (`0018`). Migrations `0026` and `0029`
  added the database constraint and scope guard that closed the former convention-only residual.

### 2.4 Org-spine / audit lockdown
- `organization`/`organization_member` client writes revoked (HIGH-1, `0010`); `organization_member`
  has a dedicated audit trigger (AUDIT-1, `0019`); `audit_log` append-only.

### 2.5 Operation-table writes are permission-gated at the REST/RLS layer
- Migration `0025` replaced the org-only write posture while preserving the intended read paths: `plan_operations`
  uses `plan.write`, matching the planning flow; `farm_event`, `event_locations`, and `quantities` use `op.execute`.
  This closed AUTHZ-1; do not report it as queued.

---

## 3. Former June 25 caveats — all closed

The June 25 assurance queued three caveats under the then-synthetic pilot posture. They are retained here only as
history; none remains open:

- **AUTHZ-1:** operation-table REST/RLS writes were permission-gated by migration `0025`.
- **AP-5 insert-side SoD:** migration `0023` added the insert guard.
- **ENGINE-DC convention residual:** migrations `0026` and `0029` added the database constraint and PR-scope guard.

Any new concern in these areas must be assessed against the current definitions and tests, not the superseded June
25 descriptions.

---

## 4. Owner/configuration status

### 4.1 Key rotation — completed
- The Owner confirmed on 2026-06-29 that the Supabase DB password and `service_role` key rotation was complete.
  Do not re-open the old exposed-key finding without fresh evidence. Leaked-password protection remains a separate
  dashboard action (1.4).

### 4.2 Dependency advisories — Next.js patched 2026-07-28; `postcss`/`sharp` still open
- **Live patch.** PR #935 merged at `7b138ac`; production deployment
  `dpl_BLGjEsTkDx4YKkeQN2gD5FNP9ZVW` is READY. `next` and `eslint-config-next` moved
  16.2.10 → **16.2.12** (patch-only; both kept aligned). This
  clears all nine Next.js-specific advisories `npm audit` reported at 16.2.10 — middleware/proxy bypass, Server
  Actions DoS, SSRF on custom servers and via rewrites, two cache-confusion items, unbounded Edge Server Action
  payload, Image-Optimization SVG DoS, and unauthenticated Server Function endpoint disclosure. Do not re-flag these.
- **Correction.** The superseded note here called `postcss` resolved at 8.5.15; the advisory range has since widened
  to `<= 8.5.17`, so 8.5.15 is itself vulnerable.
- **Local/unmerged root fix.** The repository-level override moves to `postcss ^8.5.23`; Tailwind, Vite,
  Storybook, and the design-system toolchain resolve 8.5.23 without an invalid peer/range state. This removes
  the vulnerable root node, but does not reach Next's private 8.4.31 copy.
- **Still open — not fixable by a Next patch.** `next` remains listed, but now only as a *dependent* of two
  transitive packages: it hard-pins `postcss` `8.4.31` and declares `sharp` `^0.34.5` (optional). The fixes need
  `postcss > 8.5.17` and `sharp >= 0.35.0`, which those ranges cannot reach, and 16.2.12 is the newest Next release —
  so no further patch bump helps.
- **Follow-up condition (Owner-gated).** Clearing these needs nested `overrides` forcing Next's own pins; a verified
  experiment confirmed plain root overrides (`postcss ^8.5.18`, `sharp ^0.35.0`) do **not** reach them. That
  overrides versions Next pins and tests against (CSS pipeline, image optimization), so it is a deliberate dependency
  decision, not a patch. Reassess from a fresh audit before recording any replacement finding.

### 4.3 Stage M — finance complete; registry pending; privacy boundary remains
- Real farm financial data is live, but the real palm registry is still pending. The old "current seed is synthetic"
  and "before any real data" wording is superseded only for finance. Any new staff PII import or transfer of
  production data to a third-party model still requires the project privacy review and explicit Owner approval.

### 4.4 Current dashboard gates
- Verify `custom_access_token_hook` before onboarding a second org (0.1).
- Enable leaked-password protection and verify the advisor clears (1.4).
- Rotate, delete, or replace the production `*@ebeid.test` demo identities; treat the retired shared password as
  compromised (5.1). The code-side surface is removed, the live identities are not.

---

## 5. 2026-07-28 — production demo-credential surface removed (live; identities still Owner-gated)

**What it was.** The production login page (`apps/farm-os/app/login/page.tsx`) is a client component, so
everything in it shipped in the browser bundle. It carried four demo account addresses
(`owner@`/`manager@`/`storekeeper@`/`supervisor@` … `ebeid.test`), the **shared password
`[REDACTED RETIRED DEMO PASSWORD]` as a string literal**, prefilled both fields with the owner address and that password, and
offered a "تفعيل حسابات العرض" button that `POST`ed to `/api/dev/seed-auth`. The error copy told users to
try demo activation. The provisioning route (`app/api/dev/seed-auth/route.ts`) and its service-role helper
(`lib/seed-auth.ts` — which also held `SEED_PASSWORD`) shipped in the production source even though the
route was environment-gated (local-URL **and** `VERCEL_ENV !== 'production'`), and `proxy.ts` carried an
`api/dev` matcher exclusion that existed only for it.

The route's own gates held, so this was **credential and account-name disclosure plus a
provisioning surface in the shipped source**, not a demonstrated production write path. It is no longer
acceptable regardless: production now holds real farm financial data, so the superseded synthetic-pilot
rationale recorded elsewhere in this register (§4.3) may not be used to defer it.

**What changed (PR #933, merged `a1d5834`, production deployment
`dpl_8mLoTNzc81ikwoVjS8R9TQ45SQkF` READY):**
- Login page: both fields start blank; the demo chooser, the shared password, the "تفعيل حسابات العرض"
  action, and the demo-activation error copy are gone. The Supabase `signInWithPassword` call, the
  `/dashboard` redirect, the error handling, the Arabic RTL layout, and the brand panel are unchanged.
- `app/api/dev/seed-auth/route.ts` and `lib/seed-auth.ts` are **deleted** (the helper had no non-test
  consumer). `app/api/dev/` no longer exists, and the `api/dev` exclusion is removed from the `proxy.ts`
  matcher.
- e2e user provisioning lives entirely in `e2e/global-setup.ts` + `e2e/wedge-loop.spec.ts` and now requires
  a per-run, test-only `FARM_OS_E2E_PASSWORD` (≥16 chars). There is **no committed password and no
  fallback** — a missing value aborts the run.
- `apps/farm-os/lib/login-auth-surface.test.ts` is a source-contract regression guard: it fails if the login
  page regains the known password, a demo address, the activation copy or endpoint, or a non-blank field
  initialiser; if the deleted route/helper or the proxy special case return; or if the retired strings
  reappear anywhere under `app/` or `lib/`.

Live verification on `ebeidfarm.business/login` found both fields blank and no demo controls. All 12 loaded
client scripts were clean for the retired password, demo addresses, activation text, and provisioning
endpoint. Vercel reported no runtime errors in the preceding 30 minutes. No migration was required.

### 5.1 Follow-up condition — Owner action on the live demo identities (OPEN)

**Removing the code does not change any live account.** The demo identities may still exist in the production
Supabase project, and the retired shared password must be treated as compromised for any account that ever used it — it
was committed to git history and shipped in the client bundle, so removal from HEAD does not retract it.

Read-only production audit on 2026-07-28: six confirmed demo-email identities have signed in and are linked
to the organization; six phone-only seed identities have never signed in and are not linked. The security
advisor still reports leaked-password protection disabled.

**Owner-only, not performed by this change (no live user was created, deleted, reset, or invited here):**
1. Enumerate the `*@ebeid.test` identities in the production project (`veezkmytervjnpxcrbkw`).
2. For each: rotate to a unique strong secret, delete it, or replace it with a **real, recoverable** account
   for the actual person, and re-link `people.user_id` / `organization_member` accordingly.
3. Confirm no remaining account authenticates with `[REDACTED RETIRED DEMO PASSWORD]`.
4. Enable leaked-password protection (§1.4) so a reused/known secret is rejected at sign-up/reset.

Do not record this item as closed until steps 1–4 have live evidence. Git-history purge of the literal is
hygiene only; rotation/deletion is the real fix (same logic as
[`STAGE-0-REMEDIATION-RUNBOOK.md`](STAGE-0-REMEDIATION-RUNBOOK.md) §B).

---

## How to use this file

When an advisor run or review surfaces something here, check this register first. If it matches an accepted item
(§1), a resolved control (§2), or a former caveat (§3), verify the current definition/test and do not re-open it from
historical wording alone. Section 4 separates completed gates from current dashboard actions. Only genuinely new
evidence or an unmet current follow-up condition warrants a fresh entry.
