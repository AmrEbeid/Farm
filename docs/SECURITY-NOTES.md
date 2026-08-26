# SECURITY-NOTES — accepted findings & residual-risk register   (advisor reconciliation updated 2026-08-25)

Purpose: a durable record of the **known, accepted, low-risk** security findings on Farm OS MVP-0,
so future Supabase advisor runs and independent reviews have context and do not re-litigate settled
decisions. Each entry states **what it is**, **why it is accepted / low-risk**, and **the follow-up
condition** (what would change the verdict, or what is still owed).

Scope: `apps/farm-os` (live Supabase project `veezkmytervjnpxcrbkw`).
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

### 1.1 Authenticated-executable `SECURITY DEFINER` functions — intentional allowlist
- **What:** the 2026-08-25 production advisor reports 133
  `authenticated_security_definer_function_executable` warnings. The live catalog contains 185 `public`
  `SECURITY DEFINER` functions: exactly 133 are executable by `authenticated`, while zero are executable by `anon`
  or `PUBLIC`. The authenticated set exactly matches the deliberate API allowlist enforced by
  [`22_security_invariants_test.sql`](../apps/farm-os/supabase/tests/22_security_invariants_test.sql) INV-2.
- **Why accepted:** this advisor rule warns on every authenticated-executable definer function; it does not establish
  that the function is unsafe. These functions are the intended authenticated RPC and RLS-helper surface. Every live
  public definer function is owned by `postgres` and pins `search_path` to the empty value. Anonymous execution,
  unexpected authenticated execution, direct trigger-function execution, and writable-schema name hijacking are
  blocked by INV-1, INV-2, and INV-5. The complete local migration + pgTAP run passed 5,155/5,155 checks on 2026-08-25.
- **Follow-up:** treat any authenticated-executable definer function outside the INV-2 allowlist, any anonymous/public
  grant, or any definer without `search_path = ''` as a release blocker. Reconcile the production catalog to the
  allowlist whenever an advisor count changes; do not blanket-revoke the intentional API surface. INV-2 currently
  identifies most approved functions by name; harden it to compare full `regprocedure` identities so an unintended
  overload of an approved name cannot inherit allowlist treatment.

### 1.2 Client-callable business RPCs are authenticated-EXECUTABLE — BY DESIGN
- **What:** the functions in the INV-2 allowlist are authenticated entry points. Internal primitives such as
  `fn_post_movement` and `fn_bin_rebuild`, plus all trigger functions, are **not** executable by `anon` or
  `authenticated`.
