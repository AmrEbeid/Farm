import Link from "next/link";
import { num } from "@/lib/money";
import type { Attention } from "@/lib/croquis";

// A hawsha's worst attention level drives its croquis colour. Reuses the palm-status palette
// (var(--success-fg)/warning/danger) so the bird's-eye map reads the same as the per-line PalmGrid.
const ATTENTION_BG: Record<Attention, string> = {
  healthy: "var(--success-fg, #16a34a)",
  watch: "var(--warning-fg, #d97706)",
  alert: "var(--danger-fg, #dc2626)",
};
const ATTENTION_AR: Record<Attention, string> = {
  healthy: "سليمة",
  watch: "تحت المراقبة",
  alert: "تحتاج عناية",
};

export interface CroquisHawsha {
  id: string;
  name: string;
  code: string;
  barhi: number;
  male: number;
  attention: Attention;
  attentionCount: number; // # of watch/sick/dead palms recorded
}
export interface CroquisSector {
  id: string;
  name: string;
  code: string;
  hawshat: CroquisHawsha[];
}

/**
 * Farm croquis (Stage 5) — a visual bird's-eye layout of the whole farm: each sector is a block,
 * each hawsha a colour-coded cell (green/amber/red by the worst palm-attention level), sized-by-label
 * with its palm count, linking to the hawsha's 360 page. Presentational + RTL; no client JS (plain
 * links), so it renders in a Server Component. The colours match the PalmGrid status palette.
 */
export function FarmCroquis({ sectors }: { sectors: CroquisSector[] }) {
  if (sectors.length === 0) {
    return <p className="text-sm opacity-70">لا توجد قطاعات لعرضها.</p>;
  }
  return (
    <div className="flex flex-col gap-5">
      {/* legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        {(["healthy", "watch", "alert"] as Attention[]).map((a) => (
          <span key={a} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: ATTENTION_BG[a] }} />
            {ATTENTION_AR[a]}
          </span>
        ))}
      </div>

      {sectors.map((s) => {
        const sectorBarhi = s.hawshat.reduce((sum, h) => sum + h.barhi, 0);
        const sectorMale = s.hawshat.reduce((sum, h) => sum + h.male, 0);
        return (
          <section
            key={s.id}
            className="rounded-xl border border-[var(--line,#e5e7eb)] bg-[var(--surface,#fff)] p-4"
            aria-label={`قطاع ${s.name}`}
          >
            <header className="mb-3 flex items-baseline justify-between gap-3">
              <Link href={`/farm/sector/${s.id}`} className="text-base font-bold hover:underline">
                {s.name} <span className="text-xs font-normal opacity-60">{s.code}</span>
              </Link>
              <span className="text-xs opacity-70">
                {num(s.hawshat.length)} حوشة · {num(sectorBarhi)} برحي · {num(sectorMale)} ذكور
              </span>
            </header>

            <div className="flex flex-wrap gap-2">
              {s.hawshat.map((h) => (
                <Link
                  key={h.id}
                  href={`/farm/hawsha/${h.id}`}
                  title={`${h.name} — ${ATTENTION_AR[h.attention]}${h.attentionCount ? ` (${h.attentionCount})` : ""}`}
                  className="group relative flex min-w-[64px] flex-col items-center justify-center rounded-md p-2 text-center transition-transform hover:scale-[1.04] focus-visible:outline focus-visible:outline-2"
                  style={{ background: ATTENTION_BG[h.attention], color: "var(--brand-contrast, #fff)" }}
                >
                  <span className="text-[11px] font-bold leading-tight">{h.code}</span>
                  <span className="text-[10px] opacity-90">{num(h.barhi + h.male)}</span>
                  {h.attentionCount > 0 && (
                    <span
                      className="absolute -top-1.5 -left-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--surface,#fff)] px-1 text-[10px] font-bold text-[var(--danger-fg,#dc2626)] ring-1 ring-[var(--danger-fg,#dc2626)]"
                      aria-hidden
                    >
                      {num(h.attentionCount)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
