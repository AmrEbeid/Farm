import type { MetadataRoute } from "next";

// Brand colors come from the design system (see app/farm-os-ui.css):
//   theme_color      = --brand / --green-600 = #2f7d49 (matches ThemeProvider brand prop)
//   background_color = light-scheme --surface = #ffffff (page background in globals.css)
// No PNG icons exist in public/ yet, so `icons` is intentionally omitted; the
// app/favicon.ico is still served automatically by Next.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "نظام تشغيل المزارع",
    short_name: "المزارع",
    description:
      "أداة ميدانية لإدارة وتشغيل مزارع عبيد — متابعة العمليات اليومية من الحقل مباشرة.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2f7d49",
    dir: "rtl",
    lang: "ar",
  };
}
