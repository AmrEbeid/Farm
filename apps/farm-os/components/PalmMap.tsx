"use client";

import { useRouter } from "next/navigation";
import { PalmGrid, type PalmLine } from "@/components/ui";

/**
 * Interactive palm map for the farm 360 pages. Wraps the DS PalmGrid and makes
 * each cell deep-link to that palm's 360 page — the click-through that the old
 * SectorFile island provided. Kept as its own client component so the server
 * 360 pages can render it inside a tab panel without pulling client state.
 */
export function PalmMap({ lines, ariaLabel }: { lines: PalmLine[]; ariaLabel: string }) {
  const router = useRouter();
  return (
    <PalmGrid
      lines={lines}
      ariaLabel={ariaLabel}
      onCellActivate={(cellId) => router.push(`/farm/palm/${cellId}`)}
    />
  );
}