- **Why accepted:** the client-callable functions are intended write/read entry points. They are `SECURITY DEFINER`
  with a pinned `search_path` and **gate authorization in the body** against the caller (`SECURITY DEFINER`
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

### 1.4 Leaked-password protection — resolved 2026-08-05
- **What:** Supabase Auth leaked-password protection (HaveIBeenPwned check) is enabled.
- **Evidence:** a fresh production security-advisor run returned no leaked-password finding.
- **Follow-up:** none; recheck after Auth configuration changes.

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

### 4.2 Dependency advisories — current audit clean 2026-08-05
- **Live patch.** PR #935 merged at `7b138ac`; production deployment
  `dpl_BLGjEsTkDx4YKkeQN2gD5FNP9ZVW` is READY. `next` and `eslint-config-next` moved
  16.2.10 → **16.2.12** (patch-only; both kept aligned). This
  clears all nine Next.js-specific advisories `npm audit` reported at 16.2.10 — middleware/proxy bypass, Server
  Actions DoS, SSRF on custom servers and via rewrites, two cache-confusion items, unbounded Edge Server Action
  payload, Image-Optimization SVG DoS, and unauthenticated Server Function endpoint disclosure. Do not re-flag these.
- **Correction.** The superseded note here called `postcss` resolved at 8.5.15; the advisory range has since widened
  to `<= 8.5.17`, so 8.5.15 is itself vulnerable.
- **Live root fix.** PR #938 merged at `ee91739`; production deployment
  `dpl_FdAAJeu3dYbBSjArViqBWMm5fcvo` is READY. The repository-level override moved to
  `postcss ^8.5.23`; Tailwind, Vite,
  Storybook, and the design-system toolchain resolve 8.5.23 without an invalid peer/range state. This removes
  the vulnerable root node, but does not reach Next's private 8.4.31 copy.
- **Resolved by PR #998.** Next 16.3.0 moved its private PostCSS/Sharp edges to PostCSS 8.5.23 and
  Sharp 0.35.3. The same release keeps `eslint-config-next` aligned. Compatible lock refreshes moved
  `brace-expansion` to 1.1.18/2.1.4/5.0.9 and `undici` to 7.29.0.
- **Live js-yaml fix.** PR #940 merged at `0f0708b`; production deployment
  `dpl_6oe2pJ2xsnGrDnw1ukt46HwnAnnm` is READY. Scoped overrides use patched `js-yaml` `4.3.0`
  for Changesets/ESLint and `3.15.0` for `read-yaml-file`, preserving each parent's API generation.
  The high-severity `js-yaml` category is removed; the audit is now 7 findings
  (1 low, 2 moderate, 4 high).
- **tsup/esbuild compatibility pin.** tsup 8.5.1 still declares `esbuild ^0.27.0`; the current advisory
  covers 0.27.3-0.28.0, while patched 0.28.1 is outside tsup's range. PR #998 therefore pins only tsup's
  edge to safe in-range 0.27.2. Fresh `npm ci` reproduces the lock exactly, UI output is unchanged, and
  the override must be removed once tsup accepts 0.28.1 or later.
- **Current result.** The 2026-08-05 fresh audit moved from 6 findings (5 high / 1 low) to **0**.
  This is a point-in-time dependency result, not a permanent security guarantee; rerun after dependency
  changes and newly published advisories.

### 4.3 Stage M — finance complete; registry pending; privacy boundary remains
- Real farm financial data is live, but the real palm registry is still pending. The old "current seed is synthetic"
  and "before any real data" wording is superseded only for finance. Any new staff PII import or transfer of
  production data to a third-party model still requires the project privacy review and explicit Owner approval.

### 4.4 Current dashboard gates
- Verify `custom_access_token_hook` before onboarding a second org (0.1).
- Leaked-password protection and synthetic-identity cleanup are complete (1.4, 5.1).

---

## 5. Production demo credential removed; identities closed 2026-08-05

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

### 5.1 Follow-up condition — live demo identities (CLOSED 2026-08-05)

Removing the code did not itself change a live account. The separate live cleanup is now complete, while the
retired shared password remains compromised historical material because removal from HEAD does not retract it.

The 2026-07-28 baseline was six linked demo-email identities and six unlinked phone-only seed identities.
The 2026-08-05 postflight found 0 users in both populations and 0 corresponding people or organization-member
links. The security advisor has no leaked-password finding.

**Completed controls:**
1. Enumerated the `*@ebeid.test` and email-null phone-only populations in production.
2. Deleted both synthetic populations; aggregate postflight found no dangling people or memberships.
3. Confirmed the retired demo identities no longer exist and therefore cannot authenticate.
4. Enabled leaked-password protection (§1.4).

The aggregate identity/link counts and fresh advisor provide the live evidence required to close this item.
Git-history cleanup remains separate hygiene under Stage 0 steps A–C.

---

## 6. Password recovery domain correction — CLOSED 2026-08-26

The production Auth Site URL was found pointing at a protected Vercel deployment. Recovery emails generated
from the default Supabase template therefore sent ordinary Farm users to a Vercel authentication screen, and
the application had no in-product forgot/reset-password workflow.

SPEC-0035 adds an anonymous, enumeration-resistant request page; a prefetch-safe URL-fragment form that keeps
the token out of requests, referrers and server logs; server-side verification restricted to one-time `recovery`
token hashes in the same request that changes the password; a 12-character minimum with confirmation; and
checked global session revocation with an explicit partial-success warning if revocation fails after the update.
Recovery paths are excluded from organization-membership repair, while all existing Farm roles and memberships
remain unchanged. No service role or database migration is involved.

PR #1077 merged as `c5ed6c7a78721883ed5740f6eaba3c029955ec6f`; exact-main CI, database tests,
release workflow, and Vercel Production passed. Supabase Site URL and redirect allowlist use
`https://ebeidfarm.business`, the Arabic template points to the app-owned fragment callback, and live anonymous
request/reset surfaces were verified. The reset response is `no-store` / `no-referrer`, and the fragment was
removed immediately with no console error. Old emails retain their old links; users must request a fresh email.
No real recovery email or password change was submitted during postflight.

---

## How to use this file

When an advisor run or review surfaces something here, check this register first. If it matches an accepted item
(§1), a resolved control (§2), or a former caveat (§3), verify the current definition/test and do not re-open it from
historical wording alone. Section 4 separates completed gates from current dashboard actions. Only genuinely new
evidence or an unmet current follow-up condition warrants a fresh entry.
