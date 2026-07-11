import Link from "next/link";
import { AlertCircle, AlertTriangle } from "lucide-react";

// SPEC-0025 U-10 (§2c) — the dashboard-hub primitives. The home page opens with a row of big quick-nav
// buttons (with live badges) so the dashboard LAUNCHES to everything, followed by «يحتاج انتباهك» — the
// attention inbox that answers "what needs me today", each item one tap from its fixing page.
// Presentational server components; every count/badge is query-backed by the caller (#1 honest data).

export interface QuickNavItem {
  href: string;
  icon: string;
  label: string;
  /** Live badge count — omitted/0 renders no badge (never a fabricated number). */
  badge?: number;
}

export function QuickNav({ items }: { items: QuickNavItem[] }) {
  return (
    <nav aria-label="اختصارات سريعة" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {items.map((it) => (
        <Link
          key={it.href + it.label}
          href={it.href}
          className="relative flex flex-col items-center gap-1 rounded-lg px-2 py-3 text-center"
          style={{ background: "var(--surface-raised, #fff)", border: "1px solid var(--line)", color: "var(--ink)" }}
        >
          <span className="text-xl" aria-hidden>
            {it.icon}
          </span>
          <span className="text-xs font-bold">{it.label}</span>
          {Number(it.badge ?? 0) > 0 && (
            <span
              className="absolute end-1 top-1 min-w-5 rounded-full px-1.5 py-0.5 text-center text-xs font-bold"
              style={{ background: "var(--danger, #b23b3b)", color: "#fff" }}
            >
              {new Intl.NumberFormat("ar-EG").format(it.badge ?? 0)}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export interface AttentionItem {
  href: string;
  /** Plain-Arabic sentence: what needs attention + the number that proves it. */
  text: string;
  /** "act" = money/deadline pressure (red accent); "watch" = worth a look (amber). */
  tone: "act" | "watch";
}

export function AttentionInbox({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div
        className="rounded-lg px-4 py-3 text-sm font-bold"
        style={{ background: "var(--surface-raised, #fff)", border: "1px solid var(--line)", color: "var(--ok, #1e6b3a)" }}
      >
        ✓ لا شيء يحتاج انتباهك الآن — كل شيء تحت السيطرة.
      </div>
    );
  }
  return (
    <section aria-label="يحتاج انتباهك" className="flex flex-col gap-2">
      <h2 className="text-base font-bold" style={{ color: "var(--ink)" }}>
        يحتاج انتباهك ({new Intl.NumberFormat("ar-EG").format(items.length)})
      </h2>
      <ul className="flex flex-col gap-1.5">
        {items.map((it) => (
          <li key={it.href + it.text}>
            <Link
              href={it.href}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium"
              style={{
                background: "var(--surface-raised, #fff)",
                // Tone via the icon + a full border tinted toward the tone — not a 4px side-stripe (the AI-UI
                // "side-tab" tell, retired across the DS in the impeccable pass). Consistent with Toast/Alert.
                border: `1px solid ${
                  it.tone === "act"
                    ? "color-mix(in srgb, var(--danger, #b23b3b) 45%, var(--line))"
                    : "color-mix(in srgb, var(--warning, #b7791f) 45%, var(--line))"
                }`,
                color: "var(--ink)",
              }}
            >
              {it.tone === "act" ? (
                <AlertCircle width={16} height={16} strokeWidth={2} aria-hidden style={{ flex: "none", color: "var(--danger, #b23b3b)" }} />
              ) : (
                <AlertTriangle width={16} height={16} strokeWidth={2} aria-hidden style={{ flex: "none", color: "var(--warning, #b7791f)" }} />
              )}
              <span className="flex-1">{it.text}</span>
              <span aria-hidden style={{ color: "var(--ink-muted)" }}>
                ←
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
