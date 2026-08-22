export type MarketingRoute =
  | "/marketing"
  | "/marketing/product"
  | "/marketing/markets"
  | "/marketing/pipeline"
  | "/marketing/campaigns";

export interface MarketingSourceArea {
  sourceId: string;
  label: string;
  route: MarketingRoute;
  anchor: string;
}

export const MARKETING_SOURCE_AREAS = [
  { sourceId: "dashboard", label: "لوحة التحكم", route: "/marketing", anchor: "overview" },
  { sourceId: "farm", label: "المزرعة والمنتج", route: "/marketing/product", anchor: "farm-product" },
  { sourceId: "offshoots", label: "فسائل البرحي", route: "/marketing/pipeline", anchor: "offshoots" },
  { sourceId: "prices", label: "الأسعار اليومية", route: "/marketing/markets", anchor: "daily-prices" },
  { sourceId: "markets", label: "الأسواق والتصدير", route: "/marketing/markets", anchor: "export-markets" },
  { sourceId: "local", label: "البيع المحلي والمستهلك", route: "/marketing/pipeline", anchor: "local-sales" },
  { sourceId: "shipping", label: "الشحن", route: "/marketing/markets", anchor: "shipping" },
  { sourceId: "logisticsResearch", label: "لوجستيات الشحن 2026", route: "/marketing/markets", anchor: "shipping" },
  { sourceId: "quality", label: "الجودة وسلسلة التبريد", route: "/marketing/product", anchor: "quality" },
  { sourceId: "kuwait", label: "خطة الكويت", route: "/marketing/markets", anchor: "kuwait" },
  { sourceId: "china", label: "خطة الصين", route: "/marketing/markets", anchor: "export-markets" },
  { sourceId: "crm", label: "الشركات والمتابعة", route: "/marketing/pipeline", anchor: "crm" },
  { sourceId: "exw", label: "مركز البيع EXW", route: "/marketing/pipeline", anchor: "exw" },
  { sourceId: "competitors", label: "المنافسون", route: "/marketing/markets", anchor: "competitors" },
  { sourceId: "linkedin", label: "LinkedIn B2B", route: "/marketing/pipeline", anchor: "linkedin" },
  { sourceId: "brokers", label: "وسطاء التصدير", route: "/marketing/pipeline", anchor: "brokers" },
  { sourceId: "socialprices", label: "رصد أسعار السوشيال", route: "/marketing/markets", anchor: "daily-prices" },
  { sourceId: "exportletter", label: "رسالة المصدرين", route: "/marketing/campaigns", anchor: "message-templates" },
  { sourceId: "gmail", label: "Gmail والحملة", route: "/marketing/campaigns", anchor: "message-templates" },
  { sourceId: "campaign", label: "الحملة اليومية", route: "/marketing/campaigns", anchor: "daily-campaign" },
  { sourceId: "platforms", label: "منصات الإعلان B2B", route: "/marketing/campaigns", anchor: "platforms" },
  { sourceId: "materials", label: "المواد التسويقية", route: "/marketing/campaigns", anchor: "message-templates" },
  { sourceId: "dailyreport", label: "التقرير اليومي", route: "/marketing/campaigns", anchor: "daily-report" },
  { sourceId: "reports", label: "المالية والتقارير", route: "/marketing", anchor: "reports" },
  { sourceId: "contact", label: "التواصل", route: "/marketing/campaigns", anchor: "contacts" },
] as const satisfies readonly MarketingSourceArea[];

export function marketingSourceAreaHref(area: MarketingSourceArea): string {
  return `${area.route}#${area.anchor}`;
}
