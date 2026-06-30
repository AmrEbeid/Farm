export interface ParsedExecuteInput {
  actualQty: number;
  laborCount: number;
}

const INVALID_EXECUTE_INPUT = "أدخل الكمية وعدد العمال قبل إنهاء العملية.";

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
