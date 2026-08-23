// SPEC-0033 R4a — the inventory list's URL contract.
//
// Two jobs, both security-relevant. It keeps the list's paging state in the URL so opening a row
// never loses it, and it makes the `?from=` return path SAFE: the value is validated, restricted to
// the inventory list, and REBUILT from validated parts, so a hostile string can never become an
// off-site link or an open redirect.

import { describe, expect, it } from "vitest";
import {
  EMPTY_INVENTORY_LIST_CONTEXT,
  INVENTORY_LIST_MAX_PAGE,
  INVENTORY_LIST_PATH,
  INVENTORY_QUERY_MAX_LENGTH,
  inventoryItemHref,
  inventoryListHref,
  inventoryListOffset,
  inventoryPageCount,
  parseInventoryListContext,
  parseInventoryPage,
  parseInventoryQuery,
  parseInventoryReturnTo,
  readInventoryListRequest,
} from "./inventory-list-context";
import { INVENTORY_LIST_PAGE_SIZE } from "./inventory-snapshot-reads";

describe("inventory list url state", () => {
  it("reads a page number and refuses anything that is not one", () => {
    expect(parseInventoryPage("3")).toBe(3);
    expect(parseInventoryPage(String(INVENTORY_LIST_MAX_PAGE))).toBe(INVENTORY_LIST_MAX_PAGE);
    for (const raw of [undefined, "", "0", "-1", "1.5", "٣", "abc", "1e3", " 2", "99999999"]) {
      expect(parseInventoryPage(raw), String(raw)).toBe(1);
    }
    // Beyond the deepest addressable page is page one, not a pointless deep scan.
    expect(parseInventoryPage(String(INVENTORY_LIST_MAX_PAGE + 1))).toBe(1);
  });

  it("cleans search text instead of refusing a page the user just opened", () => {
    expect(parseInventoryQuery("  سماد  ")).toBe("سماد");
    expect(parseInventoryQuery(undefined)).toBe("");
    // Control characters become spaces so the value stays searchable rather than being refused.
    expect(parseInventoryQuery("a\u0000b\u001fc")).toBe("a b c");
    expect(parseInventoryQuery("\n\t ")).toBe("");
    // Over-long text NARROWS the search rather than raising 22023 from the RPC.
    const long = "س".repeat(INVENTORY_QUERY_MAX_LENGTH + 20);
    expect(parseInventoryQuery(long)).toHaveLength(INVENTORY_QUERY_MAX_LENGTH);
  });

  it("parses a whole context and drops a filter the scope may not use", () => {
    expect(parseInventoryListContext({ q: " سماد ", filter: "below_reorder", page: "2" }, "operational"))
      .toEqual({ query: "سماد", filter: "below_reorder", page: 2 });
    expect(parseInventoryListContext({ filter: "uncosted" }, "operational"))
      .toEqual(EMPTY_INVENTORY_LIST_CONTEXT);
    expect(parseInventoryListContext({ filter: "uncosted" }, "finance").filter).toBe("uncosted");
  });

  it("builds one canonical url, omitting every default", () => {
    expect(inventoryListHref()).toBe(INVENTORY_LIST_PATH);
    expect(inventoryListHref({ filter: "all", page: 1, query: "" })).toBe(INVENTORY_LIST_PATH);
    expect(inventoryListHref({ query: "سماد" })).toBe("/inventory?q=%D8%B3%D9%85%D8%A7%D8%AF");
    expect(inventoryListHref({ filter: "unknown", page: 3 })).toBe("/inventory?filter=unknown&page=3");
  });

  it("carries the list state into the row link, and nothing else", () => {
    const id = "22222222-2222-4222-8222-222222222221";
    expect(inventoryItemHref(id, EMPTY_INVENTORY_LIST_CONTEXT)).toBe(`/inventory/${id}`);
    expect(inventoryItemHref(id, { query: "", filter: "below_reorder", page: 2 }))
      .toBe(`/inventory/${id}?from=%2Finventory%3Ffilter%3Dbelow_reorder%26page%3D2`);
  });

  it("normalises a request to exactly one canonical url", () => {
    // Already canonical: no redirect, and the parsed context comes back with it.
    expect(readInventoryListRequest({}, "finance"))
      .toEqual({ context: EMPTY_INVENTORY_LIST_CONTEXT, redirectTo: null });
    expect(readInventoryListRequest({ filter: "unknown", page: "2" }, "finance"))
      .toEqual({ context: { query: "", filter: "unknown", page: 2 }, redirectTo: null });

    // Every non-canonical spelling of "the default list" collapses to the bare path.
    for (const params of [{ filter: "all" }, { page: "1" }, { q: "" }, { page: "0" }, { filter: "nope" }]) {
      expect(readInventoryListRequest(params, "finance").redirectTo, JSON.stringify(params))
        .toBe(INVENTORY_LIST_PATH);
    }
    // A filter the scope may not use is normalised away rather than echoed back.
    expect(readInventoryListRequest({ filter: "uncosted" }, "operational").redirectTo)
      .toBe(INVENTORY_LIST_PATH);
    expect(readInventoryListRequest({ filter: "uncosted" }, "finance").redirectTo).toBeNull();
    // Over-long search text narrows, so the url it lands on is the narrowed one.
    const long = "س".repeat(INVENTORY_QUERY_MAX_LENGTH + 5);
    expect(readInventoryListRequest({ q: long }, "finance").redirectTo)
      .toBe(inventoryListHref({ query: parseInventoryQuery(long) }));
  });

  it("never loops: the url it redirects to is itself canonical", () => {
    // An encoding difference (`%20` versus `+`) must not make a canonical request look otherwise.
    for (const params of [{ q: "a b" }, { q: "سماد", filter: "unknown", page: "3" }, { page: "0" }]) {
      const first = readInventoryListRequest(params, "finance");
      const target = first.redirectTo ?? inventoryListHref(first.context);
      const search = new URLSearchParams(target.split("?")[1] ?? "");
      const second = readInventoryListRequest({
        q: search.get("q") ?? undefined,
        filter: search.get("filter") ?? undefined,
        page: search.get("page") ?? undefined,
      }, "finance");
      expect(second.redirectTo, target).toBeNull();
    }
  });

  it("turns a page number into the offset the RPC is asked for", () => {
    expect(inventoryListOffset(1)).toBe(0);
    expect(inventoryListOffset(3)).toBe(2 * INVENTORY_LIST_PAGE_SIZE);
    expect(inventoryPageCount("0")).toBe(1);
    expect(inventoryPageCount("20")).toBe(1);
    expect(inventoryPageCount("21")).toBe(2);
    // Exact totals stay exact: a bigint beyond 2^53 must still page correctly.
    expect(inventoryPageCount("9007199254740993", 1)).toBe(9007199254740993);
  });
});

