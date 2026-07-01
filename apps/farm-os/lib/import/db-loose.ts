/**
 * A single shared "loosely typed" wrapper around a Supabase client for the import
 * framework's dynamic-table queries (ref lookups, existing-row fetch). The generated
 * Database types don't know about a descriptor's runtime table name, so every call site
 * needs to bypass them the same way — this is that one place, instead of each call site
 * declaring its own cast (which had already drifted into two incompatible shapes).
 */
export type LooseQuery = Promise<{ data: Record<string, unknown>[] | null; error: unknown }> & {
  eq: (col: string, val: unknown) => LooseQuery;
  in: (col: string, vals: string[]) => LooseQuery;
};

type LooseFrom = (table: string) => { select: (cols: string) => LooseQuery };

export function looseFrom(sb: { from: (table: string) => unknown }): LooseFrom {
  // Must call sb.from(table) through a closure, NOT re-export the bare method
  // (`sb.from as unknown as LooseFrom`) — Supabase's PostgrestClient.from() reads
  // internal state off `this`, so a detached reference throws "Cannot read properties
  // of undefined (reading 'rest')" the instant it's invoked without `sb` as receiver.
  return (table: string) => sb.from(table) as ReturnType<LooseFrom>;
}
