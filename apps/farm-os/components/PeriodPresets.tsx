import Link from "next/link";

// Quick period presets (this month / last month / this year) for finance report pages that take
// `?start=&end=` search params. Presentational; no data access. Renders GET links, so it works in a
// Server Component without a client boundary.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function PeriodPresets({ basePath }: { basePath: string }) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const presets = [
    { label: "هذا الشهر", start: iso(new Date(y, m, 1)), end: iso(now) },
    { label: "الشهر الماضي", start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) },
    { label: "هذه السنة", start: iso(new Date(y, 0, 1)), end: iso(now) },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold" style={{ color: "var(--ink-muted)" }}>
        فترات سريعة:
      </span>
      {presets.map((p) => (
        <Link
          key={p.label}
          href={`${basePath}?start=${p.start}&end=${p.end}`}
          className="rounded-full px-3 py-1 text-sm font-semibold"
          style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
        >
          {p.label}
        </Link>
      ))}
    </div>
  );
}
