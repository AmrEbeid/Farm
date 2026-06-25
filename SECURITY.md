# Security Policy

Farm OS (نظام تشغيل المزارع) is a private, multi-tenant, Arabic-RTL farm-operations
SaaS built on Supabase (Postgres + Auth) with a Next.js front end. It handles
tenant farm data — inventory, plans, budgets, purchase requests, and an audit
trail — so we take the integrity and isolation of that data seriously.

This document explains what is in scope, how to report a vulnerability privately,
what to expect after you report, and the security controls that are actually in
place in this repository today.

## Supported scope

Security reports are accepted for the code in this repository:

- The `apps/farm-os` application (Next.js server actions, auth, and middleware).
- The Supabase database layer under `apps/farm-os/supabase` — migrations
  (RLS policies, grants, triggers, `SECURITY DEFINER` functions), seeds, and the
  pgTAP test suite.
- The published `@amrebeid/ui` package under `packages/`.

Only the latest `main` branch is supported. We do not maintain or patch older
tags or branches.

Out of scope: third-party platforms we depend on (Supabase, Vercel, GitHub) —
report those to the respective vendor. Findings that require physical access,
a compromised maintainer account, or social engineering of the repository owner
are also out of scope.

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for a security
vulnerability.** Public disclosure before a fix puts tenant data at risk.

Report privately through a **GitHub private security advisory** on this
repository:

1. Go to the repository's **Security** tab → **Advisories** → **Report a
   vulnerability** (this opens a private channel visible only to the maintainers).
2. Address the report to **the repository owner (@AmrEbeid)**.

> Note for the maintainer: add a dedicated security contact (a monitored email
> address) here so reporters have a non-GitHub fallback. This file intentionally
> does not list one because a real, monitored address has not been provided.

Please include, where you can:

- A clear description of the issue and its impact (e.g. cross-tenant read/write,
  privilege escalation, data tampering, secret exposure).
- Steps to reproduce, or a proof of concept.
- The affected file(s), migration(s), route(s), or function(s).
- Any suggested remediation.

We especially want to hear about: cross-tenant data access (RLS bypass),
authorization/permission bypass, separation-of-duties bypass on approvals,
tampering with the append-only audit log or inventory ledger, `SECURITY DEFINER`
function abuse, and any exposed secret or credential.

## What to expect

This is a small, owner-gated project, so timelines are best-effort rather than a
contractual SLA:

- **Acknowledgement** of your report as soon as the owner sees it.
- **Triage** — we confirm or reproduce the issue and assess severity. Every
  reported issue is reproduced against the source before any fix.
- **Remediation** — fixes land as small, independently reviewable changes. Any
  change to access control, money/budget logic, or the stock engine gets an
  independent review and a regression test before merge, and is gated by the
  repository owner (who is not the author of the fix).
- **Disclosure** — we coordinate timing with you and credit you if you'd like.

Please give us reasonable time to remediate before any public disclosure.

## Security posture

The controls below are implemented in this repository. They are described as they
exist today; this is not a compliance attestation or a guarantee of completeness.

- **Deny-by-default tenant isolation in Postgres RLS.** Every tenant table
  carries an `org_id`, and Row Level Security policies scope all access to the
  caller's organization. Isolation is enforced in the database, not only in the
  application layer. Child tables additionally check the parent row's `org_id`,
  and several reference columns reject pointers to another org's rows.

- **Role-based permission model.** A set of roles and an `authorize()`
  permission map (defined in the initial migration) gate sensitive operations —
  for example, inventory writes require `inventory.write` and operation
  execution checks `op.execute`. Enforcement is being progressively moved from
  the application layer into the database layer (see the authorization-enforcement
  spec in `docs/`).

- **Append-only audit log.** Changes to tenant tables are recorded to an
  immutable `audit_log` via triggers, including a dedicated trigger for
  membership (join/leave/role change) on `organization_member`. Client roles
  cannot write to the audit log directly.

- **Append-only inventory ledger.** `inventory_movements` (and the derived
  `inventory_bin`) are append-only for every client role — `DELETE` and `UPDATE`
  privileges are revoked from `anon`/`authenticated`. Stock corrections are made
  as compensating movements through an org-guarded, transactional RPC
  (`fn_post_movement`) that recomputes balances from the signed movement sum, so
  the bin always reconciles to the ledger.

- **Separation of duties on approvals.** Purchase-request approval is enforced in
  the database: only an owner role can approve (`pr.approve`), and the requester
  cannot approve their own request. A `BEFORE UPDATE` trigger freezes the
  requester field and stamps the approver from the session, so the
  self-approval and provenance-falsification paths are closed.

- **`SECURITY DEFINER` function lockdown.** Privileged definer functions
  (e.g. `fn_post_movement`, `fn_execute_operation`, the audit and approval-guard
  triggers) carry an organization guard, explicitly block the unauthenticated
  `anon` role, and have `EXECUTE` revoked from `public`/`anon`/`authenticated`
  down to the specific roles that need them.

- **Secrets only in environment, never committed.** No `.env*` files, JWTs,
  connection strings, or keys are tracked in the repository. The service-role key
  is server-only and never shipped in the client bundle; runtime secrets live in
  Vercel and Supabase configuration.

- **Security regression gate in CI.** The pgTAP suite — covering RLS isolation,
  audit immutability, seed invariants, the stock-coverage engine, and the
  security-remediation regressions — runs on every pull request and push to
  `main` via the `db-tests` GitHub Actions workflow. Each security fix above is
  pinned by a dedicated regression test. (This harness runs Docker-free, so it
  does not by itself exercise `FORCE ROW LEVEL SECURITY`, PostgREST/GoTrue, or the
  end-to-end flow; those are verified on the full Supabase stack.)

For background on specific findings and remediations, see the `docs/SECURITY-*`
review files in this repository.
