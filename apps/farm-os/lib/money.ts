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
