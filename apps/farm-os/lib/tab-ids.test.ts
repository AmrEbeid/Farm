import { describe, expect, it } from "vitest";
import { tabId, tabPanelId } from "./tab-ids";

/**
 * These server-safe helpers MUST stay byte-identical to `@amrebeid/ui`'s client `tabId`/`tabPanelId`
 * (see tab-ids.ts + the RSC "client-fn-from-server" P0 that this mirror exists to avoid). A server
 * panel's id has to match the client Tabs button's `aria-controls`/`aria-labelledby`, so this locks
 * the exact `fos-tab-…` / `fos-tabpanel-…` format — a drift now breaks CI instead of silently
 * mismatching the ARIA wiring at runtime.
 */
describe("tab-ids (server-safe DS mirror)", () => {
  it("tabId → fos-tab-<id>", () => {
    expect(tabId("overview")).toBe("fos-tab-overview");
    expect(tabId("items")).toBe("fos-tab-items");
  });

  it("tabPanelId → fos-tabpanel-<id>", () => {
    expect(tabPanelId("overview")).toBe("fos-tabpanel-overview");
    expect(tabPanelId("items")).toBe("fos-tabpanel-items");
  });

  it("panel and tab ids are distinct for the same key (aria wiring can't collide)", () => {
    expect(tabId("x")).not.toBe(tabPanelId("x"));
  });
});
