# SPEC-0015 — Product Knowledge System (hub + tiered catalogs)

*Status: **DRAFT for Owner review** — design + spec only; **no app code, migrations, routes, AI features,
analytics instrumentation, generated-docs system, or deploys**. Companion to
[`SPEC-0014`](SPEC-0014-knowledge-living-documentation.md) (the *in-app* help/Why surface). This spec defines the
**company-wide knowledge system**: [`PRODUCT-MASTER-FILE.md`](PRODUCT-MASTER-FILE.md) is the **hub/index**, and a
small set of **code-anchored catalogs** hang off it. It designs all six phases as an architecture but **scopes
only Tier 1 (Phase 1) for build** — the principle being "a Knowledge Operating System that grows with the
product, each layer justified by a concrete consumer," not 35 files no one maintains.*

Owner: Amr Ebeid. Risk level: **Low** (documentation/spec only; no access/money/AI/data surface). Last updated:
2026-06-27.

---

## 0. Basis & principle
- **Reconcile-first:** built on [`RECONCILE-001`](RECONCILE-001-main-ground-truth-2026-06-27.md) + the master
  file. Catalogs must cite `main` evidence; nothing documents a feature not on `main` except as explicitly
  *Planned*.
- **Anti-overbuild:** ~35 catalog ideas were proposed; most either already exist (Storybook, master-file §9/§10),
  are already specced (SPEC-0014 `pageMeta`), or describe unbuilt features. This spec captures them all in a
  **phased registry** and builds only the foundation. **Build a layer only when it has a concrete consumer.**
- **Two cautions enforced:** (1) no documenting vaporware (Notification/Automation/Import/Pricing/Tenant-lifecycle
  describe unbuilt SaaS → Planned only); (2) Product Metrics are *definable as targets* but **not measurable** —
  no analytics is instrumented (separate track).

## 1. Requirements (the what/why)

### Problem
Product knowledge is spread across modules and prose. For a 10-year product we need a single, navigable,
**code-anchored** knowledge system that engineers, QA, support, the Owner, and AI agents can all rely on — without
it rotting into a stale help centre.

### Stories
- As **any contributor or AI agent**, I want to follow a stable ID (a feature, a business rule, a term) to its
  evidence (route/migration/RPC/test) and its related artifacts, so impact analysis and reasoning are reliable.
- As the **Owner**, I want one hub that indexes the whole knowledge system and shows each artifact's **maturity
  level**, so I can see what is trustworthy vs skeleton.
- As an **AI assistant (future, Stage 11)**, I want a machine-readable rule + term catalog so I can answer
  "explain BR-003" or "what is تغطية" without reading code.

### Acceptance criteria (Tier 1)
- [ ] **Feature Registry** exists: each `FEAT-NNN` has title, status (Built/Partial/Planned/Draft-PR), and links
      to **routes / migrations / components / tests / spec**. Every master-file module maps to ≥1 FEAT-ID.
- [ ] **Business Rules Catalog** exists: each `BR-NNN` has the rule statement, reason, **enforced-by** (RPC /
      trigger / RLS / policy / app), **test** reference, and `FEAT-NNN`. Every rule is traceable to `main`
      evidence or marked policy-only.
- [ ] **Domain Dictionary** exists: each term has definition, Arabic↔English mapping (where verified; else
      **Needs verification**), source table/label, relationships, and "common confusion." Merges the proposed
      Glossary-for-AI + Localization terms.
- [ ] All three are **code-anchored** (links resolve to real files/objects) and registered in the master-file
      **Knowledge System Index**.
- [ ] Each catalog entry carries a **maturity level** (L0–L5, §3) and is covered by the **Documentation Health
      Score** (SPEC-0014 / CLAUDE.md DoD).

### Non-goals (deferred — NOT Tier 1)
Notification Catalog, Automation Catalog, Import/Export Guide, Product Metrics/KPIs, Training/Customer-Success
docs, AI Knowledge Graph, RPC/Event/Report catalogs, Tenant Lifecycle, Pricing & Packaging Bible, Retention/DR,
Support/Troubleshooting, Release Process, Demo Script, Implementation Methodology. (All recorded in §4 with their
phase + dependency.) No code, migrations, routes, AI, analytics, generated-docs engine, or deploys.

