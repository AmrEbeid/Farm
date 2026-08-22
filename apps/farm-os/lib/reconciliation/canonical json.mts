/**
 * Canonical JSON serialization: object keys sorted recursively, 2-space indent, trailing
 * newline. Array element order is the caller's responsibility (the generator sorts every
 * array it emits by a content-derived id before calling this). Used so repeat generator runs
 * against the same pinned inputs produce byte-identical output files.
 */
export function canonicalStringify(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  return value;
}
