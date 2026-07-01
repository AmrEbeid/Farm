import { describe, it, expect } from "vitest";
import { looseFrom } from "./db-loose";

// Mirrors the real bug: Supabase's PostgrestClient.from() reads internal state off
// `this` (e.g. `this.rest`), so a mock that does the same catches a regression that a
// naive `{ from: (table) => ... }` object (which doesn't need `this`) would miss.
class FakeSupabaseClient {
  restBaseUrl = "https://example.test/rest/v1";

  from(table: string) {
    // Reads `this` immediately inside from() itself — exactly like the real
    // PostgrestClient.from(), which throws right away on a detached call (before any
    // further chaining like .select() even happens).
    const base = this.restBaseUrl;
    return { select: (cols: string) => `${base}/${table}?select=${cols}` };
  }
}

describe("looseFrom", () => {
  it("keeps the `this` binding to the Supabase client instance", () => {
    const sb = new FakeSupabaseClient();
    const fromLoose = looseFrom(sb as unknown as { from: (table: string) => unknown });
    const select = (fromLoose("sectors") as unknown as { select: (c: string) => string }).select;
    expect(() => select("*")).not.toThrow();
    expect(select("*")).toBe("https://example.test/rest/v1/sectors?select=*");
  });

  it("would have thrown if from() were re-exported as a bare, detached reference", () => {
    const sb = new FakeSupabaseClient();
    const detached = sb.from; // the bug this test guards against
    expect(() => detached("sectors")).toThrow(TypeError);
  });
});