describe("inventory return path", () => {
  it("accepts the inventory list and rebuilds it from validated parts", () => {
    expect(parseInventoryReturnTo("/inventory", "finance")).toBe("/inventory");
    expect(parseInventoryReturnTo("/inventory?filter=unknown&page=2", "finance"))
      .toBe("/inventory?filter=unknown&page=2");
    // Unknown parameters are dropped, the known ones are re-validated, and a fragment is discarded.
    expect(parseInventoryReturnTo("/inventory?page=0&filter=nonsense&evil=1#x", "finance"))
      .toBe("/inventory");
    // A filter the scope may not use does not survive the round trip.
    expect(parseInventoryReturnTo("/inventory?filter=uncosted", "operational")).toBe("/inventory");
    expect(parseInventoryReturnTo("/inventory?filter=uncosted", "finance")).toBe("/inventory?filter=uncosted");
  });

  it("never leaves the site, whatever it is handed", () => {
    for (const hostile of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "http://evil.example/inventory",
      "javascript:alert(1)",
      "mailto:a@b.example",
      "//evil.example/inventory",
      "/inventory\\@evil.example",
      " /inventory",
      "\t/inventory",
      "/inv\u0000entory",
      "inventory",
      "",
      undefined,
    ]) {
      expect(parseInventoryReturnTo(hostile, "finance"), String(hostile)).toBe(INVENTORY_LIST_PATH);
    }
  });

  it("refuses to become a general-purpose internal redirector", () => {
    // Only the inventory list. Any other internal route — however harmless it looks — is refused,
    // because accepting one means accepting the next.
    for (const other of [
      "/inventory/dashboard",
      "/inventory/22222222-2222-4222-8222-222222222221",
      "/purchase-requests",
      "/finance/dashboard",
      "/dashboard",
      "/inventory/",
    ]) {
      expect(parseInventoryReturnTo(other, "finance"), other).toBe(INVENTORY_LIST_PATH);
    }
    // An absurdly long value is refused before it is parsed at all.
    expect(parseInventoryReturnTo(`/inventory?q=${"a".repeat(400)}`, "finance")).toBe(INVENTORY_LIST_PATH);
  });

  it("is idempotent, so a link built from it never drifts", () => {
    for (const raw of ["/inventory", "/inventory?q=سماد&filter=unknown&page=4", "/inventory?page=9"]) {
      const once = parseInventoryReturnTo(raw, "finance");
      expect(parseInventoryReturnTo(once, "finance")).toBe(once);
    }
  });
});
