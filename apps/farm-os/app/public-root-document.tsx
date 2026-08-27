import type { ReactNode } from "react";
import { Readex_Pro, Tajawal } from "next/font/google";

// Public pages use the same typography as Farm OS without preloading every language and
// weight before the first image. font-display: swap keeps the first paint immediate, while
// the browser fetches only the font files actually used by the rendered language.
const publicDisplay = Readex_Pro({
  subsets: ["arabic", "latin"],
  variable: "--font-readex",
  display: "swap",
  preload: false,
});

const publicBody = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-tajawal",
  display: "swap",
  preload: false,
});

export function PublicRootDocument({
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
      className={`${publicDisplay.variable} ${publicBody.variable}`}
    >
      <body className="public-body">{children}</body>
    </html>
  );
}
