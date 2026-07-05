import Link from "next/link";

// Quick period presets for finance report pages. `mode="range"` (default) renders ?start=&end= links
// (this month / last month / this year); `mode="asOf"` renders ?asOf= links (today / end of last month /
// end of last year). Presentational GET links — server-safe, no client boundary.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function PeriodPresets({ basePath, mode = "range" }: { basePath: string; mode?: "range" | "asOf" }) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const presets: { label: string; href: string }[] =
    mode === "asOf"
      ? [
          { label: "اليوم", href: `${basePath}?asOf=${iso(now)}` },
          { label: "نهاية الشهر الماضي", href: `${basePath}?asOf=${iso(new Date(y, m, 0))}` },
          { label: "نهاية السنة الماضية", href: `${basePath}?asOf=${iso(new Date(y, 0, 0))}` },
        ]
      : [
          { label: "هذا الشهر", href: `${basePath}?start=${iso(new Date(y, m, 1))}&end=${iso(now)}` },
          { label: "الشهر الماضي", href: `${basePath}?start=${iso(new Date(y, m - 1, 1))}&end=${iso(new Date(y, m, 0))}` },
          { label: "هذه السنة", href: `${basePath}?start=${iso(new Date(y, 0, 1))}&end=${iso(now)}` },
        ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold" style={{ color: "var(--ink-muted)" }}>
        فترات سريعة:
      </span>
      {presets.map((p) => (
        <Link
          key={p.label}
          href={p.href}
          className="rounded-full px-3 py-1 text-sm font-semibold"
          style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
        >
          {p.label}
        </Link>
      ))}
    </div>
  );
}
