export interface ParsedExecuteInput {
  actualQty: number;
  laborCount: number;
}

/**
 * One material's parsed actual, for a multi-material operation (#520). Keyed by `requirementId` (=
 * the plan_material_requirements row's own `id`), NOT `itemId` — an operation can legitimately carry
 * two separate requirement rows for the SAME item (e.g. two applications of the same fertilizer on
 * different sub-dates), so item_id alone cannot tell rows apart. `itemId` is still carried through
 * for debuggability/display, but `requirementId` is the field the RPC uses to match this actual back
 * to its planned requirement row.
 */
export interface ParsedMaterialActual {
  requirementId: string;
  itemId: string;
  actualQty: number;
}

export interface ParsedMultiMaterialInput {
  materialActuals: ParsedMaterialActual[];
  laborCount: number;
}

const INVALID_EXECUTE_INPUT = "أدخل الكمية وعدد العمال قبل إنهاء العملية.";
const INVALID_MATERIAL_INPUT = "أدخل كمية صالحة لكل خامة وعدد العمال قبل إنهاء العملية.";

/** Per-field messages (F7). Keyed so the form can mark the offending FormRow, not just a banner. */
const FIELD_QTY_INVALID = "أدخل كمية صالحة.";
export const FIELD_LABOR_INVALID = "أدخل عدد عمال صالح.";

/**
 * Field-keyed validation errors returned alongside the banner-summary `error`. Keys are the same
 * ids the form gives its FormRows: `"qty"` (single-material), each material's `requirementId`
 * (multi-material), and `"labor"`. The form threads each into `FormRow error=` so the DS marks the
 * exact control `aria-invalid` (F7) instead of showing a banner alone. The `error` summary stays for
 * a11y announcement / any consumer that only wants one message.
 */
export type ExecuteFieldErrors = Record<string, string>;

function parseNonBlankNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

// Labor is OPTIONAL (SPEC-0030 flow audit A2): a labor-less op (a فحص inspection walk-through) should not force
// a fabricated crew count. Blank ⇒ 0 ("no crew"); a provided value must still be a non-negative number.
export function parseLaborCount(labor: string): number | null {
  if (labor.trim() === "") return 0;
  return parseNonBlankNumber(labor);
}

export function parseExecuteInput(qty: string, labor: string):
  | { ok: true; value: ParsedExecuteInput }
  | { ok: false; error: string; fieldErrors: ExecuteFieldErrors } {
  const actualQty = parseNonBlankNumber(qty);
  const laborCount = parseLaborCount(labor);

  if (actualQty == null || laborCount == null) {
    const fieldErrors: ExecuteFieldErrors = {};
    if (actualQty == null) fieldErrors.qty = FIELD_QTY_INVALID;
    if (laborCount == null) fieldErrors.labor = FIELD_LABOR_INVALID;
    return { ok: false, error: INVALID_EXECUTE_INPUT, fieldErrors };
  }

  return { ok: true, value: { actualQty, laborCount } };
}

/**
 * Parse the per-material actual quantities for a >1-material operation (#520 — ExecuteForm renders
 * one field per material instead of the single scalar field). Same blank/negative rejection rules as
 * parseExecuteInput, applied to every material line plus the shared labor field.
 */
export function parseMaterialActuals(
  entries: { requirementId: string; itemId: string; qty: string }[],
  labor: string,
):
  | { ok: true; value: ParsedMultiMaterialInput }
  | { ok: false; error: string; fieldErrors: ExecuteFieldErrors } {
  // Collect ALL offending fields (not just the first) so the form can mark every bad control at once
  // rather than making the user fix-and-resubmit one field at a time.
  const fieldErrors: ExecuteFieldErrors = {};
  const laborCount = parseLaborCount(labor);
  if (laborCount == null) fieldErrors.labor = FIELD_LABOR_INVALID;

  const materialActuals: ParsedMaterialActual[] = [];
  for (const entry of entries) {
    const actualQty = parseNonBlankNumber(entry.qty);
    if (actualQty == null) {
      fieldErrors[entry.requirementId] = FIELD_QTY_INVALID;
      continue;
    }
    materialActuals.push({ requirementId: entry.requirementId, itemId: entry.itemId, actualQty });
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: INVALID_MATERIAL_INPUT, fieldErrors };
  }

  return { ok: true, value: { materialActuals, laborCount: laborCount as number } };
}
