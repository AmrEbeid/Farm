# Farm OS — Product Master Plan & Detailed Execution Plan
### نظام تشغيل المزارع — الخطة الرئيسية وخطة التنفيذ
*Governed under **The AI Project Operating System v3**. Owner: Amr Ebeid. Generated 2026-06-18.*
`[V]` verified · `[I]` inferred/recommended.

> ⚠️ **Status note (2026-07-02):** §4's per-stage status and §6's risk register are **historical** — the live
> stage-status table, next actions, and decision queue now live in [`STATUS.md`](STATUS.md) (the only doc that
> claims currency), refreshed from the 360° review ([`REVIEW-360-2026-07-01.md`](REVIEW-360-2026-07-01.md)).
> Risk-register deltas recorded there include: single-owner bus factor; AI-agent velocity vs review capacity;
> prod migration-ledger fragility; no staging environment / monitoring / backup-verify / rollback drill;
> `authorize()`/`audit_read` re-emit structural debt. The governance model (§2–3, §5) and the market-led
> control (§8.8) remain in force.

> **How to read this:** §1–2 = the product and how we'll run the build safely. §3 = governance & roles. **§4 = the detailed risk-tiered staged plan (the core).** §5 = verification/evidence. §6 = risk register. §7 = ready-to-paste execution prompts. §8 = **playbook-lens review & enhancements of the current project**. §9 = standards + rhythm + next actions. Companion docs: [README](README.md) · [01 Research](01-research-and-strategy.md) · [02 PRD](02-prd.md) · [03 Architecture](03-architecture-and-data-model.md) · [04 UX](04-ux-and-design-system.md) · [05 GTM](05-gtm-pricing.md) · operating files [CLAUDE.md](CLAUDE.md) / [TRACKER](PROJECT-TRACKER.md) / [SESSION-BRIEF](SESSION-BRIEF.md) / [SPEC-0001](SPEC-0001-stock-coverage-engine.md).

---

## 1. Product master plan (the what)

**Definition.** An Arabic-first, multi-tenant **Farm Operating System** that connects a forward operations plan to live **stock-coverage intelligence**, **budget-gated approvals**, **people/responsibility**, and a **tree-level activity history** — for medium/large date-palm and fruit farms in Egypt/MENA. Ebeid Farm (5 sectors, 28 hawshat, 4,380 Barhi + 299 males, mixed crops, 7 years of records) is the design partner and reference tenant.

**The wedge (confirmed by research, doc 01).** No competitor combines *stock-coverage-vs-plan run-out forecasting + Arabic/RTL + tree-level records + budget-gated approvals*. Conservis proves farms pay for plan+budget+inventory (English/row-crop); FarmERP & Zr3i prove Arabic/date-palm demand (no planning-intelligence core). We sit in the intersection; Arabic + tree-level + approvals are the moat.

**9 pillars + AI:** Planning · **Stock Coverage** · Budget & Approvals · People & Responsibility · Palm/Tree Mapping · Activity Files · Weather Intelligence · Care Academy · Accounting & Reports · + عبدالجليل (permission-aware AI). **Stack:** Next.js + Supabase (Postgres + PostGIS + RLS) + Vercel. **Pricing:** per-farm in EGP, free entry tier, paid onboarding (doc 05). Full requirements in the PRD (doc 02); schema + engines in doc 03.

**MVP = the loop that proves the wedge:** Plan → stock-coverage check → budget gate → purchase approval → execute → farm-file update → planned-vs-actual report.

---

## 2. Why we run the build through the OS (the how)

This is serious work — multi-tenant isolation, money/voucher logic, payroll PII, real farm financials, an AI agent over private data, and production deploys. The playbook's three ideas govern it:
1. **Controls must be enforced, not requested.** RLS, permission modes, approval gates, secret scanning — not sentences in a prompt. (The already-found exposed secret is exactly this lesson.)
2. **The tool that produces the work cannot grade it.** Every High/Critical change gets a fresh-context independent reviewer + evidence before the Owner gates it.
3. **Match control intensity to risk.** UI/docs move fast; RLS, accounting, payroll, the AI, and deploys earn review + manual verification + rollback.

**Operating loop (every slice):** Owner sets goal → planning tool plans + writes the execution prompt + names the enforced control → execution tool works in scope + reports with evidence → independent reviewer (fresh context) checks → Owner gates (accept/correct/reject) → tracker/spec/session updated → next safe slice. **Never advance stages automatically.**

