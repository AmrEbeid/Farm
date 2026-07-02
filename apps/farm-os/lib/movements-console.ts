/**
 * Inventory-movements console classification (INVENTORY-360 gap #6: the
 * owner-verifier's audit view — previously the ledger was only visible 12 rows
 * at a time inside each item's 360, unexportable, with no cross-item report).
 *
 * Chip groups deliberately mirror how the جرد/anti-leakage story reads the
 * ledger: what came in, what went out, what vanished (the leakage-sensitive
 * group), and what is merely earmarked. `transfer` stays out of the chips —
 * blocked at RPC+constraint level since 20260629140248 (0 rows) — but any
 * historical row still shows under «الكل».
 */

export type MovementGroup = "all" | "in" | "out" | "shrink" | "earmark";

const GROUP_TYPES: Record<Exclude<MovementGroup, "all">, string[]> = {
  in: ["receipt", "return"],
  out: ["issue"],
  // The leakage-sensitive group: stock that left the book without leaving to work.
  shrink: ["loss", "adjustment", "expiry"],
  earmark: ["reserve", "release"],
};

export function groupForType(type: string): Exclude<MovementGroup, "all"> | null {
  for (const [group, types] of Object.entries(GROUP_TYPES) as [Exclude<MovementGroup, "all">, string[]][]) {
    if (types.includes(type)) return group;
  }
  return null; // e.g. historical 'transfer' rows — visible under «الكل» only
}

export function typesForGroup(group: MovementGroup): string[] | null {
  if (group === "all") return null; // no filter
  return GROUP_TYPES[group];
}

export function parseMovementGroup(raw: string | undefined): MovementGroup {
  switch (raw) {
    case "in":
    case "out":
    case "shrink":
    case "earmark":
      return raw;
    default:
      return "all";
  }
}
