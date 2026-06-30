"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Tabs, type TabItem } from "@amrebeid/ui";

/**
 * URL-driven tab switcher for entity 360 pages. Renders the DS Tabs buttons and,
 * on selection, writes the active tab id to a search param (default `tab`) so the
 * server component can render the matching panel. The active tab survives refresh
 * and is shareable/bookmarkable. Panels are rendered server-side by the page.
 */
export function EntityTabs({
  items,
  value,
  paramKey = "tab",
  ariaLabel = "أقسام الملف",
}: {
  items: TabItem[];
  value: string;
  paramKey?: string;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <Tabs
      items={items}
      value={value}
      ariaLabel={ariaLabel}
      onChange={(id) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set(paramKey, id);
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      }}
    />
  );
}