---

## 3. Governance & separation of duties

| Role | Who / what | Boundary |
|---|---|---|
| **Owner** | Amr Ebeid | Defines goal & business rules; **sole approver** of money/irreversible/deploy/migration/access changes; gates every stage |
| **Planning tool** | Claude (planning session) / this OS | Thinks, challenges, plans, writes execution prompts + enforcement notes, reviews reports. **Does not execute.** |
| **Execution tool** | Claude Code (scoped session) | Inspects, makes the one approved change, runs checks, reports + stops. **No stage-jumping, no irreversible actions.** |
| **Independent reviewer** | A **separate** session/model with fresh context | Reviews High/Critical changes (access, money, PII, the engine, the AI, deploys). **Never the author.** |
| **Managed apply layer** | Owner-gated, server-enforced | Deploys, DB migrations, real-data migration, any external send — narrow apply prompt + server-side limits + rollback. |

**Separation of duties is absolute:** the actor that makes a change (human or AI) never approves it. Every change links to a record and a named approver (the audit_log).

---

## 4. Detailed risk-tiered staged plan (the core)

Each stage scored on **impact × probability × reversibility → highest tier wins** (an irreversible action is ≥ High). Stages are independently reviewable. **Do not start a stage before its predecessor's gate is closed.**

### Stage 0 — Security remediation & data cleanup · Type: Execution + External Apply · **Risk: Critical/High**
- **Why this tier:** *impact* — a live exposed Gmail+password and an anon key + project-id in a public repo is a real breach surface; *probability* — already public; *reversibility* — key rotation is reversible, but exposure already happened (treat as incident).
- **Scope (allowed):** rotate the Supabase anon key; purge `.env.local` + secret from git history (BFG/`git filter-repo`); scrub the Gmail/password from the accounting sheet copy; reconcile palm count to the Nov-2025 registry; add the enterprise/crop dimension; separate `مسحوبات` from operating expenses; fix `العام الحقلي` typos. **Forbidden:** building any new feature; touching production data of any real system beyond the named cleanup; committing any secret.
- **Acceptance:** secret absent from history (verified); key rotated and old key invalid; one agreed canonical count; expenses re-taggable by crop with drawings separated; **secret-scan passes**.
- **Enforcement:** secret-scanning gate on commit; key rotation done in the Supabase console by the Owner (apply layer); history rewrite reviewed before force-push.
- **Evidence:** scan output; confirmation old key rejects; before/after count reconciliation; sample re-tagged ledger. **Gate:** Owner + a reviewer who is not the implementer.

### Stage 1 — SaaS foundation (orgs / RLS / roles / audit) · Type: Execution · **Risk: High**
- **Why:** RLS bugs = cross-tenant data leak (high impact, irreversible exposure). 
- **Scope:** `organization`, `organization_member`, RBAC (`role`/`role_permission`/`authorize()`), `audit_log` triggers, membership-table RLS helper `auth.user_org_ids()`, settings, farm-setup wizard. **Forbidden:** any real data; any feature table without RLS; JWT-only tenancy (breaks consultants).
- **Acceptance:** two orgs cannot see each other's rows (proven by test); consultant in two orgs gets correct per-org role; removing a member revokes instantly; audit_log immutable.
- **Enforcement:** RLS deny-by-default on every table; `org_id` indexed; `TO authenticated`; CI test that cross-org SELECT returns zero rows.
- **Evidence:** the cross-tenant isolation test output; RLS policy list; audit trigger demo. **Independent review REQUIRED.** **Manual verification REQUIRED.**

### Stage 2 — Farm structure + palm registry import · Type: Execution · **Risk: Medium**
- **Scope:** farms→sectors→hawshat→lines→palms, codes, grid view, palm/sector/farm files; import the **real Nov-2025 registry** into the Ebeid reference tenant. **Forbidden:** inventing palms; importing financials/PII yet.
- **Acceptance:** Σ(hawsha palms) == 4,380; every palm ∈ a hawsha; open a palm file; events roll up. **Checks:** import reconciliation (row counts vs registry totals); UTF-8 Arabic integrity. **Evidence:** reconciliation report. **Gate:** Owner.

