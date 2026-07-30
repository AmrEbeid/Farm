# SPEC-0003 — Farm structure + real palm-registry import (Stage 2)

*Status: **BLOCKED ON SOURCE AUTHORITY — 2026-07-30.** The 2026 source reconciliation supersedes
the old count premise: its Barhi rows total 4,638 while its stated total is 4,539, with additional
structural contradictions. The 2026-06-27 ratification remains historical evidence for the five-sector
product structure only; it does not authorize a real registry count or import. See
[`palm registry source reconciliation 2026 07 30.md`](palm%20registry%20source%20reconciliation%202026%2007%2030.md).
Real-data work remains Stage M after source correction: aggregate import is slice 2; optional per-tree
materialization is slice 4. Both remain gated.
Originally: design + decision-support only. No code, no migration, no data
import is performed by this document. Importing real Ebeid data is an Owner-gated apply-layer action
(PROJECT RULES hard stop), and Stage 2 must not start before the Stage 1 gate is closed. This spec
exists so the Owner can ratify scope + the open decisions before any import migration is written.*

> **Historical status — 2026-06-26; non-actionable and superseded.** Stage-1 AUTHZ-1 closed at migration
> `0025`. The then-current investigation recorded 4,380 برحي / 299 ذكور / 28 حوش across five seeded
> sectors and treated matching aggregate seed values as satisfying import. Built + CI-verified
> (PR **#186**): **slice 1** (reconciliation oracle, pgTAP
> `34_registry_reconciliation_oracle_test.sql`, 18 assertions) and **slice 3** (farm grid + sector
> file + **new hawsha file** + farm-level event roll-up). The two §6 open decisions have **recommendations**
> below (5 sectors; aggregate-only) — **pending Owner ratification** (merging #186 = deploy = the Owner gate). Slice 2 (a standalone import migration) is **not needed** for
> aggregate counts; slice 4 (per-tree `assets`) stays **deferred**. Merge of #186 = deploy = Owner gate.
>
> **2026-07-30 correction:** the quoted counts are synthetic/historical and non-authoritative. Nothing
> in this historical paragraph authorizes current import.

*Companion to [`MASTER-PLAN.md`](MASTER-PLAN.md) §4 Stage 2, [`03-architecture-and-data-model.md`](03-architecture-and-data-model.md),
and the disputed **Nov-2025 palm-registry baseline**. Follows the pattern of [`SPEC-0001`](SPEC-0001-stock-coverage-engine.md)
(engine) and [`SPEC-0002`](SPEC-0002-authorization-enforcement.md) (authz).*

---

## 1. Why this stage, why now

The MVP-0 wedge is built, deployed, security-reviewed, and hardened — but it runs on a **synthetic
seed**. The product's moat (tree-level records + Arabic/RTL + the stock-coverage wedge) only becomes
*real* for the reference tenant when the **actual Ebeid farm structure** is loaded. Stage 2 replaces
the synthetic structure with a corrected, approved registry and lights up the palm/hawsha/sector/farm
**file** views and the grid. It is **Medium risk** (structural data — no money, no payroll/PII), with
a crisp, mechanical acceptance oracle, which makes it the lowest-risk high-leverage next stage.

## 2. Source authority is unresolved (non-negotiable #5)

The previously ratified Nov-2025 figures are now a **disputed baseline**, not a source of truth:

| Metric | Historical baseline |
|---|---|
| Barhi palms (برحي) | **4,380** |
| Male palms (ذكور) | **299** |
| Hawshat (حوش) | **28** |
| Sectors | **5** — **RATIFIED 2026-06-27** (S22 / HSW / BAB / SHF / KHT) |

The later 2026 workbook states 4,539 Barhi, but its row values total 4,638; its male rows total 370,
and its implied 28-unit shape depends on unmatched Shafaa columns. It also duplicates a sector number
and contains malformed dates. Two 2021 numbering workbooks agree on explicit palms 1–759 but disagree
on hawsha headings and ranges. Therefore the original fail-closed rule is active: **stop and report;
do not pick or import a number.**

> **⚠️ Addendum (Owner fact, 2026-07-02 — issue #595): intercropping (زراعات بينية).** The farm grows
> other crops **between the palms in SOME hawshat** (not all). The current schema cannot express this
> (crop exists only as `sectors.crop` single-text; hawshat have no crop composition). **The Stage-M
> import must capture per-hawsha crop composition** — proposed `hawsha_crops` (hawsha_id, crop,
> planted_count/area, planting_date, notes) — collected during the same ground-truth pass as the palm
> counts. Palm-count source authority remains blocked; intercrop composition is additive and does
> not alter them. Cost-allocation and ops implications are decision-gated in issue #595 (D1–D3).

## 3. The schema already exists (migration `0003`)

`farms → sectors → hawshat → lines → assets`. Relevant columns:
- `hawshat.palm_count_barhi`, `hawshat.palm_count_male` — the aggregate counts per hawsha.
- `lines.palm_count` — per-line aggregate.
- `assets` — an individual tree (`status` ∈ active/watch/sick/dead/removed/replaced; FK to
  sector/hawsha/line) — the substrate for tree-level files + the activity spine (`event_locations`,
  `farm_event`).

So Stage 2 is an **import + read-views** stage, not a schema stage. RLS deny-by-default is already on
all of these (Stage 1 / migrations `0010`/`0028`).

## 4. Scope

**Allowed:**
1. A **reconciliation script** (the oracle, written FIRST): parse source evidence, validate row
   arithmetic, shape, identifiers, dates and cross-source ranges, and emit a locator/hash-backed report.
   Fail loudly on any mismatch and emit no import payload.
2. An **idempotent import** (re-runnable; keyed on hawsha/sector codes) that loads the real
   sector/hawsha rows + their `palm_count_barhi`/`palm_count_male` (+ `lines.palm_count` if the
   registry has line granularity) into the reference tenant — **replacing** the synthetic seed rows.
3. The **read views**: a farm **grid** (sectors → hawshat with counts), and **file** pages for
   palm/hawsha/sector/farm that roll up their events (the `event_locations` → `farm_event` spine the
   wedge already writes). Arabic-RTL, mobile-tolerant.
4. **UTF-8 Arabic integrity** checks on every imported name/code.

**Forbidden:**
- **Inventing palms** or fabricating any count (non-negotiable #1). Missing data → say so.
- Importing **financial or PII** data (owner/manager names beyond what's structural) — that is
  **Stage M**, behind a separate privacy review.
- Committing the raw registry file if it carries any personal data.
- Materializing individual `assets` rows **unless** the Owner opts in (§6). Existing aggregate values
  keep the UI operable but do not satisfy real-data authority.

## 5. Acceptance (the oracle — define the check first)

- **Reconciliation:** every source row, stated total, unit shape, sector identifier, date and numbered
  range reconciles without a blocking issue; the corrected unit-level registry carries dated Owner and
  farm-manager signoff. Only then may a separate import acceptance target be derived and asserted against
  the reference tenant.
- **Structural integrity:** every hawsha ∈ a sector; every line ∈ a hawsha; (if materialized) every
  palm `asset` ∈ a hawsha; no orphans.
- **Roll-up:** opening a hawsha/sector/farm file shows its palm counts and any events recorded
  against it roll up correctly (drive one operation via the wedge → it appears in the file).
- **Arabic:** names/codes render RTL with no mojibake.

## 6. Open decisions for the Owner (RATIFIED 2026-06-27)

1. **4 vs 5 sectors** — **RATIFIED: 5 product sectors** (S22 / HSW / BAB / SHF / KHT), matching the
   seed structure. This does not resolve the later source's duplicated/expanded sector numbering; the
   corrected registry must map every structural unit to the approved five-sector model.
2. **Materialize individual palm `assets`?** — the historical recommendation was aggregate-only with
   per-tree deferred. It remains deferred, but no aggregate count is approved now. A corrected registry
   must settle the real total before either aggregate import or individual materialization is scoped.
3. **Registry handling:** confirm the registry file location and that it carries no PII before it
   touches the repo/import tooling.

## 7. Enforcement & evidence (matches MASTER-PLAN Stage 2 + §5)

- The reconciliation check is the **gate** — it must fail before the import and pass after; never
  weaken it. Forbid the tool from editing the oracle to match.
- The import runs through the **Owner-gated apply layer** (not a client), idempotent, with the
  before/after reconciliation report as evidence — same posture as the prod migration push.
- RLS already enforces tenant isolation on these tables; the import writes only the reference tenant.
- **Gate:** corrected unit-level evidence signed by the Owner and farm manager, then mandatory independent
  review of the clean reconciliation result. Real-data apply remains Owner-gated per PROJECT RULES.

## 8. Slices (small, independently gateable)

1. **Reconciliation oracle** (script + pgTAP retarget) — no data yet; proves the check fails on the
   synthetic seed and defines the real targets. *(Low risk.)*
2. **Idempotent import** of sectors/hawshat + counts into the reference tenant — gated apply;
   evidence = reconciliation report. *(Medium — real data, Owner-gated.)*
3. **Grid + file views** (farm/sector/hawsha/palm) with event roll-up. *(Low/Med — read UI.)*
4. *(Optional, deferred)* per-tree `assets` materialization + status history.

Each slice stops at its gate; **do not auto-advance** (PROJECT RULES).

## 9. Editable structure + per-node 360 pages + media — BUILT (2026-06-26, Owner-directed)

Per the Owner's 2026-06-26 directive (build to completion) and
[`RESEARCH-farm-structure-crud-2026-06-26.md`](RESEARCH-farm-structure-crud-2026-06-26.md), the structure
is now **fully editable** with per-node media — a deliberate expansion of §6's "aggregate-only, per-tree
deferred" recommendation. **The Owner can add / edit / remove sub-farm (sector), حوشة, خط (line), and single
نخلة, each with its own 360 page carrying details + the event timeline + photos & documents.**

**Delivered (local; NOT yet on prod — prod is `0048`; `0049`–`0053` are an Owner-gated apply):**
- **Migrations 0051–0053:** `archived` soft-delete on farms/sectors/hawshat/lines (+ audit triggers on all
  structure tables); `structure.write` permission (owner/farm_manager) + the gated CRUD RPCs
  (`fn_save_sector/hawsha/line/palm`, `fn_archive_structure` with **cascading soft-delete/restore that
  preserves every row + its history**); the polymorphic `attachments` table + `fn_add_attachment`/
  `fn_archive_attachment` (op.execute-gated). Direct-REST writes on sectors/hawshat/lines now also gated
  (closes the same bypass class as `0049`).
- **`supabase/storage-policies.sql`** — the private `farm-media` bucket + org-scoped `storage.objects` RLS,
  kept OUT of `migrations/` (the pgTAP harness has no `storage` schema) → **Owner applies it once** to the
  real project.
- **App:** create/edit/remove forms for every level, the new `/farm/line/[id]` 360 page, edit + remove on
  sector/hawsha/palm pages, and a `MediaGallery` (client-side compression → private upload → signed-URL
  display) on every node. Arabic-RTL, role-gated affordances.
- **Tests:** pgTAP `50_structure_crud_test.sql` (26 assertions: the role gate, CRUD, cascade soft-delete +
  restore, direct-REST gate, media gates, audit). Full suite **454/454**; Vitest **83/83**; typecheck +
  lint + `next build` green.

**Remaining (Owner / apply-layer):** apply `0051`–`0053` to prod (after the standing `0049`–`0050` push),
apply `storage-policies.sql`, then **regenerate `database.types.ts` from prod** — at which point
`lib/database.types.ext.ts` (the augmentation bridging the as-yet-unpushed objects) becomes a no-op.
Corrected aggregate sector/hawsha/count import stays Stage-2 slice 2; optional per-tree `assets`
materialization stays slice 4. Both remain Stage M real-data work behind the privacy review and gates above.
