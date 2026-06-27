// Pure logic for the farm croquis (Stage 5). Kept out of the component so the colour rule is unit-
// tested independently of rendering.

export type Attention = "healthy" | "watch" | "alert";

export interface AttentionCounts {
  watch: number;
  sick: number;
  dead: number;
}

/**
 * A hawsha's worst attention level drives its croquis colour:
 *   - any sick OR dead palm  → "alert"  (red)
 *   - else any watch palm    → "watch"  (amber)
 *   - else                   → "healthy" (green)
 * Mirrors the agronomy signal the farm landing already surfaces (watch/sick/dead).
 */
export function attentionFor(c: AttentionCounts): Attention {
  if (c.sick > 0 || c.dead > 0) return "alert";
  if (c.watch > 0) return "watch";
  return "healthy";
}

/** Total palms flagged needing any attention (the badge count). */
export function attentionCount(c: AttentionCounts): number {
  return c.watch + c.sick + c.dead;
}
