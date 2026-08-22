"use client";

import Link from "next/link";
import type { Role } from "@/lib/auth";
import { mobilePrimaryTabsForRole, primaryNavIdForPath } from "@/lib/nav";
import { NavIcon } from "@/components/NavIcon";
//
// Sizing and visibility live in `.farm-bottom-nav` (app/globals.css), NOT in utility classes here. The
// bar is `position: fixed`, so the scroll container has to reserve the same height or the last row /
// primary button of every phone page sits underneath it. Keeping the breakpoint, the height token and
// the reserve in ONE media block is what makes the two impossible to drift apart.

export function MobileTabBar({ role, pathname }: { role: Role; pathname: string }) {
  const tabs = mobilePrimaryTabsForRole(role);
  const activePrimaryNavId = primaryNavIdForPath(role, pathname);

  return (
    <nav
      aria-label="التنقل السفلي"
      className="farm-bottom-nav fixed inset-inline-0 bottom-0 z-40"
      style={{
        background: "var(--surface-raised, #fff)",
        borderTop: "1px solid var(--line)",
        gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
      }}
    >
      {tabs.map((t) => {
        const active = t.id === activePrimaryNavId;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? (pathname === t.href ? "page" : "location") : undefined}
            className="flex flex-col items-center gap-0.5 py-2 text-center"
            style={{
              color: active ? "var(--brand, #1e6b3a)" : "var(--ink-muted)",
              fontWeight: active ? 700 : 500,
            }}
          >
            <span className="leading-none">
              <NavIcon name={t.icon} size={19} />
            </span>
            <span className="text-[11px]">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
