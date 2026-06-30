/** EGP / quantity formatting. Never fabricates: pass real numbers only. */

const FMT = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 });
const FMT2 = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 });

export interface MoneySummary {
  total: number;
  unknownCount: number;
  hasUnknown: boolean;
}

export function moneyNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function egp(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${FMT.format(n)} ج.م`;
}

export function egpValue(value: number | string | null | undefined): string {
  return egp(moneyNumber(value));
}

export function sumMoney(values: (number | string | null | undefined)[]): MoneySummary {
  let total = 0;
  let unknownCount = 0;

  for (const value of values) {
    const n = moneyNumber(value);
    if (n == null) {
      unknownCount += 1;
    } else {
      total += n;
    }
  }

  return { total, unknownCount, hasUnknown: unknownCount > 0 };
}

export function egpSummary(summary: MoneySummary): string {
  return summary.hasUnknown ? `${egp(summary.total)} + غير معروف` : egp(summary.total);
}

export function num(n: number | null | undefined, decimals = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  // Honor `decimals` exactly. The cached 0/2-dp formatters cover the common cases;
  // build one for anything else (e.g. coverageDays' 1 dp). Previously any decimals>0
  // fell through to the 2-dp formatter, so num(x,1) wrongly rendered 2 decimals.
  const fmt =
    decimals === 0
      ? FMT
      : decimals === 2
        ? FMT2
        : new Intl.NumberFormat("ar-EG", { maximumFractionDigits: decimals });
  return fmt.format(n);
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
