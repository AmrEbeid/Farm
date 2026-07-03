// Bilingual formatting for the public site. In the Arabic view, counts/areas render as
// grouped Arabic-Indic digits (via lib/money `num`, the same helper the app uses — no
// Western-digit leak, non-negotiable #1). In the English view they render as Western digits.
// International identifiers (GGN, codes, phones) are formatted with `fmtDigits`, which only
// substitutes digit glyphs and never groups — so "2018" stays a clean year, not "٢٬٠١٨".

import { num } from "@/lib/money";
import type { Lang } from "@/lib/site-content";

const AR_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

/** Grouped number: Arabic-Indic for `ar`, Western for `en`. `decimals` auto-detects .5 etc. */
export function fmtNum(
  value: number,
  lang: Lang,
  opts: { approx?: boolean; decimals?: number } = {},
): string {
  const decimals = opts.decimals ?? (Number.isInteger(value) ? 0 : 1);
  const prefix = opts.approx ? "~" : "";
  const body =
    lang === "ar"
      ? num(value, decimals)
      : value.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
  return prefix + body;
}

/** Per-glyph digit substitution (no grouping). For years/codes in the Arabic view. */
export function fmtDigits(text: string, lang: Lang): string {
  if (lang === "en") return text;
  return text.replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]);
}
