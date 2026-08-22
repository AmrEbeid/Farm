"use client";

import { useRouter } from "next/navigation";
import { Breadcrumbs } from "@/components/ui";
import type { Role } from "@/lib/auth";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";

// SPEC-0025 U-13 (§2c) — global breadcrumbs, derived automatically from the nav registry: «أين أنا؟»
// plus one tap up (الرئيسية ← المالية ← تقارير الإيرادات). Pages with hand-crafted deeper trails
// (croquis, hawsha 360…) keep theirs — this renders only the registry-level trail.
//
// The trail itself is built by the pure, role-aware `buildBreadcrumbs` (lib/breadcrumbs.ts): it decides
// role visibility and whether a route is deep enough to deserve a trail at all. This component only
// renders and routes.

export function AutoBreadcrumbs({ pathname, role }: { pathname: string; role: Role }) {
  const router = useRouter();
  const crumbs = buildBreadcrumbs(pathname, role);
  if (crumbs.length === 0) return null;

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
