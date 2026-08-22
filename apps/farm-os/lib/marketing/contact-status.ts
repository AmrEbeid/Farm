export const MARKETING_CONTACT_STATUS_OPTIONS = [
  "لم يبدأ",
  "لم يتم التواصل",
  "تم التواصل",
  "تم إرسال العرض",
  "بانتظار الرد",
  "مهتم",
  "طلب معاينة",
  "طلب عينة",
  "طلب عرض سعر",
  "تفاوض",
  "تم الاتفاق",
  "غير مهتم",
  "غير مناسب",
] as const;

export type MarketingContactStatus = (typeof MARKETING_CONTACT_STATUS_OPTIONS)[number];

export function isMarketingContactStatus(value: unknown): value is MarketingContactStatus {
  return typeof value === "string" && (MARKETING_CONTACT_STATUS_OPTIONS as readonly string[]).includes(value);
}

export function defaultMarketingContactStatus(category: string): MarketingContactStatus {
  return category === "buyer_lead" ? "لم يتم التواصل" : "لم يبدأ";
}
