# Import Template Prefill + Reconcile-Upsert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every farm-structure import template (sectors, hawshat, lines) ships pre-filled with the org's current data for review, and re-uploading it updates changed rows, inserts new ones, and archives rows removed from the file — instead of today's blank-template, insert-only behavior.

**Architecture:** Extend the existing generic bulk-import framework (`apps/farm-os/lib/import/*`) with three purely-additive capabilities — reverse ref resolution (id→code, for prefill), template prefill (existing rows in the data sheet), and reconcile-upsert matching (business-key match → update/insert, absence → archive). All three are opt-in per descriptor (new fields are optional), so nothing that doesn't use them changes behavior. Apply them to `sectors`/`hawshat` (already have descriptors) and a new `lines` descriptor. Wire into `/api/import` (GET prefill, POST match+archive) and `ImportPanel` (counts + a hard confirmation gate before any archive).

**Tech Stack:** Next.js 16 (App Router, server actions/routes), TypeScript, Supabase (Postgres/RLS, `SECURITY DEFINER` RPCs), `exceljs` (lazy-loaded), Vitest, pgTAP.

## Global Constraints

- Every DB read/write in the import route uses the **RLS-scoped user-session client** (`createClient()`), never service-role — each row must honor the RPC's own role/RLS gate (see `app/api/import/route.ts` header comment).
- Archival is **always** through `fn_archive_structure` (soft-delete). Never a raw `DELETE`.
- New migrations are **drafts** — this plan creates the migration file but does not apply it. Migrate-first, then merge; Owner applies.
- No `git add .` — stage files by exact name. Small, focused commits per task.
- All Arabic strings/labels follow the existing file's conventions exactly (copy patterns, don't invent new phrasing).
- Numeric columns must tolerate Arabic-Indic digits (existing `normalizeDigits` in `validate.ts`) — this plan reuses it for match-key computation too, so a row typed with Arabic digits still matches its existing DB record.

---

### Task 1: Framework primitives — reverse ref resolution + template prefill

**Files:**
- Modify: `apps/farm-os/lib/import/resolve.ts`
- Modify: `apps/farm-os/lib/import/resolve.test.ts`
- Modify: `apps/farm-os/lib/import/workbook-spec.ts`
- Modify: `apps/farm-os/lib/import/workbook-spec.test.ts`

