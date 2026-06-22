import type { Metadata } from "next";
import "@amrebeid/ui/styles.css";
import "./globals.css";
import { ThemeProvider } from "@amrebeid/ui";

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
