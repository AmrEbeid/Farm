/**
 * Neutralize spreadsheet formula-injection. A cell whose first character is a
 * formula trigger (= + - @) or a leading tab/CR can execute when opened in Excel
 * (OWASP CSV Injection). Applied in BOTH directions: when generating templates and
 * when echoing user-supplied values into error files/exports. See spec §8.
 */
const LEADING_TRIGGER = /^[=+\-@\t\r]/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

export function sanitizeCell(value: unknown): string {
  if (value == null) return "";
  const raw = String(value);
  const needsGuard = LEADING_TRIGGER.test(raw);
  const cleaned = raw.replace(CONTROL_CHARS, "");
  return needsGuard ? "'" + cleaned : cleaned;
}
