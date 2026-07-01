# SPEC-0020 — Bulk-import template prefill + reconcile-upsert (farm structure)

> Status: DRAFT — brainstormed conversationally with the Owner 2026-07-01; scope approved
> section-by-section. Owner directive: proceed through implementation on Claude's
> recommendation; standing gates (no self-commit/push/merge/migrate) still apply.

## 1. Why this, why now

The bulk-import framework (`lib/import/*`, `ImportPanel`, `/api/import`) ships a **blank**
template and only ever **inserts** rows (`p_id: null` in every `toRpcArgs`). Migration
`20260701150000` already found and partially guarded the resulting gap: a re-uploaded file
(after a timeout, or just re-editing a corrected export) silently double-imports every
sector/hawsha, now converted into a visible `23505` "already exists" error instead of a
silent duplicate. The Owner wants the actual fix: **download a template pre-filled with
current data, edit it, re-upload, and have the upload update what changed, add what's new,
and archive what's gone** — turning the template into a full review-and-reconcile surface,
per data entry point, app-wide.

This spec covers the framework capability plus its first application: **farm structure**
(sectors, hawshat, and a new lines descriptor). The rest of the app (suppliers, expenses,
purchase requests, plans, etc.) is a roadmap, not designed here — each gets its own future
slice using the same framework, in an order to be decided later.

**Farms are excluded from this slice** — there is no `fn_save_farm` RPC today (confirmed:
no `fn_save_farm` function exists in any migration). Adding one is new backend work (a
migration + RPC + security review), a separate, larger, DB-migration-gated task.

## 2. Scope

**Allowed:**
1. Extend `ImportDescriptor` (types.ts) with `matchKey`, `table`, and `fromRow`; extend
   `toRpcArgs` to accept a resolved `matchedId`.
2. A new `lines` descriptor (`fn_save_line`), same pattern as `sectors`/`hawshat`.
3. A migration adding a partial unique index on `lines (hawsha_id, line_no) where archived
   is not true` — mirrors `20260701150000`, the DB-level backstop for the new match key.
4. Prefill: `GET /api/import` returns a template whose data sheet includes every existing
   active row for the org (ref columns shown as their human code, never a UUID).
5. Reconcile-upsert on commit: match by `matchKey` → update; unmatched → insert; existing
   active rows absent from the file → archived via the existing `fn_archive_structure` RPC
   (soft-delete, not a raw DELETE).
6. UI: `ImportPanel` shows insert/update/archive counts from the dry-run, and requires an
   explicit confirmation before a commit that would archive anything.

**Forbidden:**
- Materializing a `farms` descriptor/RPC in this slice (see §1).
- Any raw DELETE — archival is always through `fn_archive_structure`.
- Applying the new migration or merging — Owner-gated, per standing rails.
- Fabricating farm-structure data. (Note: the Owner separately shared a real croquis —
  `كروكي نخيل حوض البابور 2023.jpg` — showing حوض البابور split into 2 hawshat by the
  service road (right side = hawsha 1, left side = hawsha 2), 12 feddan, 8m×10m spacing,
  624 total offshoots. This is real data for a **separate, later, Owner-gated import task**
  once this framework ships — not entered as part of building the capability itself.)

## 3. Data model changes

`lib/import/types.ts`:
```ts
export interface ImportDescriptor {
  // ...existing fields...
  table: string;                 // source DB table, e.g. "sectors"
  matchKey: string[];            // business key for upsert matching + in-file dedupe
  fromRow: (dbRow: Record<string, unknown>) => Record<string, unknown>;
  toRpcArgs: (row: Record<string, unknown>, matchedId: string | null) => Record<string, unknown>;
}
```
- `dedupeKey` is retired in favor of `matchKey` (same shape, dual-purpose: in-file dedup
  *and* cross-request upsert matching).
- `sectors.matchKey = ["code"]`, `hawshat.matchKey = ["code"]` (both already have a unique
  active-code index — `20260701150000`).
