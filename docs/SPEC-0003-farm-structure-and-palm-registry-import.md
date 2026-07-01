# SPEC-0003 — Farm structure + real palm-registry import (Stage 2)

*Status: **RATIFIED — Owner (Amr Ebeid), 2026-06-27 (in-session).** Scope + both §6 open decisions
ratified; **§6.1 settled → 5 sectors** (S22 / HSW / BAB / SHF / KHT, matching prod + the registry).
Real-data import beyond aggregate counts (slice 4 / Stage M) remains an Owner-gated apply-layer action.
Originally: design + decision-support only. No code, no migration, no data
import is performed by this document. Importing real Ebeid data is an Owner-gated apply-layer action
(PROJECT RULES hard stop), and Stage 2 must not start before the Stage 1 gate is closed. This spec
exists so the Owner can ratify scope + the open decisions before any import migration is written.*

> **Status update — 2026-06-26.** The Stage-1 (AUTHZ-1) gate is **closed** (migration `0025` live,
> pgTAP `26` green), so Stage 2 may proceed. Investigation found the canonical registry **structure
> is already loaded in the seed** (and prod) — 4,380 برحي / 299 ذكور / 28 حوش across **5** sectors with
> the correct per-sector distribution — so Stage 2's "import" is already satisfied for aggregate
> counts. Built + CI-verified (PR **#186**): **slice 1** (reconciliation oracle, pgTAP
> `34_registry_reconciliation_oracle_test.sql`, 18 assertions) and **slice 3** (farm grid + sector
> file + **new hawsha file** + farm-level event roll-up). The two §6 open decisions have **recommendations**
> below (5 sectors; aggregate-only) — **pending Owner ratification** (merging #186 = deploy = the Owner gate). Slice 2 (a standalone import migration) is **not needed** for
> aggregate counts; slice 4 (per-tree `assets`) stays **deferred**. Merge of #186 = deploy = Owner gate.

*Companion to [`MASTER-PLAN.md`](MASTER-PLAN.md) §4 Stage 2, [`03-architecture-and-data-model.md`](03-architecture-and-data-model.md),
and the canonical **Nov-2025 palm registry**. Follows the pattern of [`SPEC-0001`](SPEC-0001-stock-coverage-engine.md)
(engine) and [`SPEC-0002`](SPEC-0002-authorization-enforcement.md) (authz).*

---

## 1. Why this stage, why now

The MVP-0 wedge is built, deployed, security-reviewed, and hardened — but it runs on a **synthetic
seed**. The product's moat (tree-level records + Arabic/RTL + the stock-coverage wedge) only becomes
*real* for the reference tenant when the **actual Ebeid farm structure** is loaded. Stage 2 replaces
the synthetic structure with the canonical registry and lights up the palm/hawsha/sector/farm
**file** views and the grid. It is **Medium risk** (structural data — no money, no payroll/PII), with
a crisp, mechanical acceptance oracle, which makes it the lowest-risk high-leverage next stage.

## 2. The canonical source (non-negotiable #5)

The **Nov-2025 palm registry** is the single source of truth for counts:

| Metric | Canonical value |
|---|---|
| Barhi palms (برحي) | **4,380** |
| Male palms (ذكور) | **299** |
| Hawshat (حوش) | **28** |
| Sectors | **5** — **RATIFIED 2026-06-27** (S22 / HSW / BAB / SHF / KHT) |

Every other document (the 7-yr accounting sheet, prior tallies) reconciles **to** the registry, never
the reverse. If the registry file itself is internally inconsistent, **stop and report** — do not pick
a number.

> **⚠️ Addendum (Owner fact, 2026-07-02 — issue #595): intercropping (زراعات بينية).** The farm grows
> other crops **between the palms in SOME hawshat** (not all). The current schema cannot express this
> (crop exists only as `sectors.crop` single-text; hawshat have no crop composition). **The Stage-M
> import must capture per-hawsha crop composition** — proposed `hawsha_crops` (hawsha_id, crop,
> planted_count/area, planting_date, notes) — collected during the same ground-truth pass as the palm
> counts. Palm counts above remain the canonical registry; intercrop composition is additive and does
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
1. A **reconciliation script** (the oracle, written FIRST): parse the registry → assert
   Σ(barhi)=4,380, Σ(male)=299, 28 hawshat, sectors=N; emit a before/after report. Fail loudly on
   any mismatch.
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
- Materializing individual `assets` rows **unless** the Owner opts in (§6) — aggregate counts satisfy
  the wedge today.

## 5. Acceptance (the oracle — define the check first)

- **Reconciliation:** `Σ(hawshat.palm_count_barhi) = 4,380`, `Σ(hawshat.palm_count_male) = 299`,
  `count(hawshat) = 28`, `count(sectors) = N` (the ratified value) — asserted by a pgTAP test against
  the imported reference tenant (mirrors the existing `03_seed_invariants` test, retargeted to the
  real numbers).
- **Structural integrity:** every hawsha ∈ a sector; every line ∈ a hawsha; (if materialized) every
  palm `asset` ∈ a hawsha; no orphans.
- **Roll-up:** opening a hawsha/sector/farm file shows its palm counts and any events recorded
  against it roll up correctly (drive one operation via the wedge → it appears in the file).
- **Arabic:** names/codes render RTL with no mojibake.

## 6. Open decisions for the Owner (RATIFIED 2026-06-27)

1. **4 vs 5 sectors** — **RATIFIED: 5 sectors** (S22 / HSW / BAB / SHF / KHT), matching the seed
   structure and the registry; the enterprise/crop list is نخيل برحي for all five. (Was: the import
   can't proceed without the agreed sector partition.)
2. **Materialize individual palm `assets`?** — **RECOMMENDED: aggregate-only this stage; per-tree
   deferred** (slice 4) per the recommendation below. Aggregate counts (28 hawshat × barhi/male) fully serve
   the current wedge + files. Materializing ~4,679 individual `assets` rows enables per-tree status
   history (the full moat) but is a larger import + more UI. **Recommendation:** ship aggregate-count
   import + the file/grid views first (this stage); make per-tree `assets` a follow-up slice once the
   tree-file UX is validated.
3. **Registry handling:** confirm the registry file location and that it carries no PII before it
   touches the repo/import tooling.

## 7. Enforcement & evidence (matches MASTER-PLAN Stage 2 + §5)

- The reconciliation check is the **gate** — it must fail before the import and pass after; never
  weaken it. Forbid the tool from editing the oracle to match.
- The import runs through the **Owner-gated apply layer** (not a client), idempotent, with the
  before/after reconciliation report as evidence — same posture as the prod migration push.
- RLS already enforces tenant isolation on these tables; the import writes only the reference tenant.
- **Gate:** Owner (independent review not required for structural data, but the reconciliation
  evidence is mandatory). Real-data handling = the Owner's go-ahead per PROJECT RULES.

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
`lib/database.types.ext.ts` (the augmentation bridging the as-yet-unpushed objects) becomes a no-op. Bulk
import of the real 4,680 palms stays Stage-2 slice-4 / Stage M (real data + privacy review).
