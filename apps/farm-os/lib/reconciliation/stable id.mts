import { createHash } from "node:crypto";

const PART_SEPARATOR = String.fromCharCode(1);

/**
 * Deterministic, hash-derived id shaped like a UUID (RFC 4122 layout, but content-addressed
 * rather than random) so repeat generator runs against the same pinned inputs are byte-identical.
 * Never uses Math.random()/crypto.randomUUID(). Parts are joined with a control-character
 * separator so ["ab", "c"] and ["a", "bc"] never collide.
 */
export function stableUuid(...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join(PART_SEPARATOR)).digest("hex");
  const variantNibble = ((parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variantNibble}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}