- `lines.matchKey = ["hawshaId", "lineNo"]` — `line_code` is optional/nullable so it can't
  anchor a match; `line_no` is required and stable (it's literally the row number, matching
  the croquis's numbered rows 1–37).

New descriptor `lib/import/descriptors/lines.ts` (mirrors `hawshat.ts`):
```ts
export const linesDescriptor: ImportDescriptor = {
  key: "lines",
  titleAr: "الخطوط",
  rpc: "fn_save_line",
  role: "structure.write",
  table: "lines",
  matchKey: ["hawshaId", "lineNo"],
  columns: [
    { key: "hawshaId", labelAr: "كود الحوش", type: "string", required: true, example: "H-01",
      ref: { table: "hawshat", codeColumn: "code", activeColumn: "archived", activeValue: false } },
    { key: "lineNo", labelAr: "رقم الخط", type: "int", required: true, example: "1" },
    { key: "lineCode", labelAr: "كود الخط", type: "string", required: false, example: "" },
    { key: "palmCount", labelAr: "عدد النخيل", type: "int", required: false, example: "52" },
    { key: "direction", labelAr: "الاتجاه", type: "string", required: false, example: "" },
    { key: "notes", labelAr: "ملاحظات", type: "string", required: false, example: "" },
  ],
  fromRow: (r) => ({
    hawshaId: r.hawsha_id, lineNo: r.line_no, lineCode: r.line_code ?? "",
    palmCount: r.palm_count ?? "", direction: r.direction ?? "", notes: r.notes ?? "",
  }),
  toRpcArgs: (r, matchedId) => ({
    p_id: matchedId, p_hawsha_id: r.hawshaId, p_line_no: r.lineNo,
    p_line_code: r.lineCode || null, p_palm_count: r.palmCount ?? null,
    p_direction: r.direction || null, p_notes: r.notes ?? null,
  }),
};
```
`fromRow` for `sectors`/`hawshat` follows the same reverse-of-`toRpcArgs` shape.

Migration `20260701220000_lines_lineno_uniq.sql` (main's latest is `20260701210000`; checked
against in-flight worktree branches for collisions):
```sql
create unique index if not exists lines_hawsha_lineno_active_uniq
  on public.lines (hawsha_id, line_no) where archived is not true;
```

## 4. Template generation (prefill) flow

`GET /api/import?descriptor=<key>`:
1. Query `descriptor.table` via the RLS-scoped user-session client, `org_id = active org`,
   `archived is not true`.
2. Map each row through `fromRow` → column-key-shaped values (ref columns still hold ids).
3. Batch-reverse-resolve ref ids → human codes: new `reverseResolveRefs` (symmetric to the
   existing `resolveRefs`), one `id IN (...)` lookup per ref column, org-scoped.
4. `buildTemplateSpec(descriptor, existingRows)` — data sheet = header + one row per
   existing active record (sanitized identically to today), then blank space for new rows.
5. Zero existing rows → today's effectively-blank template (no behavior change).

## 5. Commit flow: match → insert / update / archive

Both dry-run and commit:
1. After `parseRows` (raw cells, pre-validation), compute each row's raw `matchKey` value.
   The set of matchKeys **present in the file** — regardless of whether that row later
   fails validation — is the "seen" set. A row with an unrelated typo must still protect
   its existing record from archival; only true absence from the file does not.
2. For rows that pass validation + ref-resolution, batch-query existing active rows in
   `descriptor.table` by `matchKey` (org-scoped) → matchKey→id map. Each valid row gets
   `matchedId` (update) or `null` (insert), passed into `toRpcArgs(row, matchedId)`.
3. **To-archive set** = existing active rows whose matchKey is not in the "seen" set.

Dry-run response extends to: `{ okCount, errorCount, errors, toInsert, toUpdate, toArchive }`
— `toArchive` carries the affected rows' codes/labels, not just a count.

Commit executes inserts/updates via the descriptor's RPC as today (per-row, partial
success), then archives the to-archive set via `fn_archive_structure(p_type, p_id,
p_archived: true)` — the same RPC the manual archive button already uses. Archiving a
sector already cascades to its hawshat/lines (existing RPC behavior), so overlapping
archive-by-omission across levels in the same upload is naturally idempotent.

## 6. UI + safety (`ImportPanel`)

- Dry-run results show four counts: جديد (insert) / تحديث (update) / سيُؤرشف (archive) /
  أخطاء (errors), plus the existing per-row error list.
- When `toArchive.length > 0`, render the list of codes to be archived and require an
  explicit checkbox — "أفهم أن العناصر المحذوفة من الملف سيتم أرشفتها" (I understand
  rows removed from the file will be archived) — before the commit button enables. This
  gate is **in addition to** the existing `errorCount === 0` gate, not a replacement.
- Server-side defense in depth: `/api/import` POST commit rejects (400) if `toArchive.length
  > 0` and the request didn't send `confirmArchive: true` — the checkbox is UX, not the
  only enforcement, since the client can't be trusted to gate a destructive action alone.

## 7. Acceptance (the oracle — define the check first)

- **Round-trip idempotency:** download a template for an org with N active rows, re-upload
  unchanged → dry-run reports `toInsert=0, toUpdate=0, toArchive=0` (proves prefill + match
  are inverses of each other).
- **Update:** edit one field on one existing row, re-upload → dry-run reports exactly
  `toUpdate=1`, and after commit the DB row reflects the new value with the same `id`
  (not a new row).
- **Insert:** append one new row below the existing ones → `toInsert=1`.
- **Archive-by-omission:** delete one existing row from the sheet, re-upload → dry-run
  reports `toArchive=1` naming that row; commit without `confirmArchive` is rejected;
  commit with it archives exactly that row (soft-delete, `archived_at` set, not gone from
  the DB).
- **Error protects from archive:** edit an existing row to have an invalid value in an
  unrelated column, re-upload → that row's matchKey is still "seen" → it does NOT appear
  in `toArchive` (it's reported as a validation error instead; nothing is silently lost).
- **Lines uniqueness:** pgTAP test asserting the new partial unique index exists and
  rejects a duplicate active `(hawsha_id, line_no)`, mirroring `tests/106`.

## 8. Slices (small, independently gateable)

1. Framework: `matchKey`/`table`/`fromRow` types + `reverseResolveRefs` + prefill in
   `buildTemplateSpec` + the archive-by-omission commit-plan logic. Applied first to
   `sectors`/`hawshat` (no new descriptor needed). *(Medium — core logic, needs the
   round-trip/error-protection tests above.)*
2. `lines` descriptor + its migration (partial unique index). *(Low — follows the proven
   sectors/hawshat pattern.)*
3. `ImportPanel` UI: counts + archive confirmation + server-side `confirmArchive` gate.
   *(Low — UI + one route check.)*
4. Mount `ImportPanel` on the farm-structure pages (it's currently latent — not yet
   route-mounted anywhere). *(Low.)*

Each slice stops at its gate (migrate-first, then merge; Owner applies the migration).
**Roadmap (not designed here):** suppliers, expenses, purchase requests, plans, custody,
etc. — same framework, one descriptor + one small PR each, order to be decided later.
**Also roadmap (real-data, Owner-gated, separate task):** import حوض البابور's 2 real
hawshat (+ lines) from the croquis once this framework ships.
