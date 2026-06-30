/**
 * Format a numeric chart value as Arabic-Indic digits (٠١٢٣…) with Arabic
 * grouping. The design system is Arabic-RTL-first, so chart axes, tooltips, and
 * the screen-reader table fall back to Arabic-Indic numerals just like the rest
 * of the UI — Recharts otherwise renders raw Western digits on numeric axes,
 * which leaks Latin numerals into an Arabic interface.
 *
 * Non-numeric inputs (category strings already localized by the caller) pass
 * through unchanged.
 */
const arNumber = new Intl.NumberFormat("ar-EG-u-nu-arab", { maximumFractionDigits: 2 });

export function formatChartNumber(value: unknown): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? arNumber.format(value) : "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "" && !Number.isNaN(Number(trimmed))) {
      return arNumber.format(Number(trimmed));
    }
    return value;
  }
  return value == null ? "" : String(value);
}
