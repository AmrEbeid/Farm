import type { ReactNode } from "react";
import { Readex_Pro, Tajawal } from "next/font/google";
import { ThemeProvider, ToastProvider } from "@/components/ui";

export { ROOT_METADATA, ROOT_VIEWPORT } from "@/app/root-config";

// App-local copy of @amrebeid/ui's bundled styles. This copy is auto-synced from
// ../../packages/ui/dist/styles.css by scripts/sync-ds-css.mjs. Do not hand-edit it.
import "./farm-os-ui.css";
import "./globals.css";

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

export function RootDocument({
  children,
  lang,
  dir,
}: {
  children: ReactNode;
  lang: "ar" | "en";
  dir: "rtl" | "ltr";
}) {
  return (
    <html
      lang={lang}
      dir={dir}
      className={`h-full antialiased ${display.variable} ${body.variable}`}
    >
      <body className="min-h-full">
        <ThemeProvider scheme="light" density="comfortable" brand="#2f7d49">
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
