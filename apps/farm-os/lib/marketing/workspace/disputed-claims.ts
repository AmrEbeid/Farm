// SPEC-0032 marketing workspace — CLAUDE.md #5: the source HTML repeats an approximate palm count
// ("نحو 5,000 نخلة برحي" / "~5,000 Barhi palms") in several tabs. The workspace must render that
// EXACT source text (fidelity requirement) but never let it read as approved Farm OS data — this
// module finds the exact phrase inside a run of source text so the renderer can flag it distinctly,
// without altering or omitting the surrounding original wording.
const PALM_COUNT_CLAIM = /(?:نحو|حوالي)?\s*5,000\s*نخل[ةه](?:\s*برحي)?|~?5,000\s*Barhi\s*palms?/giu;

export interface TextSegment {
  text: string;
  disputed: boolean;
}

/** Splits `text` into plain / disputed-palm-count segments, preserving every character exactly. */
export function splitDisputedClaims(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  PALM_COUNT_CLAIM.lastIndex = 0;
  for (const match of text.matchAll(PALM_COUNT_CLAIM)) {
    const start = match.index ?? 0;
    if (start > lastIndex) segments.push({ text: text.slice(lastIndex, start), disputed: false });
    segments.push({ text: match[0], disputed: true });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), disputed: false });
  if (segments.length === 0) segments.push({ text, disputed: false });
  return segments;
}

export function containsDisputedClaim(text: string): boolean {
  PALM_COUNT_CLAIM.lastIndex = 0;
  return PALM_COUNT_CLAIM.test(text);
}