### Stage 3 — Activity / event model + operations · Type: Execution · **Risk: Medium**
- **Scope:** `farm_event` + `event_assets` + `quantities` (asset+event+quantity spine), operation records, notes, attachments, follow-ups, timeline. **Acceptance:** any operation recorded → linked to location → appears in palm/hawsha/sector/farm files; `pending/done` status works. **Evidence:** end-to-end record + rollup query. **Gate:** Owner.

### Stage 4 — Planning workspace · Type: Execution · **Risk: Low/Medium**
- **Scope:** weekly/monthly plans, plan operations/targets, operation templates, planned-vs-actual, approval status. **Acceptance:** create a plan, assign people, see planned cost & materials. **Gate:** Owner (review recommended, not required).

### Stage 5 — Inventory + **Stock-Coverage engine** · Type: Execution · **Risk: Medium** · **SPEC-0001**
- **Why Medium (not Low):** wrong recommendations have business impact, but no money moves and it's reversible. 
- **Scope:** items/bin/movements, reservations, reorder point, **PAB simulation, coverage, shortage alarm, purchase recommendation**. **Define the unit checks FIRST** (worked example + edge cases). **Forbidden:** weakening a test to pass; actually placing orders.
- **Acceptance:** SPEC-0001 criteria; reconciliation Σ(movements)==bin.on_hand. **Evidence:** test output (the worked example reproduces). **Independent review of the math REQUIRED.** **Gate:** Owner.

### Stage 6 — Budget + approvals + purchase requests · Type: Execution · **Risk: High**
- **Why:** approval/entitlement-style logic; budget-gating controls spend.
- **Scope:** budgets/lines, budget check (`available=approved−actual−committed`), purchase requests, approval chain, vouchers, WhatsApp approval link. **Acceptance:** plan checks budget; PR requires Owner approval when it breaches a category; approve/reject writes immutable audit; idempotent (no double-apply). **Enforcement:** approval gate enforced server-side, not just UI; only Owner role can approve (RLS). **Independent review REQUIRED.** **Manual verification REQUIRED.**

### Stage 7 — Accounting (expenses / sales / vouchers) · Type: Execution · **Risk: High**
- **Why:** financial integrity; cost allocation feeds owner decisions.
- **Scope:** expenses/sales/vouchers, cost allocation to farm/sector/crop/operation/season, P&L. **Acceptance:** expenses/sales link correctly; P&L by sector reconciles to a known closed season (dual-run vs the Excel totals); drawings excluded from operating P&L. **Checks:** reconciliation/total checks (the finance oracle). **Independent review REQUIRED.**
- **Current SPEC-0018 note (2026-06-29):** draft backend PR #438 now enforces owner/accountant finance reads,
  RPC-only custody account writes, audit-log finance gating, and the `expenses.kind` drawings split for custody/payment
  request math. It also rejects rerouting custody-paid expenses after a cash out-movement unless an explicit reversal is
  posted first. It remains **held** until independent money/RLS/audit review and a separate pre-migration review; the
  frontend PR #441 has been patched to use `fn_save_custody_account` and withhold broad farm-manager custody reads,
  but it remains held behind #438's migrate-first path.

### Stage 8 — People & labor / payroll · Type: Execution · **Risk: High**
- **Why:** PII + regulated payroll data.
- **Scope:** people directory, responsibility assignments (many-to-many + auto-routing), teams, labor logs, basic payroll. **Forbidden:** putting PII into any third-party model; tax-engine scope (later). **Enforcement:** PII fields RLS-scoped; payroll visible only to owner/accountant. **Independent review of access REQUIRED.**

### Stage 9 — Weather integration · Type: Execution · **Risk: Medium**
- **Why:** external API = untrusted content + an API key (injection + secret surface).
- **Scope:** forecast ingest, weather rules, operation gating (spray/pollinate/harvest/heat). **Enforcement:** treat API responses as untrusted; key server-side only; the ingest agent has no outbound-send capability (avoid trifecta). **Gate:** Owner.

### Stage 10 — Care Academy content · Type: Documentation · **Risk: Medium/High**
- **Why:** agronomy/pesticide advice carries liability.
- **Scope:** care-by-age, disease library (RPW-first), checklists, weather rules — **as editable templates**. **Forbidden:** presenting NPK/irrigation/pesticide numbers as prescriptions; copying unlicensed third-party agronomy text. **Acceptance:** content seeded; **a named local agronomist signs off numbers + current Egyptian pesticide registrations** (evidence = the sign-off). **Gate:** Owner + agronomist.

