// SPEC-0029/0031 — المقارنة الداخلية: the best-unit benchmark. "لو أدى كل فدان مثل الأفضل" — the reframe that
// turns immature sectors into upside, not underperformance. Every figure is honest: per-sector profit +
// area from fn_sector_pnl (revenue from sales, operating expenses grouped to the physical sector via
// cost_center.sector_id; drawings/capex excluded #6). Profit/feddan is CUMULATIVE (since 2019) — labeled as
// such. Sectors with no area are shown but excluded from per-feddan math (honest-null #1). Server Component;
// role enforced here AND in the RPC (finance.read).

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, EmptyState } from "@/components/ui";
import { StoryLine } from "@/components/StoryLine";
import { PrintButton } from "@/components/print-button";
import { egp, num } from "@/lib/money";
import {
  bestUnitBenchmark,
  concentrationThesis,
  profitPerFeddan,
  sectorStatus,
  type CenterPerf,
  type SectorStatus,
} from "@/lib/pnl-insights";

const mutedStyle = { color: "var(--ink-muted)" } as const;

const STATUS_META: Record<SectorStatus, { label: string; color: string }> = {
  crown: { label: "الدرة المكنونة ★", color: "var(--brand, #1e6b3a)" },
  strong: { label: "أداء قوي", color: "#2563eb" },
  recovering: { label: "في تعافٍ", color: "#b45309" },
  attention: { label: "يحتاج اهتمام", color: "#b91c1c" },
};

const num0 = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

function parseSectors(raw: unknown): CenterPerf[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      id: typeof r.sector_id === "string" ? r.sector_id : String(r.sector_id ?? ""),
      name: typeof r.name === "string" ? r.name : "—",
      net: num0(r.profit),
      areaFeddan: num0(r.area_feddan),
    }));
}

/** "ضِعف" multiple, e.g. 5.1× — honest-null when there's no current base. */
function upsideMultiple(potential: number, current: number): string | null {
  if (!(current > 0)) return null;
  return `${num(potential / current, 1)}×`;
}

export default async function BenchmarkPage() {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const res = await sb.rpc("fn_sector_pnl", { p_org: m.orgId });
  if (res.error) throw res.error;

  const centers = parseSectors(res.data);
  const bench = bestUnitBenchmark(centers);
  const concentration = concentrationThesis(centers);

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
            المقارنة الداخلية
          </h1>
          <p style={mutedStyle}>
            ماذا لو أدى كل فدان مثل أفضل قطاع؟ ربح كل فدان هنا تراكمي منذ 2019 — من واقع القيود المُرحّلة.
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <PrintButton label="طباعة المقارنة" />
        </div>
      </header>

      {!bench ? (
        <Card title="المقارنة الداخلية">
          <EmptyState title="تحتاج قطاعين على الأقل لهما مساحة وربح موجب لبناء المقارنة." />
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-col gap-1 p-2 text-center">
              <div className="text-sm font-bold" style={mutedStyle}>
                لو أدى كل فدان مثل «{bench.benchmarkName}»
              </div>
              <div className="text-3xl font-black" dir="ltr" style={{ color: "var(--brand, #1e6b3a)" }}>
                {egp(bench.fullPotential)}
              </div>
              <div className="text-sm" style={mutedStyle}>
                إمكانية الربح التراكمي على {num(bench.totalArea)} فدان (المعيار{" "}
                <span dir="ltr">{egp(bench.benchmarkPerFeddan)}</span>/فدان)
              </div>
              {(() => {
                const mult = upsideMultiple(bench.fullPotential, bench.currentTotalNet);
                return (
                  <div className="mt-1 text-sm font-bold" style={{ color: "var(--ink)" }}>
                    إمكانية إضافية {egp(bench.impliedUpside)}
                    {mult ? ` — نحو ${mult} الربح الحالي` : ""}
                  </div>
                );
              })()}
            </div>
          </Card>

          {concentration && (
            <StoryLine lead={`${concentration.title}: ${concentration.body}`} />
          )}

          <Card title="فجوة الأداء مقابل أفضل قطاع">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" dir="rtl">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    <th className="p-2 text-start font-bold" style={mutedStyle}>القطاع</th>
                    <th className="p-2 text-start font-bold" style={mutedStyle}>المساحة</th>
                    <th className="p-2 text-start font-bold" style={mutedStyle}>ربح/فدان</th>
                    <th className="p-2 text-start font-bold" style={mutedStyle}>الفجوة/فدان</th>
                    <th className="p-2 text-start font-bold" style={mutedStyle}>الإمكانية المتاحة</th>
                    <th className="p-2 text-start font-bold" style={mutedStyle}>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {bench.rows
                    .slice()
                    .sort((a, b) => b.perFeddan - a.perFeddan)
                    .map((row) => {
                      const center = centers.find((c) => c.id === row.id);
                      const status = sectorStatus(profitPerFeddan(center ?? { id: "", name: "", net: 0, areaFeddan: 0 }), bench.benchmarkPerFeddan);
                      const meta = status ? STATUS_META[status] : null;
                      return (
                        <tr key={row.id} style={{ borderBottom: "1px solid var(--line)" }}>
                          <td className="p-2 font-semibold" style={{ color: "var(--ink)" }}>{row.name}</td>
                          <td className="p-2" dir="ltr" style={mutedStyle}>{num(center?.areaFeddan ?? 0)} فدان</td>
                          <td className="p-2 font-bold" dir="ltr" style={{ color: row.perFeddan >= 0 ? "var(--ink)" : "#b91c1c" }}>
                            {egp(row.perFeddan)}
                          </td>
                          <td className="p-2" dir="ltr" style={mutedStyle}>{row.gap > 0 ? egp(row.gap) : "—"}</td>
                          <td className="p-2 font-semibold" dir="ltr" style={{ color: "var(--brand, #1e6b3a)" }}>
                            {row.upside > 0 ? egp(row.upside) : "—"}
                          </td>
                          <td className="p-2">
                            {meta ? (
                              <span className="text-xs font-bold" style={{ color: meta.color }}>
                                {meta.label}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Card>

          <Alert
            tone="info"
            title="الفجوة سببها العمر، لا الأداء"
            description="القطاعات الأصغر لم تبلغ ذروة إنتاجها بعد. نخيل البرحي يصل ذروته بين 8–12 سنة؛ حتى ذلك الحين، الفجوة إمكانية نمو وليست ضعفًا. (منحنى النضج قالب إرشادي حتى اعتماد مهندس زراعي.)"
          />

          <p className="text-sm" style={mutedStyle}>
            الأرقام تراكمية منذ 2019 من القيود المُرحّلة؛ مسحوبات المالك ورؤوس الأموال ليست ضمنها.{" "}
            <Link href="/finance/sector-scorecard" className="no-print font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
              أداء القطاعات ←
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