## 2. Traceability model (the spine)
Every artifact gets a **stable ID**; documents reference IDs, not free-form text. ID schemes:

| Prefix | Artifact | Source of truth |
|---|---|---|
| `FEAT-NNN` | Feature | Feature Registry (Tier 1) |
| `BR-NNN` | Business rule | Business Rules Catalog (Tier 1) |
| `TERM` | Domain term | Domain Dictionary (Tier 1) |
| `SPEC-NNNN` | Workstream spec | `docs/SPEC-*` (exists) |
| `PAGE-NNN` | App page | SPEC-0014 `pageMeta` (planned) |
| `RPC-NNN` | Server function | RPC Catalog (Phase 2; seed in master §10) |
| `TBL-NNN` | Table | Data Dictionary (master §9 / Phase 2) |
| `TEST-NNN` | Test | pgTAP/Vitest/Playwright (exists) |
| `REL-x.y.z` | Release | Release Notes (Phase 3) |

Example chain: `FEAT-009` (Purchase requests) → `BR-001` (creator≠approver) → enforced-by `pr_guard_approval`
(`0017`/`0023`) → `TEST 21/26` → `PAGE` `/purchase-requests/[prId]` → `SPEC-0006`. Tier 1 establishes FEAT/BR/
TERM; the other prefixes are referenced as they come online (no premature catalogs).

## 3. Documentation Maturity Levels (applied per artifact)
| Level | Meaning |
|---|---|
| L0 | Not documented |
| L1 | Skeleton (title + purpose) |
| L2 | Human-written content |
| L3 | Verified against implementation |
| L4 | Automatically validated against code (CI) |
| L5 | Generated from code, continuously synced |

**Targets:** technical docs → **L4–L5**; business docs → **L2–L3**. The Documentation Health Score (SPEC-0014)
records each artifact's level; Tier 1 ships at **L3** (human-written + verified against `main`), with L4
(CI-validated link/coverage checks) as a follow-on.

## 4. The six-phase architecture (designed now; built when a consumer exists)
| Phase | Layer | Contents | Build trigger |
|---|---|---|---|
| **1 — Foundation** | **Tier 1 (this spec)** | Master-file hub, RECONCILE-001, **Feature Registry, Business Rules Catalog, Domain Dictionary**, Health Score, `pageMeta` (SPEC-0014) | **now** |
| 2 — Engineering | **BUILT 2026-06-27 (under `/goal`):** [RPC Catalog](RPC-CATALOG.md), [Data Dictionary](DATA-DICTIONARY.md), [Permissions Matrix](PERMISSIONS-MATRIX.md), [Event Catalog](EVENT-CATALOG.md), [Report Catalog](REPORT-CATALOG.md) — all L3, code-anchored. Component catalog = **Storybook** (linked, not duplicated). | ✅ done |
| 3 — Operations | Implementation Guide, Tenant Lifecycle, Import/Export, Support Runbooks, Troubleshooting, Release Process/Notes, Upgrade Guides | when onboarding real customers (depends SPEC-0013) |
| 4 — Customer Success | Training Academy, Learning Paths, Playbooks, Video, Certification, FAQ, Best Practices | when active customers exist |
| 5 — Intelligence | Knowledge Graph, AI Knowledge Base, Rule-Explanation ("Why?"), Decision/Recommendation/Automation catalogs | generated from Phases 1–2; **AI behind Stage 11** |
| 6 — Executive | Product/Commercial/Adoption/Success Metrics, KPI defs, Pricing Bible, GTM, Competitive | evolves with the business; needs analytics (not instrumented) |

De-dup note (do **not** rebuild): Component docs = **Storybook** (`packages/ui`); Page/Field specs = **SPEC-0014
`pageMeta`**; Data Dictionary seed = master-file **§9**; RPC seed = master-file **§10**; Risk register seed =
PROJECT-TRACKER "Known risks" + per-spec risks; Known Limitations = master-file **§14/§15**.

## 5. Design (the how — Tier 1)
- **Hub:** add a short **Knowledge System Index** to the master file (links only; body not expanded).
- **Three new docs**, each code-anchored and carrying a maturity level:
  - `docs/FEATURE-REGISTRY.md` — `FEAT-NNN` table → routes/migrations/components/tests/spec/status.
  - `docs/BUSINESS-RULES-CATALOG.md` — `BR-NNN` → statement/reason/enforced-by/test/FEAT.
  - `docs/DOMAIN-DICTIONARY.md` — TERM → definition/AR↔EN/source/relationships/confusion.