### Stage 11 — AI assistant عبدالجليل · Type: Execution · **Risk: High**
- **Why:** lethal-trifecta risk (private data + untrusted input + outbound).
- **Scope:** server-side `/api/chat`, **read-only RLS-scoped RPC tools only**, "no invented numbers" guardrail, permission-aware answers. **Forbidden:** raw table access; service-role key; mass outbound; writing data; ingesting untrusted uploads in the same context that can send. **Acceptance:** a supervisor can't get financials; the AI cites the figure's source; refuses when data is missing. **Independent review (security) REQUIRED.**

### Stage M — Ebeid real-data migration (reference tenant) · Type: External Apply · **Risk: High**
- **Scope:** migrate real registry/offshoots/7-yr accounting into the reference tenant. **Forbidden:** before a privacy review; before drawings split + typo cleanup. **Enforcement:** apply layer; dual-run one closed season vs Excel totals before cutover. **Evidence:** reconciliation. **Owner approval (separate approver) REQUIRED.**

### Stage P — Production deploy · Type: External Apply · **Risk: Critical**
- **Scope:** deploy to Vercel after a risky change. **Enforcement (server-side, not prompt):** staged/preview → prod promotion gate; tested rollback; monitoring + a kill-switch; backups for anything destructive. **Evidence:** post-deploy verification that only the approved change shipped; no unrelated movement. **Written Owner approval from a separate approver REQUIRED.** Never automatic.

---

## 5. Verification & evidence (the oracle)

- **Checks as the oracle:** software → tests; finance → reconciliation/total checks; agronomy → expert-signed checklist; data → validation rules. Define the check, confirm it fails before the work, make the work pass it — **never weaken the check**. Forbid the tool from editing the check.
- **Three layers must all pass:** format/structure · correctness (numbers/logic/facts) · behaviour/contract (end-to-end vs the real requirement).
- **Small slices:** cap each slice so a reviewer can read it closely; large AI changesets hide errors. Split in the plan, don't merge.
- **Evidence not assertions:** attach the actual check output / action result / screenshot. No evidence, no gate.

**Evidence required by tier** (from review-and-gate): *Low* = change record + checks + scope confirmation. *Medium* = full small-slice record + format/correctness/behaviour checks + acceptance status (review recommended). *High* = + reviewer findings addressed + security/sensitive review + manual verification + rollback path. *Critical* = + written approval from a separate approver + apply-layer evidence (exact action only) + no-unrelated-changes confirmation + staged rollout + post-apply verification.

---

## 6. Risk register

