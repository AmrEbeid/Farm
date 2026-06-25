/** Arabic (ar-EG) date formatting. Never fabricates: pass real values only. */

const FMT = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" });

export function fmtDate(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return FMT.format(date);
}
