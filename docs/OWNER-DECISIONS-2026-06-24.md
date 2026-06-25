# Path to Finish — Owner Decisions & Recommendations   (2026-06-24)

For: Amr Ebeid (Owner). Prepared by: Claude. Purpose: consolidate every open decision/gate
that stands between today's state and a deployed, pilot-validated Farm OS, **with a concrete
recommendation for each** so we can resolve them in one pass. Nothing here is an action taken —
these are proposals; the irreversible/external ones (deploy, key rotation, billing) remain
Owner-gated per `docs/CLAUDE.md`.

**Turnkey runbooks ready (so your gated steps are one pass):**
`DEPLOY-RUNBOOK.md` (+ `apps/farm-os/.env.production.example`) for §1/§2/§4, and
`STAGE-0-REMEDIATION-RUNBOOK.md` for §3.

## Where we are (done + verified)
- **`@amrebeid/ui@1.1.0`** published (GitHub Packages); library hardened, 231 tests green.
- **MVP-0 app** security-reviewed and remediated on `main`: RLS/grants/engine fixes, the
  transactional ledger-reconciled inventory path (`fn_post_movement`, B1+D2), input validation,
  a `db-tests` pgTAP CI gate. **74/74 pgTAP + the Playwright wedge-loop e2e pass on the real
  Supabase stack.** Full record: `docs/SECURITY-REVIEW-MVP0-2026-06-23.md`.
- This is *engineering-complete + security-reviewed + e2e-verified on a LOCAL DB.* Not deployed,
  not pilot-validated, legacy Stage 0 still open.

## Decisions needed (with my recommendation)

### 1. Deploy infrastructure  — **blocks everything downstream**  ⚠️ Vercel deployed, but no backend
**Status (2026-06-24):** the app was **deployed to Vercel**, but a Supabase-account check confirms
**only the six Zeal production projects exist — there is NO dedicated Farm OS project.** So the
deployment currently has **no valid backend**: auth + every data call will fail at runtime until a
Supabase project is wired. **Do NOT point it at a Zeal project** (forbidden by the rules; no schema
there anyway). I can't create the right project — the only visible org is the Zeal org
(`blhuyowtrvuuipogybll`), and creating there would bill Zeal + break isolation. **Need from you:** a
**non-Zeal** Supabase project (its ref + anon/service keys); then I set the 3 Vercel env vars, run
`supabase db push` (migrations 0001–0013) + load the synthetic seed, and re-verify. Also share the
**Vercel URL** so I can confirm how it's currently failing.

