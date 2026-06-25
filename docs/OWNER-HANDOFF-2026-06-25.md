# Owner Handoff & Decision Brief — Farm OS (2026-06-25)

> Single source of truth for "what do I do next" after a large autonomous session.
> Factual, scannable, cross-referenced to real PRs/issues/docs. **Nothing in this brief
> deploys to prod or merges anything** — every action below is an explicit Owner call.

---

## 1. Current live state — what's actually in production

| Layer | Live now | Source of truth |
|---|---|---|
| **App** | `farm-ui-one.vercel.app` + custom domain `ebeidfarm.business` (Vercel project `farm-ui`) | `docs/DEPLOY-STATUS.md` |
| **DB schema** | Prod Supabase `veezkmytervjnpxcrbkw` (eu-west-1) at **migration `0023`** (`0001–0013` + `0015–0023`) — verified live via Supabase MCP `list_migrations` | this brief, `docs/PROJECT-TRACKER.md` |
| **Repo `main`** | HEAD `9a81fe2`; top migration on disk is `0023` (`pr_approval_sod_guard_insert`) | `git log` |
| **Auth** | Email + password only (6 seeded demo roles). Phone-OTP/Twilio **dropped** from MVP-0 scope. | `docs/DEPLOY-STATUS.md` |
| **`@amrebeid/ui`** | Published `1.1.x` (repo `package.json` at `1.1.1`); app consumes prebuilt `packages/ui/dist/` committed in-repo | `packages/ui/package.json` |

