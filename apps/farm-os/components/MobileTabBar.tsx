"use client";

import Link from "next/link";

// SPEC-0025 U-14 (§2c) — the phone-first bottom tab bar: the 5 destinations a thumb needs, fixed at the
// bottom on small screens only (hidden ≥48rem, where the sidebar rules). Role-aware: finance roles get
// «المعاملات»; the storekeeper gets «المخزون» (their real home); other field roles get «الميدان». Pure
// links — no drawer/state coupling.

interface Tab {
  href: string;
  icon: string;
  label: string;
}

export function MobileTabBar({ role, pathname }: { role: string; pathname: string }) {
  const finance = role === "owner" || role === "accountant";
  const tabs: Tab[] = [
    { href: "/dashboard", icon: "🏠", label: "الرئيسية" },
    { href: "/record", icon: "➕", label: "سجّل" },
    finance
      ? { href: "/transactions", icon: "📜", label: "المعاملات" }
      : role === "storekeeper"
        ? // storekeeper can't access /m (field-role only); their real home is the store — pointing the
          // field tab at /m bounced them to /dashboard on their primary device (SPEC-0030 §4.2).
          { href: "/inventory/dashboard", icon: "📦", label: "المخزون" }
        : { href: "/m", icon: "📱", label: "الميدان" },
    { href: "/reports", icon: "📈", label: "التقارير" },
    { href: "/farm/dashboard", icon: "🌴", label: "المزرعة" },
  ];

  return (
    <nav
      aria-label="التنقل السفلي"
      className="fixed inset-inline-0 bottom-0 z-40 grid grid-cols-5 sm:hidden"
      style={{
        background: "var(--surface-raised, #fff)",
        borderTop: "1px solid var(--line)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className="flex flex-col items-center gap-0.5 py-2 text-center"
            style={{
              color: active ? "var(--brand, #1e6b3a)" : "var(--ink-muted)",
              fontWeight: active ? 700 : 500,
            }}
          >
            <span className="text-lg leading-none" aria-hidden>
              {t.icon}
            </span>
            <span className="text-[11px]">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