The connected Supabase account holds only **Zeal production projects** (do NOT use them, per
session rules). Farm OS needs its own isolated project.
- **Recommendation:** create a **dedicated, non-Zeal Supabase project** (free tier is fine for
  the pilot) + a **Vercel** project for the Next.js app. Apply the 14 migrations, load the Ebeid
  seed (or real data — see #5), wire env. Est. cost: $0 (free tiers) for one pilot tenant.
- **Need from you:** which billing account owns the new Supabase + Vercel projects (a personal
  Amr account, not Zeal). Once decided, I can pre-write all config (env, `vercel.json`, migration
  apply steps) — I just won't provision/deploy without your go-ahead.

### 2. Phone-OTP auth provider  ✅ RESOLVED — dropped (2026-06-25)
**Resolved: phone-OTP is dropped from MVP-0; auth is email + password only.** No SMS provider /
Twilio is needed. The phone-OTP UI skeleton has been removed; `[auth.sms]` stays disabled in
`supabase/config.toml`. (The `phone` field in the seed remains as a demo-linking key + contact
data — it is not auth.)

### 3. Legacy Stage 0 — secret remediation  (**still OPEN; Critical**)
The legacy system has an **exposed anon key + project id (old repo)** and **Gmail/password in the
accounting sheet**. This is independent of the new build but must close before real data/deploy.
- **Recommendation / plan:** (a) **rotate** the exposed Supabase anon/service keys on the old
  project (or pause/delete it if unused); (b) **purge** the secrets from the old repo's git history
  (`git filter-repo`) and force-push, or archive the repo private; (c) **scrub** the Gmail/password
  from the accounting sheet and rotate that Google password.
- **Need from you:** these are irreversible + touch systems I don't have access to → **you execute**,
  I can write the exact runbook. Confirm whether the old project/repo are still live.

### 4. B3 — hardcoded execution date & unit price  (data fidelity)  ✅ DONE
- **(a) Date — DONE** (PR #13): real server time `now()`.
- **(b) Price — DONE** (PR #16, per "go with your recommendation"): the hardcoded `84 ج.م/kg`
  is now the **plan-derived unit rate** (`op.est_cost ÷ planned qty`) — data-driven, not a magic
  number (seed: 42000÷500 = 84, so `actual_cost` stays 40320; e2e still meaningful).
- **Optional future refinement (your call):** use the *actual paid* price instead of the planned
  rate — capture `unit_cost` on `receipt` movements and derive actual cost from the latest receipt.
  More accurate for variance, but a data-model addition that shifts the reported figure. Say the
  word and I'll implement it. (`runPlanChecks` still hardcodes the budget category `"أسمدة"` —
  low-risk demo-ism, widen with multi-category budgets.)

### 5. Real Ebeid data vs seed (Stage M)
- **Recommendation:** keep the **synthetic seed** for the pilot demo; migrate **real** registry +
  accounting only after a privacy review (PROJECT RULES) and Stage 0. The Nov-2025 registry
  (4,380 برحي / 299 ذكور / 28 حوش) is canonical — **confirm** it's still agreed.

### 6. Inventory role model (B2)
Direct inventory writes aren't role-gated; the attempted gate regressed the e2e via a PostgREST
embed interaction (`docs/SECURITY-REVIEW-MVP0-2026-06-23.md` §B2). Practical risk is low (all app
writes go through the org-guarded `fn_post_movement`).
- **Recommendation:** **defer** — low value now; revisit with PostgREST-level debugging if/when
  ad-hoc client inventory writes become a real surface. Decide which roles may write stock
  (owner/manager/storekeeper for manual edits; any execute-role via the RPC).

### 7. D1 — FORCE ROW LEVEL SECURITY
- **Recommendation: skip.** On Supabase the table owner (`postgres`) is `bypassrls`, so FORCE RLS
  is a near-no-op; the definer functions already carry explicit org guards. Adding it would be a
  verified no-op migration. (Reconsider only if table ownership changes.)

### 8. Product/GTM calls (from the tracker, for the pilot)
- **Pricing:** per-farm EGP anchors + setup fee (never per-seat) — needs your number.
- **Sector labels:** confirm 4-vs-5 sectors + the enterprise/crop list.
- **Agronomy:** engage a local agronomist to sign off Academy NPK/pesticide content before it's
  shown as authoritative (liability).
- **Pilot:** schedule the **5 design-partner farm interviews**; track the ≥5-of-7 H1–H4 gates.

## Recommended sequence to "finish"
1. **You:** decide #1 (infra owner) → I pre-write all deploy config. (#2 resolved — email/password only.)
2. **You:** run Stage 0 remediation (#3) using my runbook (gates real data).
3. **Me:** ship B3 *date* now; implement B3 *price* once #4 is decided.
4. **Me (on your go):** provision + deploy to the dedicated Supabase + Vercel; smoke-test.
5. **You:** run the 5 pilot interviews (#8); we track gates and iterate.

Building the **full MVP (tracker Stages 1–11)** is a separate, larger effort — each stage needs its
own spec + plan + your approval, and **Stage 0 must close first** (PROJECT RULES). Not started here.

> **Bottom line:** the agent-buildable MVP-0 work is complete and verified. Finishing the *product*
> now depends on the decisions above — most are yours (infra/billing/legacy/product), a couple I can
> execute once you choose. Give me calls on #1/#2/#4 and I'll keep moving.
