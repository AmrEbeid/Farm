import type { Metadata, Viewport } from "next";

export const ROOT_METADATA: Metadata = {
  metadataBase: new URL("https://ebeidfarm.business"),
  applicationName: "نظام تشغيل المزارع",
  title: {
    default: "نظام تشغيل المزارع",
    template: "%s · نظام تشغيل المزارع",
  },
  description:
    "أداة ميدانية لإدارة وتشغيل مزارع عبيد — متابعة العمليات اليومية من الحقل مباشرة.",
  appleWebApp: {
    capable: true,
    title: "نظام تشغيل المزارع",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
};

export const ROOT_VIEWPORT: Viewport = {
  themeColor: "#2f7d49",
  width: "device-width",
  initialScale: 1,
};
