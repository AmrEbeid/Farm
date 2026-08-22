import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prepareMarketingSource, REVIEWED_MARKETING_SOURCE_DIGEST } from "./source-import";

const enabled = process.env.RUN_MARKETING_SOURCE_CANONICAL === "1";
const canonical = enabled ? describe : describe.skip;

canonical("canonical Marketing source preparation", () => {
  it("prepares the exact reviewed archive for one atomic import", () => {
    const htmlPath = process.env.MARKETING_SOURCE_HTML;
    const statePath = process.env.MARKETING_SOURCE_STATE;
    if (!htmlPath || !statePath) throw new Error("Canonical Marketing source paths are required");

    const prepared = prepareMarketingSource(
      readFileSync(htmlPath, "utf8"),
      readFileSync(statePath, "utf8"),
    );

    expect(prepared.digest).toBe(REVIEWED_MARKETING_SOURCE_DIGEST);
    expect(prepared.summary).toMatchObject({
      contacts: 1_571,
      selectedContacts: 2,
      records: 101,
      tabs: 25,
      templates: 20,
      mutableStateKeys: 31,
    });
    expect(Object.values(prepared.summary.recordTypes).reduce((total, count) => total + count, 0)).toBe(101);
  });
});
