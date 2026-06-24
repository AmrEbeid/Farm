import type { Metadata } from "next";
// App-local copy of @amrebeid/ui's bundled styles. Importing the library CSS directly from
// the workspace/node_modules path broke the Vercel build (global CSS resolved inside
// node_modules); a local copy is always allowed. Re-copy on library CSS changes:
//   cp ../../packages/ui/dist/styles.css app/farm-os-ui.css
import "./farm-os-ui.css";
import "./globals.css";
import { ThemeProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: "نظام تشغيل المزارع",
  description: "Farm OS — نظام تشغيل مزارع عبيد",
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
