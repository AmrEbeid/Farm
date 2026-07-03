import type { MetadataRoute } from "next";

// Brand colors come from the design system (see app/farm-os-ui.css):
//   theme_color      = --brand / --green-600 = #2f7d49 (matches ThemeProvider brand prop)
//   background_color = light-scheme --surface = #ffffff (page background in globals.css)
// Icons = the Ebeid Farm logo mark (gold palm on deep green) — the same brand as app/icon.png
// (favicon) + app/apple-icon.png (iOS home screen). The 512 is marked "maskable" (the mark sits
// well within the Android safe zone) so Android install crops it cleanly.
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
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