**Prod == repo `main`.** The live DB migration set (`0001–0013`, `0015–0023`) matches the
migrations on disk in `main` exactly — there is no drift. Everything below ("PRs awaiting
decision") exists **only in branches/PRs**, not in prod or on `main`.

> Note: `docs/DEPLOY-STATUS.md` prose still says "Migrations now at 0022" in one spot — that
> line predates the `0023` push. The authoritative, MCP-verified live state is **`0023`**.

---

## 2. The 3 open PRs awaiting an Owner decision

All three are **`MERGEABLE` / `mergeStateStatus: CLEAN`** against `main` as of this brief.
The other open PRs (#125–#131) are routine Dependabot bumps and are **not** part of this
decision set.

### PR #85 — `fix(engine): atomic fn_post_receipt RPC` — STOCK-ENGINE change
- **Branch:** `fix/receipt-atomicity-rpc` · **Files:** +266/−60 · actions.ts + **migration `0024`** + 2 pgTAP tests
- **What it does:** Replaces the non-atomic client-side receipt loop in `recordReceipt` with a single `SECURITY DEFINER` `fn_post_receipt(p_pr_id)` that claim-flips `approved → received` and posts every PR line item's `fn_post_movement('receipt', …)` **in one transaction**. Any mid-loop failure now rolls back the claim + all prior receipts (PR stays `approved`, cleanly retryable). Closes the partial/half-received corrupt-state bug. Mirrors the `fn_execute_operation` (0020) precedent; locked down per 0021 (search_path='', revoke anon, grant authenticated).
- **Why Owner-gated:** It is a **stock-engine change + a new prod migration (`0024`)**. Per project rule, no engine/DB change reaches prod without explicit Owner ratification.
- **Verification:** pgTAP 150/150 (new test `23` ok=13, invariant `22` ok=8); app `tsc`/`eslint`/`next build` clean. Migration `0024` is **not** on prod yet.
- **Land safely (do in lockstep):**
  1. Apply migration `0024` (`20260622000024_fn_post_receipt.sql`) to prod Supabase `veezkmytervjnpxcrbkw` — via Supabase MCP `apply_migration` or `supabase db push`.
  2. Immediately merge PR #85 to `main` (keeps prod == repo).
  3. Smoke-test: record a multi-item receipt as `storekeeper`; confirm status flips and all bins post; confirm a repeat call is rejected (idempotent).
- **Recommended order:** **land FIRST.**

### PR #111 — `feat(types): generated Supabase types + typed clients`
- **Branch:** `feat/supabase-typed-client` · **Files:** +2340/−125 · `lib/database.types.ts` (generated), typed server/browser/admin clients, 3 call-site type fixes, `package.json` + `package-lock.json`
- **What it does:** Adds generated Supabase types and applies the `Database` generic to all three clients so DB queries are type-checked at build time. Three behavior-equivalent call-site fixes (Json accumulator typing, nullable `unit` prop, `null`→`undefined` optional RPC arg).
- **Why Owner-gated:** Carries a **dependency bump `@supabase/ssr` `0.5.2` → `0.12.0`** (required — `0.5.x` generics collapse every typed `.select()` to `never` against the installed `supabase-js@2.108`). Dep change on the auth/data path → Owner sign-off + an auth smoke test.
- **Verification:** `npm run build` (app) compiles/type-checks/lints clean; `npm test` 75/75.
- **Land safely:**
  1. Merge after #85 (it touches the same `purchase-requests/[prId]/actions.ts` — landing #85 first avoids a rebase conflict; re-confirm `CLEAN` after #85 merges).
  2. After merge + redeploy, run an **auth smoke test**: sign in (email+password), load an org-scoped page, confirm RLS still scopes to the one org. The `getAll`/`setAll` cookie usage is unchanged, but the SSR bump warrants the check.
- **Recommended order:** **land SECOND (after #85).**

### PR #123 — `fix(deps): pin postcss >=8.5.10 via overrides (DEP-1)`
- **Branch:** `fix/dep1-postcss-override` · **Files:** +108/−134 · `package.json` + `package-lock.json` only
- **What it does:** Adds a root npm `overrides` pin `"postcss": "^8.5.10"`, dropping the transitive `next/node_modules/postcss@8.4.31` (GHSA-qx2v-qp2m-jg93, moderate, build-time only) and deduping to `postcss@8.5.15`. The agreed DEP-1 remediation (not `audit fix --force`, which would break-downgrade `next`).
- **Why Owner-gated:** A dependency-resolution / lockfile change.
- **Verification:** `npm audit --omit=dev` BEFORE = 2 moderate → AFTER = **0 vulnerabilities**; both workspaces (`apps/farm-os` next build, `packages/ui` tsup) build clean. Lockfile diff = exactly 1 package removed, 0 added, 0 unrelated version changes.
- **Land safely:** Independent of #85/#111 (root deps only). Merge any time; re-run `npm install && npm audit --omit=dev` after merge to confirm 0.
- **Recommended order:** **independent — land whenever.**

**Recommended land order:** **#85 (apply `0024` in lockstep) → #111** (auth smoke test); **#123 anytime, independent.**

---

## 3. Pending product / Owner decisions

| # | Decision | State / where | Action needed |
|---|---|---|---|
| **Pricing model** | Issue **#89** — hardcoded demo constants (`est_cost = qty*84`, `reserveQty=500`, budget `thisOp=42000`, `needed_by` literal) ship in coverage/budget/PR paths and judge wrong for any non-seed item. | Blocked on the per-farm EGP pricing model (`docs/05-gtm-pricing.md`, `docs/OWNER-DECISIONS-2026-06-24.md`). No standalone `PRICING-DECISION.md` exists — GTM/pricing lives in `docs/05-gtm-pricing.md`. | **Owner/product call:** pick a price source (column on `inventory_items` or a price table) + lead-time for `needed_by`. Per RULE #1 an agent must not guess financial data. Then #89 is implementable. |
| **`@amrebeid/ui` 1.2.0 release** | 4 changesets queued in `.changeset/` (3 `minor` + 1 `patch`: a11y, datatable-mobile, recharts code-split, reduced-motion). Repo at `1.1.1` → these bump to **`1.2.0`**. | `.changeset/*.md` | **Owner:** run the changesets version+publish flow (or approve the release PR) when ready to cut `1.2.0`. Rebuild + commit `packages/ui/dist/` if the app should consume the new lib. |
| **Key rotation** | Supabase DB password, `service_role` key, and demo login password were shared out-of-band and need rotation. **Deferred to project end** per current plan. | `docs/DEPLOY-STATUS.md` "Security follow-ups" | **Owner, before any non-demo/real use:** reset DB password, roll `service_role` (update Vercel `SUPABASE_SERVICE_ROLE_KEY` + redeploy), rotate/delete demo logins. |
| **Stage-0 legacy remediation** | Residual hardening queued, not blocking on synthetic single-tenant data: AUTHZ-1 Option B (gate operation tables at REST layer, not only in the 0020 RPC), ENGINE-DC disjointness as a DB constraint. | `docs/STAGE-0-REMEDIATION-RUNBOOK.md`, `docs/SECURITY-REVIEW-FOLLOWUP-2026-06-25.md`, SPEC-0002 (#69 draft) | **Owner:** ratify SPEC-0002 authorization-enforcement direction, then schedule the migrations. |
| **Real-data migration (Stage M)** | Prod is on synthetic seed (transactional tables empty — correct pilot state). Cutover to real farm data is a separate stage. | `docs/PROJECT-TRACKER.md`, `docs/MASTER-PLAN.md` | **Owner:** decide when to start Stage M; depends on the pricing decision (#89) and key rotation landing first. |

---

## 4. Verification status (this session's production-health sweep)

- **Live app:** `farm-ui-one.vercel.app` / `ebeidfarm.business` healthy (per `docs/DEPLOY-STATUS.md`).
- **Prod == repo:** Supabase MCP `list_migrations` confirms prod at **`0023`**, identical to the migration set on `main`. No drift.
- **Advisors:** Supabase security advisors return only the **known, documented WARN-level residuals** — `pgtap` extension in `public` (test tooling), the intentional `SECURITY DEFINER` RPCs callable by `authenticated` (by design: `authorize`, `user_org_ids`, `fn_post_movement`, `fn_execute_operation`, `fn_stock_coverage`, `fn_bin_rebuild`), and leaked-password-protection disabled (auth setting). **No ERROR-level findings; no new regressions** introduced by the session.
- **No regressions:** the 3 decision PRs are all `CLEAN`/`MERGEABLE`; none has been applied to prod or `main`.

> One advisor worth an eventual toggle (not blocking): **enable leaked-password protection**
> (Supabase Auth → HaveIBeenPwned) before real users — folds naturally into the key-rotation step.

---

## TL;DR — next actions for the Owner
1. **#85** — apply migration `0024` to prod, then merge (engine fix; do in lockstep).
2. **#111** — merge after #85, then auth smoke test (SSR `0.5.2→0.12.0`).
3. **#123** — merge anytime (postcss override; audit-clean, independent).
4. **Decide pricing (#89)** to unblock coverage/budget correctness and Stage M.
5. **At project end:** rotate keys + demo password; cut `@amrebeid/ui` 1.2.0; schedule Stage-0 remediation.
