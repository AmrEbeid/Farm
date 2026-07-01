import type { Metadata, Viewport } from "next";
import { Readex_Pro, Tajawal } from "next/font/google";
// App-local copy of @amrebeid/ui's bundled styles. Importing the library CSS directly from
// the workspace/node_modules path broke the Vercel build (global CSS resolved inside
// node_modules); a local copy is always allowed. This copy is auto-synced from
// ../../packages/ui/dist/styles.css by scripts/sync-ds-css.mjs (runs on prebuild/
// predev). To refresh manually: `npm run sync:ds-css`. Do NOT hand-edit it.
import "./farm-os-ui.css";
import "./globals.css";
import { ThemeProvider, ToastProvider } from "@/components/ui";

// Direction A ("The Registry") typographic voice — self-hosted via next/font (no runtime
// Google request; Arabic + Latin subsets). Readex Pro = display (engineered, confident
// Arabic for headings); Tajawal = body/UI (humanist, excellent at small Arabic sizes).
// Exposed as CSS vars; globals.css maps the design-system `--font-family` token to Tajawal
// (so @amrebeid/ui components inherit the voice app-wide) and `--font-display` to Readex.
const display = Readex_Pro({
  subsets: ["arabic", "latin"],
  variable: "--font-readex",
  display: "swap",
});
const body = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-tajawal",
  display: "swap",
});

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
    <html
      lang="ar"
      dir="rtl"
      className={`h-full antialiased ${display.variable} ${body.variable}`}
    >
      <body className="min-h-full">
        <ThemeProvider scheme="light" density="comfortable" brand="#2f7d49">
          {/*
           * App-wide toast host: mounted once here (inside ThemeProvider, so the
           * portal-rendered Toaster picks up the theme/brand tokens via useTheme())
           * so any page/component can call useToast() without its own provider.
           */}
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