**Interfaces:**
- Consumes: existing `ImportDescriptor`, `RefSpec`, `ResolvedRefSpec` from `./types`.
- Produces: `reverseResolveRefs(descriptor, rows, lookup): Promise<Record<string, unknown>[]>` and `type ReverseRefLookup = (spec: ResolvedRefSpec, ids: string[]) => Promise<Map<string, string>>` (both exported from `resolve.ts`, id→code); `buildTemplateSpec(d, existingRows?: Record<string, unknown>[])` (existingRows defaults to `[]`, preserving today's behavior) exported from `workbook-spec.ts`. Later tasks (2, 5) call these by these exact names.

- [ ] **Step 1: Write the failing tests for `reverseResolveRefs`**

Append to `apps/farm-os/lib/import/resolve.test.ts`:
```ts
import { reverseResolveRefs, type ReverseRefLookup } from "./resolve";

// fake reverse lookup: every id resolves to "<table>:<id>" except "MISSING"
const fakeReverseLookup: ReverseRefLookup = async (spec, ids) =>
  new Map(ids.filter((i) => i !== "MISSING").map((i) => [i, `${spec.table}:${i}`]));

describe("reverseResolveRefs", () => {
  it("passes rows through unchanged when the descriptor has no ref columns", async () => {
    const rows = await reverseResolveRefs(noRef, [{ name: "a" }], fakeReverseLookup);
    expect(rows).toEqual([{ name: "a" }]);
  });

  it("replaces a ref id with its resolved code", async () => {
    const rows = await reverseResolveRefs(withRef, [{ sectorId: "id-1", name: "حوش 1" }], fakeReverseLookup);
    expect(rows).toEqual([{ sectorId: "sectors:id-1", name: "حوش 1" }]);
  });

  it("leaves an empty ref value as an empty string", async () => {
    const rows = await reverseResolveRefs(withRef, [{ sectorId: "", name: "حوش 1" }], fakeReverseLookup);
    expect(rows).toEqual([{ sectorId: "", name: "حوش 1" }]);
  });

  it("falls back to an empty string when an id has no resolvable code", async () => {
    const rows = await reverseResolveRefs(withRef, [{ sectorId: "MISSING", name: "x" }], fakeReverseLookup);
    expect(rows).toEqual([{ sectorId: "", name: "x" }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/farm-os && npx vitest run lib/import/resolve.test.ts`
Expected: FAIL — `reverseResolveRefs` is not exported from `./resolve`.

- [ ] **Step 3: Implement `reverseResolveRefs` in `resolve.ts`**

The file currently has a private `refColumns` function. Export it, then add the reverse resolver below `resolveRefs`:
```ts
// change: export function refColumns(...)  (was: function refColumns(...))

export type ReverseRefLookup = (spec: ResolvedRefSpec, ids: string[]) => Promise<Map<string, string>>;

/** Reverse of resolveRefs: maps each ref column's id back to its human code, for the
 * template-prefill display. Runs on rows already shaped by a descriptor's `fromRow`
 * (ref columns still hold ids at this point). An id with no resolvable code (data gone
 * stale between fetch and render) falls back to an empty string rather than throwing —
 * the template is a display/edit surface, not the source of truth. */
export async function reverseResolveRefs(
  descriptor: ImportDescriptor,
  rows: Record<string, unknown>[],
  lookup: ReverseRefLookup,
): Promise<Record<string, unknown>[]> {
  const refs = refColumns(descriptor);
  if (refs.length === 0) return rows;

  const maps = new Map<string, Map<string, string>>();
  for (const { col, spec } of refs) {
    const ids = [...new Set(rows.map((r) => String(r[col.key] ?? "")).filter((v) => v !== ""))];
    maps.set(col.key, ids.length > 0 ? await lookup(spec, ids) : new Map());
  }

  return rows.map((row) => {
    const out = { ...row };
    for (const { col } of refs) {
      const id = String(row[col.key] ?? "");
      out[col.key] = id === "" ? "" : (maps.get(col.key)?.get(id) ?? "");
    }
    return out;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/farm-os && npx vitest run lib/import/resolve.test.ts`
Expected: PASS (all `reverseResolveRefs` + existing `resolveRefs` tests).

- [ ] **Step 5: Write the failing tests for template prefill**

Append to `apps/farm-os/lib/import/workbook-spec.test.ts`:
```ts
describe("buildTemplateSpec with existing rows", () => {
  it("adds one data-sheet row per existing record, after the header", () => {
    const spec = buildTemplateSpec(d, [{ name: "أحمد", kind: "a" }, { name: "سعد", kind: "b" }]);
    const data = spec.sheets[1];
    expect(data.rows).toEqual([
      ["الاسم *", "النوع"],
      ["أحمد", "a"],
      ["سعد", "b"],
    ]);
  });

  it("sanitizes existing-row cell values the same way as the example row", () => {
    const evil: ImportDescriptor = { ...d, columns: [d.columns[0]] };
    const spec = buildTemplateSpec(evil, [{ name: "=HYPERLINK(1)" }]);
    expect(spec.sheets[1].rows[1]).toEqual(["'=HYPERLINK(1)"]);
  });

  it("defaults to a header-only sheet when no existing rows are given", () => {
    const spec = buildTemplateSpec(d);
    expect(spec.sheets[1].rows).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd apps/farm-os && npx vitest run lib/import/workbook-spec.test.ts`
Expected: FAIL — `buildTemplateSpec` ignores a second argument (data sheet still header-only).

- [ ] **Step 7: Implement prefill in `buildTemplateSpec`**

In `workbook-spec.ts`, change the signature and the data-sheet row assembly:
```ts
export function buildTemplateSpec(
  d: ImportDescriptor,
  existingRows: Record<string, unknown>[] = [],
): WorkbookSpec {
  // ...instructions block unchanged...

  const header = d.columns.map((c) => sanitizeCell(c.required ? c.labelAr + " *" : c.labelAr));
  const dataRows = existingRows.map((r) => d.columns.map((c) => sanitizeCell(r[c.key])));

  const dropdowns = d.columns
    .map((c, i) => (c.type === "enum" ? { col: i, values: c.enumValues ?? [] } : null))
    .filter((x): x is { col: number; values: string[] } => x !== null);

  return {
    sheets: [
      { name: INSTRUCTIONS_SHEET, rows: instructions },
      { name: DATA_SHEET, rows: [header, ...dataRows], dropdowns },
    ],
  };
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd apps/farm-os && npx vitest run lib/import/workbook-spec.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 9: Commit**

```bash
cd apps/farm-os
git add lib/import/resolve.ts lib/import/resolve.test.ts lib/import/workbook-spec.ts lib/import/workbook-spec.test.ts
git commit -m "feat(import): reverse ref resolution + template prefill primitives"
```

---

### Task 2: Reconcile-upsert matching (`match.ts`)

**Files:**
- Create: `apps/farm-os/lib/import/match.ts`
- Create: `apps/farm-os/lib/import/match.test.ts`
- Modify: `apps/farm-os/lib/import/validate.ts` (export `normalizeDigits`)
- Modify: `apps/farm-os/lib/import/types.ts` (add `matchKey`, `table`, `fromRow`; extend `toRpcArgs`)

**Interfaces:**
- Consumes: `getSourceRow` from `./types`; `normalizeDigits` from `./validate`.
- Produces: `matchKeyOf(descriptor, row): string`, `seenKeysOf(descriptor, rawRows): Set<string>`, `computeMatchPlan(descriptor, seenKeys, validRows, existing): MatchPlan`, `type ExistingRow = { id: string; key: string; label: string }`, `type MatchPlan = { matchedIds: Map<number, string>; toArchive: { id: string; label: string }[] }`. Task 3 (descriptors) uses the extended `ImportDescriptor` fields; Task 5 (route) calls `seenKeysOf`/`computeMatchPlan` by these exact names.

- [ ] **Step 1: Export `normalizeDigits` from `validate.ts`**

In `apps/farm-os/lib/import/validate.ts`, change:
```ts
function normalizeDigits(s: string): string {
```
to:
```ts
export function normalizeDigits(s: string): string {
```

- [ ] **Step 2: Extend `ImportDescriptor` in `types.ts`**

Add these fields to the `ImportDescriptor` interface (all optional — existing descriptors that don't set them keep today's behavior exactly):
```ts
export interface ImportDescriptor {
  key: string;
  titleAr: string;
  rpc: string;
  role: string;
  columns: ImportColumn[];
  toRpcArgs: (row: Record<string, unknown>, matchedId?: string | null) => Record<string, unknown>;
  dedupeKey?: string[];
  /** DB table this descriptor reads from for prefill + reconcile-upsert. Unset = today's
   * blank-template, insert-only behavior (no prefill, no matching). */
  table?: string;
  /** The `fn_archive_structure` p_type value for this table (e.g. "sector", "hawsha",
   * "line") — required alongside `table` to support archive-by-omission. */
  archiveType?: string;
  /** Business key used to match an uploaded row to an existing DB row (update) vs. treat
   * it as new (insert), and to detect rows missing from the file (archive candidates). */
  matchKey?: string[];
  /** Reverse of `toRpcArgs`: maps a queried DB row to column-key-shaped values for the
   * template. Ref columns should be left holding the raw id — `reverseResolveRefs`
   * converts them to their human code before rendering. */
  fromRow?: (dbRow: Record<string, unknown>) => Record<string, unknown>;
}
```

- [ ] **Step 3: Write the failing tests for `match.ts`**

Create `apps/farm-os/lib/import/match.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { matchKeyOf, seenKeysOf, computeMatchPlan, type ExistingRow } from "./match";
import { setSourceRow, type ImportDescriptor } from "./types";

const d: ImportDescriptor = {
  key: "hawshat",
  titleAr: "أحواش",
  rpc: "fn_save_hawsha",
  role: "structure.write",
  columns: [],
  matchKey: ["code"],
  toRpcArgs: (r) => r,
};

describe("matchKeyOf", () => {
  it("joins matchKey column values", () => {
    expect(matchKeyOf(d, { code: "H-01" })).toBe("H-01");
  });

  it("normalizes Arabic-Indic digits so a row typed in Arabic digits still matches", () => {
    const numeric: ImportDescriptor = { ...d, matchKey: ["lineNo"] };
    expect(matchKeyOf(numeric, { lineNo: "٥" })).toBe(matchKeyOf(numeric, { lineNo: "5" }));
  });

  it("joins composite keys with a separator that can't collide across fields", () => {
    const composite: ImportDescriptor = { ...d, matchKey: ["hawshaId", "lineNo"] };
    expect(matchKeyOf(composite, { hawshaId: "H-01", lineNo: "12" })).not.toBe(
      matchKeyOf(composite, { hawshaId: "H", lineNo: "0112" }),
    );
  });
});

describe("seenKeysOf", () => {
  it("computes the seen set from RAW rows, even ones that will fail validation", () => {
    const rawRows = [{ code: "H-01", name: "" }, { code: "H-02", name: "ok" }];
    expect(seenKeysOf(d, rawRows)).toEqual(new Set(["H-01", "H-02"]));
  });
});

describe("computeMatchPlan", () => {
  const existing: ExistingRow[] = [
    { id: "id-1", key: "H-01", label: "H-01" },
    { id: "id-2", key: "H-02", label: "H-02" },
  ];

  it("matches a valid row to its existing id by matchKey", () => {
    const validRows = [setSourceRow({ code: "H-01" }, 1)];
    const plan = computeMatchPlan(d, new Set(["H-01"]), validRows, existing);
    expect(plan.matchedIds.get(1)).toBe("id-1");
  });

  it("leaves an unmatched valid row absent from matchedIds (it's an insert)", () => {
    const validRows = [setSourceRow({ code: "H-03" }, 1)];
    const plan = computeMatchPlan(d, new Set(["H-03"]), validRows, existing);
    expect(plan.matchedIds.has(1)).toBe(false);
  });

  it("reports an existing row missing from the seen set as toArchive", () => {
    const plan = computeMatchPlan(d, new Set(["H-01"]), [setSourceRow({ code: "H-01" }, 1)], existing);
    expect(plan.toArchive).toEqual([{ id: "id-2", label: "H-02" }]);
  });

  it("does NOT archive a row that is present but currently invalid (protects on presence, not validity)", () => {
    // H-02 is in the file (seen) even though its row failed validation and isn't in validRows.
    const plan = computeMatchPlan(d, new Set(["H-01", "H-02"]), [setSourceRow({ code: "H-01" }, 1)], existing);
    expect(plan.toArchive).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd apps/farm-os && npx vitest run lib/import/match.test.ts`
Expected: FAIL — `./match` does not exist.

- [ ] **Step 5: Implement `match.ts`**

Create `apps/farm-os/lib/import/match.ts`:
```ts
/**
 * Reconcile-upsert matching for the import framework (SPEC-0020). Matches uploaded rows
 * against existing DB rows by `descriptor.matchKey`, so a commit updates what changed,
 * inserts what's new, and reports what's missing (for archival) — never a silent
 * duplicate or a silent delete. Pure; the DB row set is injected by the caller (route).
 */
import { getSourceRow, type ImportDescriptor } from "./types";
import { normalizeDigits } from "./validate";

const KEY_SEP = ""; // unit separator — avoids cross-field key collisions in composite keys

export function matchKeyOf(descriptor: ImportDescriptor, row: Record<string, unknown>): string {
  return (descriptor.matchKey ?? [])
    .map((k) => normalizeDigits(String(row[k] ?? "")))
    .join(KEY_SEP);
}

/** matchKey values present anywhere in the uploaded file, computed from RAW parsed rows
 * (before validation) — a row with an unrelated error must still protect its existing
 * record from being reported as missing. */
export function seenKeysOf(descriptor: ImportDescriptor, rawRows: Record<string, unknown>[]): Set<string> {
  return new Set(rawRows.map((r) => matchKeyOf(descriptor, r)));
}

export interface ExistingRow {
  id: string;
  key: string; // matchKeyOf applied to the existing row's own (fromRow-mapped) fields
  label: string; // human-readable identifier for the archive-confirmation list
}

export interface MatchPlan {
  matchedIds: Map<number, string>; // sourceRow -> existing row id (this row is an update)
  toArchive: { id: string; label: string }[]; // existing rows absent from the uploaded file
}

export function computeMatchPlan(
  descriptor: ImportDescriptor,
  seenKeys: Set<string>,
  validRows: Record<string, unknown>[],
  existing: ExistingRow[],
): MatchPlan {
  const byKey = new Map(existing.map((e) => [e.key, e.id]));
  const matchedIds = new Map<number, string>();
  validRows.forEach((row, i) => {
    const id = byKey.get(matchKeyOf(descriptor, row));
    if (id != null) matchedIds.set(getSourceRow(row, i + 1), id);
  });

  const toArchive = existing.filter((e) => !seenKeys.has(e.key)).map((e) => ({ id: e.id, label: e.label }));
  return { matchedIds, toArchive };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/farm-os && npx vitest run lib/import/match.test.ts lib/import/validate.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full existing import test suite to confirm no regression from the `types.ts` change**

Run: `cd apps/farm-os && npx vitest run lib/import`
Expected: PASS — every existing test still passes (all new `ImportDescriptor` fields are optional, `toRpcArgs`'s new param is optional).

- [ ] **Step 8: Run typecheck**

Run: `cd apps/farm-os && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
cd apps/farm-os
git add lib/import/match.ts lib/import/match.test.ts lib/import/validate.ts lib/import/types.ts
git commit -m "feat(import): reconcile-upsert matching (matchKey, archive-by-omission)"
```

---

### Task 3: Wire sectors + hawshat descriptors to prefill + upsert

**Files:**
- Modify: `apps/farm-os/lib/import/descriptors/sectors.ts`
- Modify: `apps/farm-os/lib/import/descriptors/sectors.test.ts`
- Modify: `apps/farm-os/lib/import/descriptors/hawshat.ts`
- Modify: `apps/farm-os/lib/import/descriptors/hawshat.test.ts`

**Interfaces:**
- Consumes: `ImportDescriptor` extended shape from Task 2.
- Produces: `sectorsDescriptor`/`hawshatDescriptor` now carry `table`, `archiveType`, `matchKey`, `fromRow`, and an updated `toRpcArgs(row, matchedId)`. Task 4 (lines) and Task 5 (route) follow this exact pattern.

- [ ] **Step 1: Write the failing tests for `sectorsDescriptor`**

In `apps/farm-os/lib/import/descriptors/sectors.test.ts`, update the existing `toRpcArgs` test and add new ones:
```ts
it("maps a validated + ref-resolved row to the fn_save_sector INSERT arg shape when unmatched", () => {
  const row = { farmId: "farm-uuid", name: "القطاع الشمالي", code: "S-01", areaFeddan: 12.5 };
  expect(sectorsDescriptor.toRpcArgs(row, null)).toMatchObject({ p_id: null, p_code: "S-01" });
});

it("maps to the fn_save_sector UPDATE arg shape when matched", () => {
  const row = { farmId: "farm-uuid", name: "القطاع الشمالي", code: "S-01", areaFeddan: 12.5 };
  expect(sectorsDescriptor.toRpcArgs(row, "existing-id")).toMatchObject({ p_id: "existing-id" });
});

it("declares table, archiveType, and matchKey for reconcile-upsert", () => {
  expect(sectorsDescriptor.table).toBe("sectors");
  expect(sectorsDescriptor.archiveType).toBe("sector");
  expect(sectorsDescriptor.matchKey).toEqual(["code"]);
});

it("fromRow maps a DB row back to column-key-shaped values (ref column still holds the id)", () => {
  const dbRow = { farm_id: "farm-uuid", name: "القطاع الشمالي", code: "S-01", crop: null, area_feddan: 12.5, planting_date: null, notes: null };
  expect(sectorsDescriptor.fromRow?.(dbRow)).toEqual({
    farmId: "farm-uuid", name: "القطاع الشمالي", code: "S-01", crop: "", areaFeddan: 12.5, plantingDate: "", notes: "",
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/farm-os && npx vitest run lib/import/descriptors/sectors.test.ts`
Expected: FAIL — `table`/`archiveType`/`matchKey`/`fromRow` are undefined; `toRpcArgs(row, null)` still returns `p_id: null` (that part already passes) but `toRpcArgs(row, "existing-id")` still returns `p_id: null` (fails).

- [ ] **Step 3: Update `sectors.ts`**

```ts
export const sectorsDescriptor: ImportDescriptor = {
  key: "sectors",
  titleAr: "القطاعات",
  rpc: "fn_save_sector",
  role: "structure.write",
  table: "sectors",
  archiveType: "sector",
  matchKey: ["code"],
  columns: [
    // ...unchanged...
  ],
  fromRow: (r) => ({
    farmId: r.farm_id,
    name: r.name,
    code: r.code,
    crop: r.crop ?? "",
    areaFeddan: r.area_feddan ?? "",
    plantingDate: r.planting_date ?? "",
    notes: r.notes ?? "",
  }),
  toRpcArgs: (r, matchedId) => ({
    p_id: matchedId ?? null,
    p_farm_id: r.farmId,
    p_name: r.name,
    p_code: r.code,
    p_crop: r.crop ?? null,
    p_area_feddan: r.areaFeddan ?? null,
    p_planting_date: r.plantingDate ?? null,
    p_notes: r.notes ?? null,
  }),
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/farm-os && npx vitest run lib/import/descriptors/sectors.test.ts`
Expected: PASS.

- [ ] **Step 5: Repeat steps 1-4 for `hawshat.ts`**

Update `hawshat.test.ts` the same way (adjust field names/values to hawshat's own columns: `sectorId`, `name`, `code`, `areaQirat`, `rowCount`, `palmCountBarhi`, `palmCountMale`, `plantingDate`, `notes`), then update `hawshat.ts`:
```ts
export const hawshatDescriptor: ImportDescriptor = {
  key: "hawshat",
  titleAr: "الأحواش",
  rpc: "fn_save_hawsha",
  role: "structure.write",
  table: "hawshat",
  archiveType: "hawsha",
  matchKey: ["code"],
  columns: [
    // ...unchanged...
  ],
  fromRow: (r) => ({
    sectorId: r.sector_id,
    name: r.name,
    code: r.code,
    areaQirat: r.area_qirat ?? "",
    rowCount: r.row_count ?? "",
    palmCountBarhi: r.palm_count_barhi ?? "",
    palmCountMale: r.palm_count_male ?? "",
    plantingDate: r.planting_date ?? "",
    notes: r.notes ?? "",
  }),
  toRpcArgs: (r, matchedId) => ({
    p_id: matchedId ?? null,
    p_sector_id: r.sectorId,
    p_name: r.name,
    p_code: r.code,
    p_area_qirat: r.areaQirat ?? null,
    p_row_count: r.rowCount ?? null,
    p_palm_count_barhi: r.palmCountBarhi ?? null,
    p_palm_count_male: r.palmCountMale ?? null,
    p_planting_date: r.plantingDate ?? null,
    p_notes: r.notes ?? null,
  }),
};
```

Run: `cd apps/farm-os && npx vitest run lib/import/descriptors/hawshat.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full import suite + typecheck**

Run: `cd apps/farm-os && npx vitest run lib/import && npx tsc --noEmit`
Expected: PASS, no new type errors.

- [ ] **Step 7: Commit**

```bash
cd apps/farm-os
git add lib/import/descriptors/sectors.ts lib/import/descriptors/sectors.test.ts lib/import/descriptors/hawshat.ts lib/import/descriptors/hawshat.test.ts
git commit -m "feat(import): wire sectors + hawshat descriptors to prefill + reconcile-upsert"
```

---

### Task 4: `lines` descriptor + its uniqueness migration

**Files:**
- Create: `apps/farm-os/lib/import/descriptors/lines.ts`
- Create: `apps/farm-os/lib/import/descriptors/lines.test.ts`
- Modify: `apps/farm-os/lib/import/descriptors/index.ts`
- Modify: `apps/farm-os/lib/import/importable-rpcs.ts`
- Create: `apps/farm-os/supabase/migrations/20260701220000_lines_lineno_uniq.sql`
- Create: `apps/farm-os/supabase/tests/112_lines_lineno_uniq_test.sql` (next free test number — confirm via `ls apps/farm-os/supabase/tests | sort -t_ -k1 -n | tail -3` before naming; adjust if `111` isn't the latest)

**Interfaces:**
- Consumes: `ImportDescriptor` shape from Task 2; `RefSpec` from `./types`.
- Produces: `linesDescriptor` registered in `ALL_DESCRIPTORS`; `IMPORTABLE_RPCS` includes `fn_save_line`. Task 5 (route) and Task 6 (UI) can mount `descriptorKey="lines"`.

- [ ] **Step 1: Confirm the next free pgTAP test number**

Run: `cd apps/farm-os && ls supabase/tests | sort -t_ -k1 -n | tail -3`
Use the next integer after the highest existing one for the new test file's prefix.

- [ ] **Step 2: Write the failing tests for `linesDescriptor`**

Create `apps/farm-os/lib/import/descriptors/lines.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { linesDescriptor } from "./lines";
import { validateRows } from "../validate";

describe("linesDescriptor", () => {
  it("maps a validated + ref-resolved row to the fn_save_line INSERT arg shape when unmatched", () => {
    const row = { hawshaId: "hawsha-uuid", lineNo: 1, lineCode: "L-01", palmCount: 52 };
    expect(linesDescriptor.toRpcArgs(row, null)).toEqual({
      p_id: null, p_hawsha_id: "hawsha-uuid", p_line_no: 1, p_line_code: "L-01",
      p_palm_count: 52, p_direction: null, p_notes: null,
    });
  });

  it("maps to the UPDATE arg shape when matched", () => {
    const row = { hawshaId: "hawsha-uuid", lineNo: 1 };
    expect(linesDescriptor.toRpcArgs(row, "existing-id")).toMatchObject({ p_id: "existing-id" });
  });

  it("coerces numeric columns and requires hawsha code + line number", () => {
    const { okRows, errors } = validateRows(linesDescriptor, [
      { hawshaId: "H-01", lineNo: "1", palmCount: "52" },
      { hawshaId: "", lineNo: "" },
    ]);
    expect(okRows[0]).toMatchObject({ lineNo: 1, palmCount: 52 });
    expect(errors.map((e) => e.column).sort()).toEqual(["hawshaId", "lineNo"]);
  });

  it("declares hawshaId as a ref to hawshat.code, and matchKey as [hawshaId, lineNo]", () => {
    const col = linesDescriptor.columns.find((c) => c.key === "hawshaId");
    expect(col?.ref).toEqual({ table: "hawshat", codeColumn: "code", activeColumn: "archived", activeValue: false });
    expect(linesDescriptor.matchKey).toEqual(["hawshaId", "lineNo"]);
    expect(linesDescriptor.table).toBe("lines");
    expect(linesDescriptor.archiveType).toBe("line");
  });

  it("fromRow maps a DB row back to column-key-shaped values", () => {
    const dbRow = { hawsha_id: "hawsha-uuid", line_no: 1, line_code: null, palm_count: 52, direction: null, notes: null };
    expect(linesDescriptor.fromRow?.(dbRow)).toEqual({
      hawshaId: "hawsha-uuid", lineNo: 1, lineCode: "", palmCount: 52, direction: "", notes: "",
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/farm-os && npx vitest run lib/import/descriptors/lines.test.ts`
Expected: FAIL — `./lines` does not exist.

- [ ] **Step 4: Implement `lines.ts`**

Create `apps/farm-os/lib/import/descriptors/lines.ts`:
```ts
/**
 * Import descriptor for hawsha lines (خطوط). Writes through `fn_save_line` (gate:
 * structure.write, enforced in the DB). The parent hawsha is given by its CODE, resolved
 * to hawsha_id via the ref lookup (RLS-scoped). matchKey is [hawshaId, lineNo] rather than
 * lineCode — line_code is optional/nullable so it can't anchor a match, but line_no is
 * required and stable (SPEC-0020).
 */
import type { ImportDescriptor } from "../types";

export const linesDescriptor: ImportDescriptor = {
  key: "lines",
  titleAr: "الخطوط",
  rpc: "fn_save_line",
  role: "structure.write",
  table: "lines",
  archiveType: "line",
  matchKey: ["hawshaId", "lineNo"],
  columns: [
    { key: "hawshaId", labelAr: "كود الحوش", type: "string", required: true, example: "H-01", ref: { table: "hawshat", codeColumn: "code", activeColumn: "archived", activeValue: false } },
    { key: "lineNo", labelAr: "رقم الخط", type: "int", required: true, example: "1" },
    { key: "lineCode", labelAr: "كود الخط", type: "string", required: false, example: "" },
    { key: "palmCount", labelAr: "عدد النخيل", type: "int", required: false, example: "52" },
    { key: "direction", labelAr: "الاتجاه", type: "string", required: false, example: "" },
    { key: "notes", labelAr: "ملاحظات", type: "string", required: false, example: "" },
  ],
  fromRow: (r) => ({
    hawshaId: r.hawsha_id,
    lineNo: r.line_no,
    lineCode: r.line_code ?? "",
    palmCount: r.palm_count ?? "",
    direction: r.direction ?? "",
    notes: r.notes ?? "",
  }),
  toRpcArgs: (r, matchedId) => ({
    p_id: matchedId ?? null,
    p_hawsha_id: r.hawshaId,
    p_line_no: r.lineNo,
    p_line_code: r.lineCode || null,
    p_palm_count: r.palmCount ?? null,
    p_direction: r.direction || null,
    p_notes: r.notes ?? null,
  }),
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/farm-os && npx vitest run lib/import/descriptors/lines.test.ts`
Expected: PASS.

- [ ] **Step 6: Register the descriptor**

In `apps/farm-os/lib/import/descriptors/index.ts`:
```ts
import { registerDescriptor } from "../registry";
import { sectorsDescriptor } from "./sectors";
import { hawshatDescriptor } from "./hawshat";
import { linesDescriptor } from "./lines";

export const ALL_DESCRIPTORS = [sectorsDescriptor, hawshatDescriptor, linesDescriptor];

for (const d of ALL_DESCRIPTORS) registerDescriptor(d);
```

In `apps/farm-os/lib/import/importable-rpcs.ts`:
```ts
export const IMPORTABLE_RPCS: readonly string[] = ["fn_save_sector", "fn_save_hawsha", "fn_save_line"];
```

- [ ] **Step 7: Run the convention + registry tests**

Run: `cd apps/farm-os && npx vitest run lib/import/convention.test.ts lib/import/registry.test.ts`
Expected: PASS (the convention test asserts every `IMPORTABLE_RPCS` entry has a registered descriptor — `fn_save_line` now does).

> **Correction (implementation-time finding):** `lines(hawsha_id, line_no)` already has a
> partial unique active index — `lines_hawsha_lineno_uniq`, created by
> `20260622000080_structure_soft_delete_audit.sql` for an unrelated reason (cascading
> soft-delete), and already exercised by `supabase/tests/82_structure_crud_test.sql`. Steps
> 8-10 below (a new migration + new pgTAP test) are **skipped** — the guarantee this task
> needed already exists under a different name/date. Nothing to implement.

- [ ] **Step 8: Write the migration** (skipped — see correction above)

Create `apps/farm-os/supabase/migrations/20260701220000_lines_lineno_uniq.sql`:
```sql
-- Farm OS — bulk-import idempotency backstop for lines (SPEC-0020), mirroring the
-- sectors/hawshat backstop in 20260701150000.
--
-- The new lines import descriptor matches an uploaded row to an existing line by
-- (hawsha_id, line_no) to decide update-vs-insert. Without a DB-level uniqueness
-- guarantee, a duplicate active (hawsha_id, line_no) could exist, making that match
-- ambiguous. FIX: a partial unique index on (hawsha_id, line_no) for ACTIVE
-- (non-archived) rows. Archived rows are excluded so a line number can be reused after
-- archiving, same rationale as the sectors/hawshat index.
-- Validation: pgTAP <NNN> (index present, unique + partial); authoritative check is
-- prod apply. Rollback: drop the index.

create unique index if not exists lines_hawsha_lineno_active_uniq
  on public.lines (hawsha_id, line_no) where archived is not true;
```

- [ ] **Step 9: Write the pgTAP test**

Create `apps/farm-os/supabase/tests/<NNN>_lines_lineno_uniq_test.sql` (use the number from Step 1), following the exact structure of the existing `106` test for sectors/hawshat (read it first: `cat apps/farm-os/supabase/tests/106_*.sql`) — mirror its `has_index`/uniqueness-rejection assertions, retargeted to `public.lines (hawsha_id, line_no)`.

- [ ] **Step 10: Run the local pgTAP harness**

Run: `bash apps/farm-os/supabase/test-shims/run-pgtap-local.sh`
Expected: exit 0, all tests pass including the new one. (Do not apply this migration to prod — Owner-gated.)

- [ ] **Step 11: Commit**

```bash
cd apps/farm-os
git add lib/import/descriptors/lines.ts lib/import/descriptors/lines.test.ts lib/import/descriptors/index.ts lib/import/importable-rpcs.ts supabase/migrations/20260701220000_lines_lineno_uniq.sql supabase/tests/
git commit -m "feat(import): lines descriptor + hawsha_id/line_no uniqueness migration"
```

---

### Task 5: Route wiring — prefill on GET, reconcile-upsert + archive on POST

**Files:**
- Modify: `apps/farm-os/lib/import/xlsx.ts`
- Modify: `apps/farm-os/lib/import/xlsx.test.ts`
- Modify: `apps/farm-os/app/api/import/route.ts`

**Interfaces:**
- Consumes: `reverseResolveRefs`/`ReverseRefLookup` (Task 1), `seenKeysOf`/`computeMatchPlan`/`ExistingRow` (Task 2), descriptor `table`/`archiveType`/`fromRow`/`matchKey` (Tasks 3-4).
- Produces: `generateTemplate(descriptor, existingRows?)`; POST response shape `{ okCount, errorCount, errors, toInsert, toUpdate, toArchive }` for dry-run and `{ written, failed, archived, skipped, validationErrors, failures }` for commit. Task 6 (UI) consumes these exact field names.

- [ ] **Step 1: Write the failing test for `generateTemplate` accepting existing rows**

Add to `apps/farm-os/lib/import/xlsx.test.ts` (read the existing file first for its exact mocking pattern, then follow it):
```ts
it("passes existingRows through to buildTemplateSpec so the data sheet is pre-filled", async () => {
  const buf = await generateTemplate(sampleDescriptor, [{ name: "أحمد", kind: "a" }]);
  const parsed = await parseUpload(buf, sampleDescriptor);
  expect(parsed).toEqual([{ name: "أحمد", kind: "a" }]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/farm-os && npx vitest run lib/import/xlsx.test.ts`
Expected: FAIL — `generateTemplate` doesn't accept a second argument (template comes back header-only).

- [ ] **Step 3: Update `generateTemplate` in `xlsx.ts`**

```ts
export async function generateTemplate(
  d: ImportDescriptor,
  existingRows: Record<string, unknown>[] = [],
): Promise<Buffer> {
  return renderWorkbook(buildTemplateSpec(d, existingRows));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/farm-os && npx vitest run lib/import/xlsx.test.ts`
Expected: PASS.

- [ ] **Step 5: Read the current route file in full before editing**

Run: `cat apps/farm-os/app/api/import/route.ts` (already shown above in this session — re-read to keep line numbers accurate before patching, since the diff below is described, not line-numbered).

- [ ] **Step 6: Add a shared "fetch existing rows" helper + wire the GET handler**

In `app/api/import/route.ts`, add near the top (after existing imports) a helper used by both GET and POST:
```ts
import { reverseResolveRefs, type ReverseRefLookup } from "@/lib/import/resolve";
import { seenKeysOf, computeMatchPlan, type ExistingRow } from "@/lib/import/match";

/** Fetch a descriptor's current active rows (RLS-scoped), mapped through fromRow +
 * reverseResolveRefs (ref columns shown as their human code). Returns both the display
 * row (for the template / archive label) and its id (for matching). No-op ([]) for a
 * descriptor that hasn't opted into table/fromRow. */
async function fetchExistingRows(
  descriptor: ImportDescriptor,
  sb: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<{ id: string; row: Record<string, unknown> }[]> {
  if (!descriptor.table || !descriptor.fromRow) return [];
  const { data, error } = await sb.from(descriptor.table).select("*").eq("org_id", orgId).eq("archived", false);
  if (error) throw error;

  const mapped = (data ?? []).map((r) => ({ id: String(r.id), row: descriptor.fromRow!(r) }));
  const reverseLookup: ReverseRefLookup = async (spec, ids) => {
    const { data: refData, error: refError } = await sb
      .from(spec.table)
      .select(`${spec.idColumn},${spec.codeColumn}`)
      .in(spec.idColumn, ids)
      .eq("org_id", orgId);
    if (refError) throw refError;
    return new Map((refData ?? []).map((r) => [String(r[spec.idColumn]), String(r[spec.codeColumn])]));
  };
  const displayRows = await reverseResolveRefs(descriptor, mapped.map((m) => m.row), reverseLookup);
  return mapped.map((m, i) => ({ id: m.id, row: displayRows[i] }));
}
```

Replace the GET handler body (keep the auth/descriptor-lookup lines unchanged) so it fetches existing rows before generating the template:
```ts
export async function GET(req: Request): Promise<Response> {
  const member = await getActiveMembership();
  if (!member) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const descriptor = getDescriptor(new URL(req.url).searchParams.get("descriptor") ?? "");
  if (!descriptor) return NextResponse.json({ error: "نوع استيراد غير معروف" }, { status: 400 });

  const sb = await createClient();
  const existing = await fetchExistingRows(descriptor, sb, member.orgId);
  const buf = await generateTemplate(descriptor, existing.map((e) => e.row));
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${descriptor.key}-template.xlsx"`,
    },
  });
}
```

- [ ] **Step 7: Wire matching + archive into the POST handler**

After the existing `resolveRefs` block (which produces `resolved.rows` = valid, ref-resolved rows) and before the `mode !== "commit"` early return, insert:
```ts
  const existing = await fetchExistingRows(descriptor, sb, member.orgId);
  const existingForMatch: ExistingRow[] = existing.map((e) => ({
    id: e.id,
    key: matchKeyOf(descriptor, e.row),
    label: (descriptor.matchKey ?? []).map((k) => String(e.row[k] ?? "")).join(" "),
  }));
  const seenKeys = seenKeysOf(descriptor, rows); // `rows` = raw parseUpload output, pre-validation
  const matchPlan = computeMatchPlan(descriptor, seenKeys, resolved.rows, existingForMatch);
```

`matchPlan.matchedIds` is keyed by source row and holds at most one entry per valid row, so the insert count is simply the difference — no per-row helper needed:

```ts
  const toInsert = resolved.rows.length - matchPlan.matchedIds.size;
```

Change the dry-run response to:
```ts
  if (mode !== "commit") {
    return NextResponse.json({
      okCount: resolved.rows.length,
      errorCount,
      errors,
      toInsert: resolved.rows.length - matchPlan.matchedIds.size,
      toUpdate: matchPlan.matchedIds.size,
      toArchive: matchPlan.toArchive,
    });
  }
```

For commit, require confirmation before archiving anything, then execute the plan (insert/update via existing per-row loop, using `matchPlan.matchedIds.get(call.sourceRow) ?? null` as the row's `matchedId` when building `call.args` — this means `commit-plan.ts`'s `planCommit` needs the matched id available per row; thread it through by building the calls directly in the route instead of via `planCommit`'s `toRpcArgs(row)` one-arg call, OR extend `planCommit` to accept a `matchedIds: Map<number, string>` param and pass it to `toRpcArgs`. Prefer extending `planCommit` — smaller, keeps orchestration centralized):

```ts
  if (matchPlan.toArchive.length > 0 && String(form.get("confirmArchive") ?? "") !== "true") {
    return NextResponse.json(
      { error: "يوجد صفوف سيتم أرشفتها — يلزم تأكيد صريح.", toArchive: matchPlan.toArchive },
      { status: 409 },
    );
  }

  const plan = planCommit(descriptor, resolved.rows, { matchedIds: matchPlan.matchedIds });
  // ...existing insert/update loop over plan.calls unchanged...

  const archived: string[] = [];
  const archiveFailures: { label: string; error: string }[] = [];
  if (descriptor.archiveType) {
    for (const a of matchPlan.toArchive) {
      try {
        const { error } = await rpc("fn_archive_structure", { p_type: descriptor.archiveType, p_id: a.id, p_archived: true });
        if (error) archiveFailures.push({ label: a.label, error: toArabicError(error) });
        else archived.push(a.label);
      } catch {
        archiveFailures.push({ label: a.label, error: "تعذّر تنفيذ الأرشفة لهذا الصف. حاول مرة أخرى." });
      }
    }
  }

  return NextResponse.json({
    written, failed: failures.length, skipped: plan.skipped,
    archived, archiveFailures,
    validationErrors: errors, failures,
  });
```

- [ ] **Step 8: Extend `planCommit` (`commit-plan.ts`) to accept `matchedIds`**

Update `apps/farm-os/lib/import/commit-plan.ts`:
```ts
export function planCommit(
  descriptor: ImportDescriptor,
  okRows: Record<string, unknown>[],
  opts: { chunkSize?: number; matchedIds?: Map<number, string> } = {},
): CommitPlan {
  const chunkSize = opts.chunkSize && opts.chunkSize > 0 ? opts.chunkSize : DEFAULT_CHUNK;
  const dedupe = descriptor.dedupeKey ?? [];
  const matchedIds = opts.matchedIds ?? new Map<number, string>();

  const calls: RpcCall[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const seen = new Set<string>();

  okRows.forEach((row, i) => {
    const rowNum = getSourceRow(row, i + 1);
    if (dedupe.length > 0) {
      const key = dedupe.map((k) => String(row[k] ?? "")).join(KEY_SEP);
      if (seen.has(key)) {
        skipped.push({ row: rowNum, reason: "صف مكرر" });
        return;
      }
      seen.add(key);
    }
    calls.push({ rpc: descriptor.rpc, args: descriptor.toRpcArgs(row, matchedIds.get(rowNum) ?? null), sourceRow: rowNum });
  });

  const chunks: RpcCall[][] = [];
  for (let i = 0; i < calls.length; i += chunkSize) chunks.push(calls.slice(i, i + chunkSize));

  return { calls, skipped, chunks };
}
```

Add a test to `commit-plan.test.ts`:
```ts
it("passes the matched existing id into toRpcArgs as the second argument (update, not insert)", () => {
  const spy: ImportDescriptor = { ...base, toRpcArgs: (r, matchedId) => ({ p_name: r.name, p_id: matchedId ?? null }) };
  const plan = planCommit(spy, [setSourceRow({ name: "أحمد" }, 1)], { matchedIds: new Map([[1, "existing-id"]]) });
  expect(plan.calls[0].args).toEqual({ p_name: "أحمد", p_id: "existing-id" });
});
```

- [ ] **Step 9: Run the full import unit suite + typecheck**

Run: `cd apps/farm-os && npx vitest run lib/import && npx tsc --noEmit`
Expected: PASS, no new errors.

- [ ] **Step 10: Manual integration smoke test (documented, not automated — the route needs a live Supabase session)**

Note in the PR description: this route change needs a manual smoke test against local Supabase (per `farm-os` skill's local dev flow) before merge — download a sectors template, confirm existing rows appear, edit one, add one, remove one, re-upload, confirm the dry-run reports 1 update / 1 insert / 1 archive, and that commit is rejected without `confirmArchive`.

- [ ] **Step 11: Commit**

```bash
cd apps/farm-os
git add lib/import/xlsx.ts lib/import/xlsx.test.ts lib/import/commit-plan.ts lib/import/commit-plan.test.ts app/api/import/route.ts
git commit -m "feat(import): wire prefill + reconcile-upsert into the /api/import route"
```

---

### Task 6: `ImportPanel` UI — counts, archive list, confirmation gate

**Files:**
- Modify: `apps/farm-os/components/import/ImportPanel.tsx`

**Interfaces:**
- Consumes: dry-run response `{ okCount, errorCount, errors, toInsert, toUpdate, toArchive }` and commit response `{ written, failed, archived, archiveFailures, skipped, failures }` from Task 5.
- Produces: no new exports — same `ImportPanel({ descriptorKey, titleAr })` component signature Task 7 mounts.

- [ ] **Step 1: Update the component's response types + state**

In `ImportPanel.tsx`, extend the interfaces:
```ts
interface DryRunResult {
  okCount: number;
  errorCount: number;
  errors: { row: number; column: string; reason: string }[];
  toInsert: number;
  toUpdate: number;
  toArchive: { id: string; label: string }[];
}
interface CommitResult {
  written: number;
  failed: number;
  skipped: { row: number; reason: string }[];
  failures: { row: number; error: string }[];
  archived: string[];
  archiveFailures: { label: string; error: string }[];
}
```

Add one new piece of state below the existing `useState` calls:
```ts
const [confirmArchive, setConfirmArchive] = useState(false);
```

Reset it alongside the other reset points (the `onChange` handler's `setDry(null); setDone(null); setError(null);` and at the top of `send`): add `setConfirmArchive(false)` in the file-change handler (a new file means a new dry-run, so any prior confirmation must not carry over).

- [ ] **Step 2: Send `confirmArchive` on commit**

In `send`, when `mode === "commit"`, add the form field:
```ts
if (mode === "commit") fd.set("confirmArchive", String(confirmArchive));
```

- [ ] **Step 3: Render the new counts + archive confirmation**

Replace the dry-run results block with:
```tsx
{dry && (
  <div className="text-sm">
    <p>
      جديد: {num(dry.toInsert)} · تحديث: {num(dry.toUpdate)} · سيُؤرشف: {num(dry.toArchive.length)} ·
      أخطاء: {num(dry.errorCount)}
    </p>
    {dry.errors.length > 0 && (
      <ul className="mt-1 list-disc pe-5">
        {dry.errors.map((e) => (
          <li key={`${e.row}-${e.column}`}>
            صف {num(e.row)} — {e.column}: {e.reason}
          </li>
        ))}
      </ul>
    )}
    {dry.toArchive.length > 0 && (
      <div className="mt-2 rounded border border-amber-400 bg-amber-50 p-2">
        <p className="font-medium">سيتم أرشفة هذه العناصر لأنها غير موجودة في الملف:</p>
        <ul className="mt-1 list-disc pe-5">
          {dry.toArchive.map((a) => (
            <li key={a.id}>{a.label}</li>
          ))}
        </ul>
        <label className="mt-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={confirmArchive}
            onChange={(e) => setConfirmArchive(e.target.checked)}
          />
          أفهم أن العناصر أعلاه سيتم أرشفتها
        </label>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: Gate the commit button on the archive confirmation**

Update the commit button's `disabled` expression:
```tsx
<button
  type="button"
  className={BTN}
  disabled={
    !file || busy || !dry || dry.errorCount > 0 || (dry.toArchive.length > 0 && !confirmArchive)
  }
  onClick={() => send("commit")}
>
  استيراد
</button>
```

- [ ] **Step 5: Render archive results after commit**

Add below the existing `done.skipped` block:
```tsx
{done.archived.length > 0 && (
  <p className="mt-1 text-gray-600">تمت أرشفة: {done.archived.join("، ")}</p>
)}
{done.archiveFailures.length > 0 && (
  <ul className="mt-1 list-disc pe-5 text-red-600">
    {done.archiveFailures.map((f) => (
      <li key={`archive-fail-${f.label}`}>{f.label} — {f.error}</li>
    ))}
  </ul>
)}
```

- [ ] **Step 6: Typecheck + lint the touched file**

Run: `cd apps/farm-os && npx tsc --noEmit && npx eslint components/import/ImportPanel.tsx`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
cd apps/farm-os
git add components/import/ImportPanel.tsx
git commit -m "feat(import): ImportPanel shows insert/update/archive counts + archive confirmation gate"
```

---

### Task 7: Mount `ImportPanel` on the farm-structure page

**Files:**
- Modify: `apps/farm-os/app/(app)/farm/page.tsx`

**Interfaces:**
- Consumes: `ImportPanel` from `@/components/import/ImportPanel` (Task 6); `canEditStructure` boolean already computed in this file.

- [ ] **Step 1: Import the component**

Add near the top of `app/(app)/farm/page.tsx`:
```ts
import { ImportPanel } from "@/components/import/ImportPanel";
```

- [ ] **Step 2: Mount three panels, gated the same way as `StructureForm`**

Immediately after the existing `{canEditStructure && farm?.id && (<StructureForm .../>)}` block, add:
```tsx
{canEditStructure && (
  <Card title="استيراد بيانات الهيكل">
    <div className="space-y-4">
      <ImportPanel descriptorKey="sectors" titleAr="القطاعات" />
      <ImportPanel descriptorKey="hawshat" titleAr="الأحواش" />
      <ImportPanel descriptorKey="lines" titleAr="الخطوط" />
    </div>
  </Card>
)}
```

(`Card` is already imported at the top of this file from `@/components/ui`.)

- [ ] **Step 3: Typecheck + build**

Run: `cd apps/farm-os && npx tsc --noEmit && npm run build`
Expected: clean typecheck; build succeeds (confirms the lazy `exceljs` import stays a separate chunk — check the build output doesn't flag a new large synchronous chunk for this route).

- [ ] **Step 4: Manual smoke test (documented)**

Note in the PR description: start the app locally against local Supabase, sign in as `owner`/`farm_manager`, visit `/farm`, confirm the three import panels render and "تنزيل القالب" downloads a template (empty is fine on a fresh seed — full prefill smoke test is Task 5 Step 10's job against real data).

- [ ] **Step 5: Commit**

```bash
cd apps/farm-os
git add "app/(app)/farm/page.tsx"
git commit -m "feat(import): mount sectors/hawshat/lines ImportPanel on the farm structure page"
```

---

## After all tasks

Run the full validation sweep before reporting done:
```bash
cd apps/farm-os
npx tsc --noEmit
npx eslint lib/import components/import "app/(app)/farm/page.tsx" app/api/import
npx vitest run
npm run build
bash supabase/test-shims/run-pgtap-local.sh
```
Per the operating method: **stop here.** Do not push, open a PR, or apply the migration — report the diff, validation results, and wait for the Owner's go-ahead.
