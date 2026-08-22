import Link from "next/link";
import { MARKETING_SOURCE_AREAS, marketingSourceAreaHref, type MarketingRoute } from "@/lib/marketing/source-areas";

const GROUPS: { route: MarketingRoute; label: string }[] = [
  { route: "/marketing", label: "الملخص والتقارير" },
  { route: "/marketing/product", label: "المنتج والجودة" },
  { route: "/marketing/markets", label: "الأسواق والأسعار" },
  { route: "/marketing/pipeline", label: "خط المبيعات" },
  { route: "/marketing/campaigns", label: "الحملات والتواصل" },
];

export function MarketingAreaNav() {
  return (
    <nav aria-label="مساحات عمل التسويق" className="border-y py-3" style={{ borderColor: "var(--line)" }}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {GROUPS.map((group) => (
          <div key={group.route}>
            <div className="mb-1 text-sm font-bold">{group.label}</div>
            <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
              {MARKETING_SOURCE_AREAS.filter((area) => area.route === group.route).map((area) => (
                <Link key={area.sourceId} href={marketingSourceAreaHref(area)} className="underline-offset-2 hover:underline">
                  {area.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}