| # | Risk | Tier | Mitigation / enforced control | Stage | Status |
|---|---|---|---|---|---|
| 1 | Exposed secret (Gmail+password; anon key+project id) | 🔴 Critical | rotate key, purge history, secret scanning | 0 | OPEN |
| 2 | Cross-tenant data leak (weak RLS) | High | RLS deny-by-default + cross-org test + independent review | 1 | Planned |
| 3 | AI lethal trifecta (data+untrusted+outbound) | High | read-only RPCs, no mass send, untrusted-input isolation | 11 | Planned |
| 4 | Agronomy/pesticide liability | Med/High | templates + agronomist + registration sign-off | 10 | Planned |
| 5 | Real financial/PII into third-party model | High | privacy review before migration; PII RLS-scoped | M, 8 | Planned |
| 6 | Money/voucher logic bug (double-apply/stale) | High | idempotent, verify source event, reject stale; review + manual verify | 6 | Planned |
| 7 | Financial inaccuracy (P&L wrong) | High | reconciliation oracle; dual-run vs Excel | 7 | Planned |
| 8 | Prompt injection via uploaded docs/weather/web | High | treat all ingested content as untrusted; sandbox; no co-located outbound | 9, 11 | Planned |
| 9 | Fake/hallucinated dependency, source, or figure | Med | verify-before-trust; pin versions; review new deps | all | Standing |
| 10 | Onboarding friction → churn (industry #1) | Med (biz) | white-glove Arabic onboarding (doc 05) | GTM | Standing |
| 11 | Over-scope / drift across sessions | Med | SESSION-BRIEF + reconcile-first + small slices + no auto-advance | all | Standing |
| 12 | Production deploy breaks live tenant | 🔴 Critical | staged rollout, rollback, kill-switch, post-apply evidence | P | Planned |

---

## 7. Ready-to-paste execution prompts (first stages)

### 7.1 Stage 0 — Security remediation (give to the execution tool, in approved-scope-only mode)
```
Task name:       Stage 0 — Security remediation & data cleanup
Task type:       Execution (+ External Apply for key rotation)
Risk level:      Critical / High
Context:         A public repo and the accounting sheet contain a live Gmail+password,
                 a Supabase anon key, and a Vercel project id. Counts disagree across
                 docs; owner drawings are mixed into operating expenses.
Goal:            Remove all exposed secrets from history, rotate the key, and produce a
                 cleaned, reconciled dataset — nothing else.
Approved scope:  purge .env.local + secret from git history; scrub Gmail/password from a
                 working copy of the sheet; reconcile palm counts to the Nov-2025 registry;
                 add enterprise/crop dimension; separate مسحوبات from operating expenses;
                 fix العام الحقلي typos.
Allowed items:   the repo history, a working copy of the accounting workbook, the registry.
Forbidden items: any new feature; any production system beyond the named cleanup;
                 committing ANY secret; touching live tenant data.
Hard stops (also enforced via gates): key rotation happens in the Supabase console by the
                 Owner (apply layer); no force-push until the history rewrite is reviewed;
                 secret-scanning must pass before any commit.
Steps:           1 Inspect what is exposed  2 Plan the purge + reconciliation  3 Do it on
                 working copies  4 Run secret scan + count reconciliation  5 Report  6 Stop
Checks:          secret-scan output; old-key-rejected confirmation; Σ(hawsha)=4,380 check;
                 drawings-excluded P&L sample.
Report format:   What was exposed / What was purged / Key rotation status / Reconciliation
                 (before→after) / Scan output / Remaining risks / Confirmation: no secret committed.
Stop point:      Do not start Stage 1. Wait for the Owner gate + independent review.
```

### 7.2 Stage 1 — SaaS foundation (after Stage 0 gate closes)
```
Task name:       Stage 1 — SaaS foundation (orgs / RLS / roles / audit)
Task type:       Execution        Risk level: High
Context:         Multi-tenant base for the Farm OS. Tenant isolation must be enforced in
                 Postgres RLS, not the app layer. Consultants belong to multiple orgs.
Goal:            Stand up organizations + membership + RBAC + audit + membership-table RLS,
                 with a proven cross-tenant isolation test. Nothing else.
Allowed items:   organization, organization_member, role/role_permission, authorize(),
                 audit_log + triggers, auth.user_org_ids() helper, settings, farm-setup wizard.
Forbidden items: any real data; any table without RLS; JWT-only tenancy; feature modules.
Hard stops (also enforced): RLS deny-by-default on every table; org_id indexed; TO authenticated;
                 service-role key server-side only.
Steps:           1 Inspect  2 Define the failing cross-tenant test FIRST  3 Build  4 Make the
                 test pass without weakening it  5 Full change record + evidence  6 Report + stop
Checks:          cross-org SELECT returns 0 rows; consultant multi-org role resolves; member
                 removal revokes instantly; audit_log has no update/delete policy.
Report format:   Items changed / Change record / Test output / RLS policy list / Risks / Stop.
Stop point:      Stop after reporting. REQUIRES independent review + manual verification before the gate.
```
*(Stages 2–11 follow the same structure; generate each one with the `plan-and-prompt` skill when its predecessor's gate closes — do not pre-write them all, so they reflect the then-current state.)*

---

## 8. Playbook-lens review & enhancements (the "review and enhance" ask)

Running the existing project (docs 01–05 + the two prototypes + the real-data work) through the OS surfaced these — applied as enhancements, now baked into the plan and operating files:

| # | Finding (current state) | Enhancement (now in the plan) |
|---|---|---|
| 1 | **No governance layer** — no named Owner/approver, no rules/tracker/brief; work spanned many sessions with drift risk (the palm-count discrepancy was a live stale-data symptom). | Scaffolded `CLAUDE.md`, TRACKER, SESSION-BRIEF, SPEC-0001; Owner = Amr; **reconcile-first** + **no-auto-advance** rules. ✅ done |
| 2 | **No separation of duties** — the same model produced research, docs, schema, and prototypes and implicitly graded them. | High/Critical stages now **require a fresh-context independent reviewer** who is not the author (Stages 0,1,5,6,7,8,11,M,P). |
| 3 | **Controls described, not enforced** — docs *describe* RLS; the exposed secret proves "requested ≠ enforced." | Every hard stop now names an **enforced control** (RLS deny-by-default, secret scanning, server-side approval gate, apply-layer for deploy/migration). §4 + CLAUDE.md. |
| 4 | **AI assistant risked the lethal trifecta** (reads farm data, could ingest uploaded docs, could send WhatsApp/reports). | Stage 11 mandates **read-only RLS-scoped RPCs only, no service-role, no mass outbound, untrusted-upload isolation** — the three capabilities are never co-located. |
| 5 | **Prototypes/engine are unverified mocks** — no checks. | Verification stack added; **SPEC-0001 defines the stock-coverage unit checks FIRST** (worked example + edge cases) before the engine is built; finance uses reconciliation oracle. |
| 6 | **Agronomy numbers presented as if authoritative** (NPK, irrigation, pesticide doses) — liability + hallucination risk. | Rule #4 + Stage 10: numbers are **editable templates requiring a local-agronomist + Egyptian-pesticide-registration sign-off** (evidence-gated). |
| 7 | **Real Ebeid financials + staff PII at risk** of entering a third-party model casually. | Stage M (migration) is **High-risk, privacy-review-gated**; PII RLS-scoped (Stage 8); CLAUDE.md hard stop on PII→third-party model. |
| 8 | **Research could flow straight into build** (market-led drift). | Market-led control: each research lesson must become **decision → spec → task → small change** (classified MVP-now/next/future/reject) before it's built. |
| 9 | **No risk tiering on the roadmap** — phases were sequenced but not risk-graded. | §4 assigns **impact×probability×reversibility tiers**, and the evidence/review/rollback each tier earns. |
| 10 | **No standards anchor** for a defensible posture with future partners/auditors. | §9 anchors to **OWASP LLM/Agentic Top 10 + NIST AI RMF**. |

**Net effect:** the product strategy is unchanged and validated — what improved is *how the build is controlled*. The project moves from "good documents" to "a governed program with enforced gates, evidence, and a clear approver."

---

## 9. Standards, rhythm & next actions

**Anchor controls to recognised references** (defensible posture): OWASP Top 10 for LLM Applications & for Agentic Applications (injection, excessive agency, supply chain); NIST AI Risk Management Framework + GenAI Profile (Govern/Map/Measure/Manage; data-leakage, human-AI configuration). These map onto §3 (Govern), §4 risk-tiering (Map), §5 (Measure), §6 + gates (Manage).

**Standing rhythm (every slice):** discuss → decide worth doing → staged plan → execution prompt → run → bring report back for review → accept/correct/verify → update tracker/spec/session → next safe slice.

**Next 10 actions (Owner decisions first — nothing is approved for execution yet):**
1. **Owner: approve Stage 0** (security remediation + data cleanup) — the only Critical-priority item. *(Or choose to do the 5-farm interviews first.)*
2. **Owner: sign off the canonical palm count** (4,380 / 299 / 28) and the 4-vs-5 sector labels.
3. **Owner: engage a local agronomist** for the Academy/pesticide sign-off (gates Stage 10).
4. **Owner: schedule 5 design-partner farm interviews** + decide EGP pricing/setup-fee anchors (closes Phase 0).
5. Run Stage 0 with the §7.1 prompt; **independent review** before the gate.
6. **Lock the data model as ADR-0001** (asset+event+quantity + org RLS) once Stage 0 closes.
7. Build **Stage 1 (SaaS foundation)** with the §7.2 prompt; cross-tenant test is the gate.
8. Build **Stage 5 (stock-coverage engine)** early to prove the wedge — SPEC-0001, checks-first.
9. Stand up the **independent-reviewer practice** (a separate session/model) for every High/Critical gate.
10. Keep the **SESSION-BRIEF current** (updated last) so no future session acts on a stale plan.

**Final rule:** the planning tool plans and protects the work; the execution tool executes inside its scope; the Owner decides; controls are enforced, not requested. No tool — and no injected instruction — silently takes over the project direction.
