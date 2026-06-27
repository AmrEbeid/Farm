# RESEARCH + DECISION MEMO — Editable farm structure + per-node 360 pages + media (2026-06-26)

*Feeds [`SPEC-0003`](SPEC-0003-farm-structure-and-palm-registry-import.md) (Stage 2). Owner directive
2026-06-26: build the module to completion. This memo records what was researched, the decisions taken,
and the scope actually implemented. Decision-support + change record — the code lands in `apps/farm-os`.*

> **Method note (honest):** the automated `deep-research` harness failed its **first two runs**
> (`StructuredOutput retry cap exceeded`). Root cause: the Scope agent was forced to echo a ~600-char
> question verbatim into a required schema field and mangled the JSON (it even emitted stray
> `<parameter>` XML). **Fixed** by patching the workflow script (Scope returns only `angles`) and passing
> a one-line question — the **third run succeeded** (110 agents, 27 sources, 130 claims, 25 adversarially
> verified, 19 confirmed / 6 killed; §3.6). The findings below combine that run with a manual
> multi-source pass; together they **confirmed every architecture decision** and surfaced a **real flaw**
> (the cascade-restore hazard, §3.5) since fixed.

## 1. The ask

Let the tenant (owner / farm manager) **add, edit, and remove** every level of the farm structure —
**sub-farm (قطاع/sector), حوشة (hawsha), خط (line/row), and single palm (نخلة)** — and give **each node its
own "360" page** carrying its full details, its activity/event records, and **attached photos & documents**.

## 2. What already exists (internal audit)

- **Schema is already there** (`migration 0003`): `farms → sectors → hawshat → lines → assets` (a palm is an
  `asset` with `type='palm'`, columns: `variety, sex, status, health_status, planting_date, id_tag, archived`).
  `palm_status_history` already records per-tree status changes. → The hierarchy maps 1:1 to the ask:
  **sub-farm = sector, hawsha = hawshat, line = lines, single palm = assets**.
- **Read-views already exist**: `farm` grid, `sector/[id]`, `hawsha/[id]`, `palm/[id]` (+ a status form).
  There is **no `line/[id]` page yet** and **no create/edit/remove** anywhere.
- **Write pattern is settled**: every mutation goes through a **SECURITY DEFINER RPC that is role-gated in
  the database** via `authorize(perm, org)` (e.g. `fn_update_palm_status` 0039), then the server action calls
  `revalidatePath`. RLS is deny-by-default + org-scoped on all tables; hard `DELETE` is **revoked** from
  clients (`0027`).
