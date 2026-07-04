import Link from "next/link";

// SPEC-0026 P-8 (Owner follow-up) — the calendar view for planning/operations. A pure server component:
// an RTL week grid (the Egyptian week starts السبت) covering [start..end], with each item rendered as a
// chip on every day it spans (multi-day ops appear across their whole range — honest, no fabrication).
// Callers map their rows to items; a chip links to its op/plan when href is given.

export interface CalendarItem {
  id: string;
  /** ISO yyyy-mm-dd start (items without a date are listed under «بدون تاريخ»). */
  date: string | null;
  /** Optional ISO end (inclusive) for multi-day spans. */
  endDate?: string | null;
  label: string;
  href?: string;
  /** ok = done (green) · active = planned (brand) · warn = needs attention (amber). */
  tone?: "ok" | "active" | "warn";
}

const DAY_AR = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
const dayMs = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Days since epoch-Saturday for week alignment (1970-01-03 was a Saturday). */
const satIndex = (t: number) => Math.floor((t - Date.parse("1970-01-03")) / dayMs) % 7;

const TONE_STYLE: Record<NonNullable<CalendarItem["tone"]>, { bg: string; fg: string }> = {
  ok: { bg: "var(--ok-soft, #e6f4ea)", fg: "var(--ok, #1e6b3a)" },
  active: { bg: "var(--brand-soft, #eaf3ee)", fg: "var(--brand, #1e6b3a)" },
  warn: { bg: "var(--warning-soft, #fdf3e0)", fg: "var(--warning, #b7791f)" },
};

export function OpsCalendar({
  start,
  end,
  items,
  todayIso,
}: {
  start: string;
  end: string;
  items: CalendarItem[];
  /** Injected by the caller (server "now") so the highlighted day is testable/deterministic. */
  todayIso?: string;
}) {
  const startT = Date.parse(start);
  const endT = Date.parse(end);
  if (!Number.isFinite(startT) || !Number.isFinite(endT) || endT < startT) return null;

  // Align the grid to full weeks (Saturday → Friday).
  const gridStart = startT - satIndex(startT) * dayMs;
  const gridEnd = endT + (6 - satIndex(endT)) * dayMs;
  const days: string[] = [];
  for (let t = gridStart; t <= gridEnd; t += dayMs) days.push(iso(t));
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const byDay = new Map<string, CalendarItem[]>();
  const undated: CalendarItem[] = [];
  for (const it of items) {
    if (!it.date) {
      undated.push(it);
      continue;
    }
    const s = Date.parse(it.date);
    const e = it.endDate ? Date.parse(it.endDate) : s;
    if (!Number.isFinite(s)) continue;
    for (let t = s; t <= Math.max(s, e); t += dayMs) {
      const d = iso(t);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(it);
    }
  }

  const fmtDay = (d: string) => new Intl.NumberFormat("ar-EG").format(Number(d.slice(8, 10)));

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: "640px" }}>
          <thead>
            <tr>
              {DAY_AR.map((d) => (
                <th
                  key={d}
                  className="border p-1 text-center text-xs font-bold"
                  style={{ borderColor: "var(--line)", color: "var(--ink-muted)", background: "var(--surface-sunken, #f6f8f7)" }}
                >
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]}>
                {week.map((d) => {
                  const inPeriod = d >= start && d <= end;
                  const isToday = todayIso != null && d === todayIso;
                  const dayItems = byDay.get(d) ?? [];
                  return (
                    <td
                      key={d}
                      className="border p-1 align-top"
                      style={{
                        borderColor: "var(--line)",
                        minHeight: "72px",
                        height: "72px",
                        width: `${100 / 7}%`,
                        background: !inPeriod ? "var(--surface-sunken, #f6f8f7)" : isToday ? "var(--brand-soft, #eaf3ee)" : "var(--surface, #fff)",
                        opacity: inPeriod ? 1 : 0.55,
                      }}
                    >
                      <div className="text-xs font-bold" style={{ color: isToday ? "var(--brand)" : "var(--ink-muted)" }}>
                        {fmtDay(d)}
                        {isToday ? " · اليوم" : ""}
                      </div>
                      <div className="mt-0.5 flex flex-col gap-0.5">
                        {dayItems.slice(0, 3).map((it) => {
                          const tone = TONE_STYLE[it.tone ?? "active"];
                          const chip = (
                            <span
                              className="block truncate rounded px-1 py-0.5 text-[11px] font-medium"
                              style={{ background: tone.bg, color: tone.fg }}
                            >
                              {it.label}
                            </span>
                          );
                          return it.href ? (
                            <Link key={it.id + d} href={it.href} className="block">
                              {chip}
                            </Link>
                          ) : (
                            <span key={it.id + d} className="block">
                              {chip}
                            </span>
                          );
                        })}
                        {dayItems.length > 3 && (
                          <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                            +{new Intl.NumberFormat("ar-EG").format(dayItems.length - 3)} أخرى
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {undated.length > 0 && (
        <div className="text-sm" style={{ color: "var(--ink-muted)" }}>
          بدون تاريخ: {undated.map((u) => u.label).join("، ")}
        </div>
      )}
    </div>
  );
}
