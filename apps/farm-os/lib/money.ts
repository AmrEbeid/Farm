/** EGP / quantity formatting. Never fabricates: pass real numbers only. */

const FMT = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 });
const FMT2 = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 });

export function egp(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${FMT.format(n)} ج.م`;
}

export function num(n: number | null | undefined, decimals = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return (decimals > 0 ? FMT2 : FMT).format(n);
}

export function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${FMT.format(n)}٪`;
}

/**
 * Format the `coverage_days` field from fn_stock_coverage. The RPC returns a NUMBER for
 * finite coverage or the literal STRING "∞" when demand ≤ 0 (infinite coverage) — never
 * null. The previous `=== null ? "∞" : num(...)` check let the "∞" string fall through to
 * num(), which rendered "ليس رقمًا" (NaN). Render "∞" for the infinite sentinel.
 */
export function coverageDays(value: number | "∞" | null | undefined): string {
  if (value === "∞" || value == null) return "∞";
  return Number.isFinite(value) ? num(value, 1) : "∞";
}