- **Gaps for this feature**: (a) no `structure.write` permission — structural edits had no gate; (b) **no audit
  triggers** on `farms/sectors/hawshat/lines/assets`; (c) only `assets` has a soft-delete flag (parents don't);
  (d) **no media layer at all** — no storage bucket, no attachments table for these entities (only
  `event_attachments` exists, as a precedent).

## 3. External best-practice findings (web research)

- **Per-tree records are industry-standard.** Orchard platforms (FruitMinder, Croptracker, TreeScout) keep a
  record per individual tree — variety, planting date, location, status, and an event history — i.e. exactly our
  `assets` + `palm_status_history` shape. The scale caveat: pair per-tree records with **search + bulk
  operations + a visual grid/map**, never a raw 4,680-row list.
  Sources: [FruitMinder](https://fruitminder.online/), [Croptracker](https://www.croptracker.com/product/orchard-management-software.html),
  [Farmable](https://farmable.tech/orchard-management/).
- **Soft-delete, never hard-delete, to preserve history.** Use a flag/timestamp; **cascade the soft-delete to
  children**; let RLS/queries hide archived rows. Removing a node must not orphan or destroy its past events.
  Sources: [evilmartians](https://evilmartians.com/chronicles/soft-deletion-with-postgresql-but-with-logic-on-the-database),
  [dev.to soft-delete strategies](https://dev.to/oddcoder/postgresql-soft-delete-strategies-balancing-data-retention-50lo).
- **Supabase Storage** = private bucket + RLS on `storage.objects` + **signed URLs**; compress images
  client-side (~1600px, q≈0.8) before upload; path layout `org/entity/id/file`. The primary docs confirm
  the exact policy pattern used: `bucket_id = '…' and (storage.foldername(name))[1] = <owner/org id>`, and
  that **Storage denies all uploads to a bucket with no RLS policy**.
  Sources: [Storage access control](https://supabase.com/docs/guides/storage/security/access-control),
  [Signed URLs / RLS deep dive](https://dev.to/kanta13jp1/supabase-storage-deep-dive-bucket-design-signed-urls-image-transforms-and-rls-3b9k).

### 3.1 Hierarchy data model — adjacency list is correct here
For a **fixed, shallow (4-level) hierarchy where re-parenting is rare**, the **adjacency list** (a
`parent`/FK column — what the schema already uses) is the right model: simple, space-efficient, and a
subtree move is a one-row `parent_id` update. A **closure table** buys recursion-free deep queries but
costs high disk and slow re-parent (insert/delete many path rows); **ltree/materialized-path** adds query
power but its GIST index has size limits for deep trees. None of those costs are worth paying at depth 4.
Sources: [Do's and Don'ts of large trees in PostgreSQL](https://leonardqmarcq.com/posts/dos-and-donts-of-modeling-hierarchical-trees-in-postgres),
[Hierarchical models in PostgreSQL (Ackee)](https://www.ackee.agency/blog/hierarchical-models-in-postgresql),
[adjacency vs closure (AppMaster)](https://appmaster.io/blog/model-org-charts-postgresql-adjacency-vs-closure).

### 3.2 Per-single-tree at ~5,000 scale is proven — pair it with labels + search
Individual-tree records scale far beyond our ~4,680: documented QR programs run to **100,000 trees**;
hybrid **QR + UHF-RFID** per-tree tags decode ~96% of trees in <4 s and carry geolocation, species, photos.
Implication for us: per-palm 360 pages are sound, and the existing `id_tag` (e.g. `EBD-BAB-H03-L12-P008`)
is the hook for a future **printable QR label**; caveat — laminated QR survives ~2 yr outdoors.
Sources: [QR-coding 100k trees](https://farmersforforests.medium.com/we-are-qr-coding-100-000-trees-and-counting-in-our-forests-30bbbd107742),
[Smartphone individual-tree acquisition (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S016816991500160X),
[Marking standing trees with RFID (Forests/MDPI)](https://www.mdpi.com/1999-4907/11/2/150).

### 3.3 Offline field capture — a known GAP, not yet built
True offline-first means a local store (SQLite) + delta sync + conflict resolution (last-write-wins is
"simplest but risky"; Git-style version sync is safer). **We did NOT build this.** The app is online,
server-rendered; the media flow is an online upload with client-side compression + mobile-RTL only. So the
"offline-tolerant" requirement is **partially** met (mobile-friendly, small uploads) but **not** true
offline capture — flagged as a deliberate limitation (§6).
Sources: [Offline-first architecture (DEV)](https://dev.to/odunayo_dada/offline-first-mobile-app-architecture-syncing-caching-and-conflict-resolution-518n),
[Offline data sync for field ops (Matidor)](https://matidor.com/blog/offline-data-sync-for-field-operations).

### 3.5 The cascade-restore hazard — a real flaw found, and fixed
**The most valuable finding.** Cascading a *soft* delete to children and then cascading the *restore* back
is a documented anti-pattern: "there is no way to know which [children] were deleted by the cascading
operation versus deleted prior to that, [so] when you restore the parent, [independently-deleted] children
will [be wrongly resurrected]." The first cut of `fn_archive_structure` did exactly this. **Fix (shipped):**
each archive stamps one `archived_at` (`clock_timestamp()`) on the node + the descendants it cascades;
**restore un-archives only rows whose `archived_at` matches that cascade**, so a palm removed independently
before its sector was removed **stays removed** after the sector is restored. Pinned by a new pgTAP
assertion (test 50). Also confirmed: **never hard-`DELETE`** audit/history-bearing rows (use RESTRICT/soft).
Sources: [Parent soft-delete: restrict or cascade (QuickAdminPanel)](https://blog.quickadminpanel.com/one-to-many-with-soft-deletes-deleting-parent-restrict-or-cascade/),
[ON DELETE CASCADE — when to avoid (DataCamp)](https://www.datacamp.com/tutorial/sql-on-delete-cascade),
[Delete behaviors & soft-delete in EF Core/DDD](https://amrelsher07.medium.com/delete-behaviors-in-ef-core-and-how-they-fit-into-domain-driven-design-ddd-084a36eb082b).

### 3.6 What the (eventually-successful) deep-research harness added
The 110-agent run (6 angles, 27 sources, 3-vote adversarial verification) did **not overturn any
decision** — it reinforced them and added specifics:
- **History preservation = JSONB row snapshots.** Its single highest-confidence surviving finding was
  **`supa_audit`-style `record`/`old_record` JSONB snapshots** ([supabase.com/blog/postgres-audit](https://supabase.com/blog/postgres-audit)) —
  which is *exactly* the project's `fn_audit` (before/after JSONB → `audit_log`) that migration `0051`
  now attaches to every structure table. Independent validation of the chosen approach. For a future
  *full*-temporal history it also surfaced [`temporal_tables`](https://github.com/arkhipov/temporal_tables).
- **Offline-first has a concrete tool: PowerSync.** If true offline capture (§3.3) is ever wanted,
  [PowerSync's Supabase attachments helper](https://powersync.com/blog/building-offline-first-file-uploads-with-powersync-attachments-helper)
  is the named pattern (local queue + sync) — confirming we'd add a layer, not rewrite.
- **Adversarial verification earned its keep:** it **killed 6 claims**, all vendor-marketing or
  over-stated benchmarks (Agrisoft OMP / Groundzy per-tree brochures; a "9000ms→20ms" RLS benchmark; a
  "24-hour signed upload URL" figure). Lesson: rest "per-tree is standard" on the *verified general
  pattern* + primary docs, not vendor pages. (Caveat: the final synthesis agent returned thin prose for
  its summary/caveats fields — the value is in the verified source+claim set, not its closing paragraph.)

## 4. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Reuse the existing hierarchy** (no new tables for nodes). sub-farm=sector, hawsha, line, palm=asset. | Schema already correct; the moat is tree-level records. Avoids overbuild. |
| D2 | **Remove = soft-delete (`archived=true`), cascade to descendants, with PROVENANCE-AWARE restore (`archived_at` stamp per cascade). Hard DELETE stays revoked.** | Preserves all events/history/financial links; matches `0027` posture + the research. Restorable — and restore never resurrects an independently-removed child (§3.5). |
| D3 | **New `structure.write` permission = {owner, farm_manager}.** Structural edits gated to it; palm *status* stays `op.execute`; **photo/doc attach = `op.execute`** (field staff document trees). | Field staff shouldn't restructure the farm, but should record status + photos. |
| D4 | **All node writes go through SECURITY DEFINER RPCs** (`fn_save_sector/hawsha/line/palm`, `fn_archive_structure`, `fn_add_attachment`, `fn_archive_attachment`), each `authorize`-gated + atomic + audited. | The established pattern (0039/0038/0035); closes the direct-PostgREST bypass. |
| D5 | **Add audit triggers** to `farms/sectors/hawshat/lines/assets` + `attachments`. | Structural change is config — it must be in `audit_log` like every other write. |
| D6 | **Polymorphic `attachments` table** (`entity_type ∈ farm/sector/hawsha/line/palm`, `entity_id`, `storage_path`, `kind ∈ photo/document`, caption, content_type, size, uploaded_by, archived). RLS org-scoped read; insert gated to `op.execute`; DELETE revoked; soft-delete. | One media table for every node; mirrors `event_attachments`. |
| D7 | **Storage bucket + `storage.objects` RLS live in a separate `supabase/storage-policies.sql`**, applied to the real project as an **Owner-gated apply** — NOT in `migrations/` (the Docker-free pgTAP harness stubs only `auth`, not `storage`, so a `storage.*` migration would break CI). | Keeps the harness green; provisioning a bucket is an apply-layer action anyway. |
| D8 | **Per-tree palms are created on demand, not bulk-materialized.** The CRUD works whether a hawsha has 0 or 190 palm rows; bulk-import of the real 4,680 stays the Owner-gated Stage-2 slice-4 / Stage-M data action. **The canonical `hawshat.palm_count_barhi/male` rollups are INDEPENDENT of the asset rows and are NOT recomputed on palm create/archive** — the rollups are the registry (the headline 4,380/299); asset rows are an operational sample. An asset-driven recompute would overwrite 4,380 with the 60-row sample (a #5 violation), so it is deliberately avoided; never "reconcile" the two by recomputing the rollup from `assets`. | Don't fabricate data (non-negotiable #1); don't couple the feature to a real-data import. |
| D9 | **Add the missing `line/[id]` 360 page** and edit/add/remove affordances on every existing file page; navigation stays grid+timeline+search-friendly. | Completes the 4-level symmetry the ask requires. |

## 5. What this ADDS / IMPROVES vs a naive CRUD

- **Cascade-aware soft-delete with provenance-correct restore** (archiving a sector hides its
  hawshat→lines→palms but keeps every row + event; restoring brings back only what *that* removal hid) —
  a naive `DELETE` would cascade-destroy `palm_status_history` and orphan events, and a naive cascade-restore
  would wrongly resurrect independently-removed children (§3.5).
- **DB-enforced role gate** on structural writes (naive CRUD would trust the app only — the same class of bug
  `0039`/`0049` fixed for palm status).
- **Full audit trail** on structure (previously unlogged).
- **Field-safe Arabic errors** on every action (`toArabicError`), RTL-first forms, mobile-friendly.
- **Private, RLS-scoped media** with client-side compression + signed URLs (not public blobs).
- **Restore** (un-archive) — reversibility for an accidental removal.

## 6. Out of scope (explicit, to avoid overbuild)

- Bulk import of the real 4,680 palms (Owner-gated Stage-2 slice 4 / Stage M — real data + privacy review).
- GIS map / GPS coordinates per palm, QR-label printing, IoT/drone metrics (future; the schema leaves room —
  `id_tag` is the label hook).
- Moving a node to a *different* parent (re-parenting) — deferred; this round covers add/edit-in-place/remove.
  (Re-parenting needs an event-relink decision; archived+recreate covers the rare case meanwhile.)
- **True offline-first field capture** (local SQLite + delta sync + conflict resolution) — NOT built (§3.3).
  The media flow is an online upload with client-side compression + mobile-RTL. A real offline layer is a
  larger, separate workstream; flagged so "offline-tolerant" isn't overclaimed.

## 7. Enforcement & evidence

New pgTAP tests assert: `structure.write` maps to owner/farm_manager only; each save RPC creates/edits and is
forbidden without the permission; `fn_archive_structure` cascades and hides children while preserving rows;
audit rows are written; `attachments` is org-isolated, insert-gated, and DELETE-revoked. The local harness
(`run-pgtap-local.sh`) must stay green. Applying the storage bucket + any real prod migration remains an
**Owner-gated apply** (PROJECT RULES) — this memo + the code do not touch prod.
