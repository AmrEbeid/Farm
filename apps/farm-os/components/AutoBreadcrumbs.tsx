"use client";

import { useRouter } from "next/navigation";
import { Breadcrumbs } from "@/components/ui";
import { APP_MODULES, findActiveNavItem } from "@/lib/nav";

// SPEC-0025 U-13 (§2c) — global breadcrumbs, derived automatically from the nav registry: «أين أنا؟»
// plus one tap up, on every page (الرئيسية ← المالية ← تقارير الإيرادات). Pages with hand-crafted deeper
// trails (croquis, hawsha 360…) keep theirs — this renders only the registry-level trail and stays out
// of the way on the home page itself.

export function AutoBreadcrumbs({ pathname }: { pathname: string }) {
  const router = useRouter();
  const item = findActiveNavItem(pathname);
  if (!item || item.href === "/dashboard") return null;

  const module_ = APP_MODULES.find((m) => m.pages.some((p) => p.id === item.id));
  const crumbs = [
    { id: "home", label: "الرئيسية", href: "/dashboard" },
    ...(module_ && module_.dashboardHref !== item.href
      ? [{ id: module_.id, label: module_.label, href: module_.dashboardHref }]
      : []),
    { id: item.id, label: item.label },
  ];

  return (
    <div className="px-6 pt-3">
      <Breadcrumbs
        items={crumbs}
        ariaLabel="مسار التنقل"
        separator="‹"
        onSelect={(id) => {
          const target = crumbs.find((c) => c.id === id);
          if (target?.href) router.push(target.href);
        }}
      />
    </div>
  );
}
