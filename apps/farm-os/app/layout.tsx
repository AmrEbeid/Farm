import type { Metadata, Viewport } from "next";
// App-local copy of @amrebeid/ui's bundled styles. Importing the library CSS directly from
// the workspace/node_modules path broke the Vercel build (global CSS resolved inside
// node_modules); a local copy is always allowed. This copy is auto-synced from
// ../../packages/ui/dist/styles.css by scripts/sync-ds-css.mjs (runs on prebuild/
// predev). To refresh manually: `npm run sync:ds-css`. Do NOT hand-edit it.
import "./farm-os-ui.css";
import "./globals.css";
import { ThemeProvider } from "@/components/ui";

export const metadata: Metadata = {
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

// Brand token: --brand = --green-600 = #2f7d49 (see app/farm-os-ui.css), matching
// the ThemeProvider brand prop below. Light scheme surface is #ffffff.
export const viewport: Viewport = {
  themeColor: "#2f7d49",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className="h-full antialiased">
      <body className="min-h-full">
        <ThemeProvider scheme="light" density="comfortable" brand="#2f7d49">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
