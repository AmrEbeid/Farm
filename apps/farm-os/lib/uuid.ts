// A client-safe UUID check.
//
// `lib/reconciliation review.ts` already exports an `isUuid` (re-exported by lib/payroll-report), but
// that module is ~850 lines of server-side reconciliation logic. The attendance and compensation
// FORMS are client components and need the same check, so pulling that module across the client
// boundary just to read one regex would ship the whole reconciliation surface to the field. This is
// the same predicate in its own tiny module; `lib/uuid.test.ts` pins the two against each other so
// they can never drift apart.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a canonical 8-4-4-4-12 UUID string (surrounding whitespace tolerated). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}
