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

function parseNonBlankNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseExecuteInput(qty: string, labor: string):
  | { ok: true; value: ParsedExecuteInput }
  | { ok: false; error: string } {
  const actualQty = parseNonBlankNumber(qty);
  const laborCount = parseNonBlankNumber(labor);

  if (actualQty == null || laborCount == null) {
    return { ok: false, error: INVALID_EXECUTE_INPUT };
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
  | { ok: false; error: string } {
  const laborCount = parseNonBlankNumber(labor);
  if (laborCount == null) {
    return { ok: false, error: INVALID_MATERIAL_INPUT };
  }

  const materialActuals: ParsedMaterialActual[] = [];
  for (const entry of entries) {
    const actualQty = parseNonBlankNumber(entry.qty);
    if (actualQty == null) {
      return { ok: false, error: INVALID_MATERIAL_INPUT };
    }
    materialActuals.push({ requirementId: entry.requirementId, itemId: entry.itemId, actualQty });
  }

  return { ok: true, value: { materialActuals, laborCount } };
}