- **Seed content (illustrative, to be completed at build):** FEAT-001 multi-tenant (`0001`/`0085`/`fn_set_active_org`);
  FEAT-007 stock-coverage (`0009`/`fn_stock_coverage`/`/inventory/[itemId]/coverage`); BR-001 PR creator≠approver
  (`pr_guard_approval` `0017`/`0023`, TEST 21/26, FEAT-009); BR-003 stock never negative (`fn_post_movement`
  floor `0031`/`0033`, FEAT-006); TERM "تغطية / coverage" (≠ insurance; source `fn_stock_coverage`).
- **No app/schema/AI change.** Catalogs are markdown that *reference* code; they do not modify it.

## 6. Tasks (small, reviewable slices)
*All Tier-1 tasks **built 2026-06-27** under the Owner `/goal` authorization ("go ahead, don't stop"), via three
read-only Explore agents (business-rule extraction, Arabic-term verification, feature→evidence map).*
- [x] **T0 — Hub index** — **DONE.** `PRODUCT-MASTER-FILE.md` §0 Knowledge System Index added (hub; body not
      expanded).
- [x] **T1.1 — Feature Registry** — **DONE.** [`FEATURE-REGISTRY.md`](FEATURE-REGISTRY.md): 27 `FEAT-NNN` mapped to
      routes/migrations/RPCs/components/tests/spec + status. L3.
- [x] **T1.2 — Business Rules Catalog** — **DONE.** [`BUSINESS-RULES-CATALOG.md`](BUSINESS-RULES-CATALOG.md): ~50
      `BR-NNN` (from ~68 extracted constraints) grouped by category, each → enforcing object + migration + test +
      FEAT. Powers the rule-based "Why?" (SPEC-0014). L3.
- [x] **T1.3 — Domain Dictionary** — **DONE.** [`DOMAIN-DICTIONARY.md`](DOMAIN-DICTIONARY.md): ~40 terms with
      verified Arabic (sector=القطاع, hawsha=الحوشة, line=الخط, palm=النخلة, all subtypes/statuses/movement types)
      or NV where no UI label exists; source, relationships, common confusion. L3.

## Risks & mitigations
- **Documentation swamp / drift** → Tier 1 only; everything else phase-gated by a concrete consumer; catalogs
  code-anchored + Health-Score-tracked; maturity levels make staleness visible.
- **Vaporware documentation** → Phases 3/6 items (tenant lifecycle, pricing, metrics) are *Planned*, never
  presented as current; reconcile-first.
- **Duplication** → explicit de-dup map (§4) — link Storybook / `pageMeta` / master §9/§10, never re-author.
- **ID churn** → IDs are **stable and append-only**; never renumber a retired feature/rule, mark it deprecated.
- **Premature automation** → L4/L5 (CI-validated / generated) is a later step; Tier 1 ships L3 (human + verified).

## Decisions log
- 2026-06-27 — Spec created from the Owner's "Knowledge Operating System" direction. **Owner authorization:
  "do both, keep it tight" → create SPEC-0015 + add the master-file Knowledge System Index; Tier 1 = Feature
  Registry + Business Rules Catalog + Domain Dictionary only; defer Notification/Automation/Import-Export/
  Metrics/Training/Customer-Success/AI-Knowledge-Graph; no app code/migrations/routes/AI/analytics/generated-docs/
  deploys.** Adopted the six-phase architecture, the FEAT/BR/TERM traceability model, and L0–L5 maturity levels.

## Open Owner decisions (carry into the tracker)
- [ ] **Ratify SPEC-0015 Tier 1** to authorize building the three catalogs (T1.1–T1.3). Currently the hub index +
      this spec are in scope; the catalogs themselves are scoped-and-ready but not yet built.
- [ ] **Maturity targets** — confirm L4–L5 (CI/generated) is the long-term goal for technical catalogs (vs
      staying L3 human-verified).
- [ ] **Sequence vs SPEC-0013** — Tier 1 is low-risk/complementary; run alongside or after the commercial layer.
