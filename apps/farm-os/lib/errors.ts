/**
 * Field-safe Arabic error mapping (non-negotiable #2).
 *
 * A DB-raised error must NEVER leak a raw English Postgres/PostgREST message to a
 * field user. Every server action that calls an RPC or writes through PostgREST runs
 * its error through `toArabicError`, which maps the SQLSTATE to a known Arabic message
 * and otherwise returns a generic Arabic fallback — it never returns `error.message`.
 *
 * This centralizes the per-code mapping that `executeOperation`, `recordReceipt`, and
 * `reserveStock` each carried inline, so the messages stay consistent across actions.
 * Callers may pass `overrides` for a more context-specific phrase (e.g. "صلاحية حجز
 * المخزون" vs the generic permission message) and a custom `fallback`.
 */

/** The minimal shape we read off a Supabase/PostgREST error (PostgrestError-compatible). */
export interface DbError {
  code?: string | null;
  message?: string;
}

/** Generic, field-safe fallback used when no specific mapping applies. */
export const GENERIC_AR_ERROR = "تعذّر تنفيذ العملية. حاول مرة أخرى.";

/**
 * Default SQLSTATE → Arabic mapping. Codes that recur across the stock/PR/plan write
 * paths. Anything not listed falls through to the (Arabic) fallback — never to raw English.
 */
const DEFAULT_AR: Record<string, string> = {
  "42501": "ليس لديك صلاحية لتنفيذ هذه العملية", // insufficient_privilege
  "23514": "المخزون غير كافٍ لتنفيذ هذه الكمية", // check_violation (stock floor)
  "22023": "قيمة غير صالحة في الطلب", // invalid_parameter_value (bad qty)
  "23505": "تعذّر تنفيذ العملية: تم تنفيذها بالفعل أو الحالة غير متوقعة.", // unique_violation (claim-first abort)
  "23503": "بيانات مرتبطة غير موجودة", // foreign_key_violation
  "23502": "بيانات ناقصة مطلوبة", // not_null_violation
  P0002: "العنصر المطلوب غير موجود.", // no_data_found (raise)
  "40001": "تعارض مؤقت، يُرجى المحاولة مرة أخرى.", // serialization_failure
  "40P01": "تعارض مؤقت، يُرجى المحاولة مرة أخرى.", // deadlock_detected
  "57014": "استغرقت العملية وقتًا طويلًا، يُرجى المحاولة مرة أخرى.", // query_canceled (statement timeout)
};

/** The SQLSTATE codes with a known Arabic mapping — the set the "Why?" surface must cover. */
export const AR_ERROR_CODES: readonly string[] = Object.keys(DEFAULT_AR);

/**
 * Map a DB error to a field-safe Arabic message. Resolution order:
 *   1. caller `overrides[code]`  2. `DEFAULT_AR[code]`  3. `fallback` (generic Arabic).
 * Returns the fallback for a null/undefined error too, so callers can map unconditionally.
 */
export function toArabicError(
  error: DbError | null | undefined,
  overrides: Record<string, string> = {},
  fallback: string = GENERIC_AR_ERROR,
): string {
  if (!error) return fallback;
  const code = error.code ?? "";
  return overrides[code] ?? DEFAULT_AR[code] ?? fallback;
}
