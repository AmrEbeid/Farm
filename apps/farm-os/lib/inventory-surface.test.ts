// SPEC-0033 R4a — the inventory list and item 360 SURFACES.
//
// The parser tests prove the payload contract. These prove the pages actually use it: one bounded
// snapshot each, no direct table read, no money rendered outside a finance branch, no route offered
// to a role the route will bounce, and nothing that can only be read by scrolling sideways.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { visibleModulesForRole } from "./nav";
import { PAGE_HELP } from "./page-help";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/**
 * The file with its comment lines removed. Several of these files EXPLAIN the old `inventory_bin[0]`
 * bug in prose, so a "this file never touches inventory_bin" check has to look at the code.
 */
const code = (source: string) =>
  source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");

const listPage = read("app/(app)/inventory/page.tsx");
const listView = read("app/(app)/inventory/inventory-list-view.tsx");
const itemPage = read("app/(app)/inventory/[itemId]/page.tsx");
const itemView = read("app/(app)/inventory/[itemId]/inventory-item-view.tsx");
const movementsPage = read("app/(app)/inventory/movements/page.tsx");
const coveragePage = read("app/(app)/inventory/[itemId]/coverage/page.tsx");
const parser = read("lib/inventory-snapshot-reads.ts");
const migration = read("supabase/migrations/20260823140000_exact_inventory_list_and_item_snapshots.sql");

const VIEWS: [string, string][] = [["list view", listView], ["item view", itemView]];
const PAGES: [string, string][] = [["list page", listPage], ["item page", itemPage]];

/** Every literal route root a link in these views may point at. */
const ALLOWED_LINK_ROOTS = ["/inventory", "/purchase-requests"];

function hrefs(source: string): string[] {
  return [...source.matchAll(/href=[{"]`?(\/[A-Za-z0-9\-_/]*)/g)].map((match) => match[1]);
}

describe("inventory surfaces read one bounded snapshot", () => {
  it("calls exactly one snapshot RPC per page and reads no table directly", () => {
    expect(listPage.split('supabase.rpc("fn_inventory_list_snapshot"').length - 1).toBe(1);
    expect(itemPage.split('supabase.rpc("fn_inventory_item_snapshot"').length - 1).toBe(1);
    for (const [name, source] of [...PAGES, ...VIEWS]) {
      const body = code(source);
      expect(body, name).not.toContain(".from(");
      expect(body, name).not.toContain("Promise.all(");
      // The first-bin bug this slice exists to fix must be impossible to reintroduce here.
      expect(body, name).not.toContain("inventory_bin");
    }
    expect(listPage).toContain("parseInventoryListSnapshot(data, {");
    expect(itemPage).toContain("parseInventoryItemSnapshot(data, {");
    for (const [name, source] of PAGES) {
      expect(source, name).toContain("scope,");
    }
    expect(listPage).toContain("query: context.query");
    expect(listPage).toContain("filter: context.filter");
    expect(listPage).toContain("offset: inventoryListOffset(context.page)");
    expect(itemPage).toContain("movementLimit: INVENTORY_ITEM_MOVEMENT_LIMIT");
    expect(itemPage).toContain("purchaseLimit: INVENTORY_ITEM_PURCHASE_LIMIT");
  });

  it("asks for the page it is going to render, and no more", () => {
    expect(listPage).toContain("p_limit: INVENTORY_LIST_PAGE_SIZE");
    expect(listPage).toContain("p_offset: inventoryListOffset(context.page)");
    expect(itemPage).toContain("p_movement_limit: INVENTORY_ITEM_MOVEMENT_LIMIT");
    expect(itemPage).toContain("p_purchase_limit: INVENTORY_ITEM_PURCHASE_LIMIT");
    expect(listPage).toContain("context.page > pageCount");
    expect(listPage).toContain("inventoryListHref({ ...context, page: pageCount })");
  });

  it("surfaces a read failure instead of rendering an empty store", () => {
    for (const [name, source] of PAGES) {
      expect(source, name).toContain("if (error) throw error;");
    }
  });

  it("answers not-found for an item outside the active organization", () => {
    // The RPC returns SQL NULL for an unknown id AND for another organization's id, so this 404
    // cannot be used to learn that an id exists somewhere else.
    expect(itemPage).toContain("if (data === null) notFound();");
    expect(itemPage).toContain("if (!UUID.test(itemId)) notFound();");
  });
});

describe("inventory surfaces keep the role scope in one place", () => {
  it("derives the payload scope from the membership role on both pages", () => {
    for (const [name, source] of PAGES) {
      expect(source, name).toContain("inventoryScopeForRole(membership.role)");
    }
  });

  it("no longer bounces the storekeeper off the list or the item file", () => {
    for (const [name, source] of PAGES) {
      expect(source, name).not.toContain('redirect("/inventory/dashboard")');
      expect(source, name).not.toContain('role === "storekeeper"');
    }
  });

  it("keeps the money-bearing coverage page gated server-side", () => {
    expect(coveragePage).toContain('m.role === "storekeeper"');
    expect(coveragePage).toContain('redirect("/inventory/dashboard")');
  });

  it("restores the list to the storekeeper's navigation and nothing else", () => {
    const ids = visibleModulesForRole("storekeeper").flatMap((m) => m.pages).map((p) => p.id);
    expect(ids).toContain("inventory");
    expect(ids).toContain("inventory-dashboard");
    // Every role keeps the page; the payload, not the route, is what differs.
    for (const role of ["owner", "farm_manager", "accountant", "agri_engineer", "supervisor"] as const) {
      expect(visibleModulesForRole(role).flatMap((m) => m.pages).map((p) => p.id), role)
        .toContain("inventory");
    }
  });
});

describe("inventory surfaces never render money outside a finance branch", () => {
  it("only ever formats money from a narrowed finance value", () => {
    for (const [name, source] of VIEWS) {
      const calls = [...source.matchAll(/moneyText\(([^)]*)\)/g)].map((match) => match[1]);
      expect(calls.length, name).toBeGreaterThan(0);
      for (const argument of calls) {
        expect(
          argument.startsWith("finance.") || argument.startsWith("snapshot.valuation."),
          `${name}: moneyText(${argument}) is not narrowed to the finance scope`,
        ).toBe(true);
      }
    }
  });

  it("guards every money-bearing destination behind the finance scope", () => {
    // The coverage page and the purchase-request page both render money to any member, so neither
    // may be linked from the operational payload — which has no purchase-request id to link with.
    expect(listView).toContain('row.state === "below_reorder" && scope === "finance" && (');
    expect(itemView).toContain("{finance && (");
    expect(itemView).toContain('href={`/purchase-requests/${finance.prId}`}');
    expect(listView).not.toContain("/purchase-requests");
  });

  it("does not select or render supplier identity on the Storekeeper movements path", () => {
    expect(movementsPage).toContain('const operational = membership.role === "storekeeper"');
    expect(movementsPage).toContain("if (operational) {");
    expect(movementsPage).toContain(".select(baseSelection)");
    expect(movementsPage).toContain('.select(`${baseSelection}, suppliers(name)`)');
    expect(movementsPage).toContain('...(operational ? [] : [{ id: "supplier"');
    expect(movementsPage).toContain('...(operational ? {} : { supplier:');
  });

  it("keeps the bulk-import workbench off the operational store surface", () => {
    expect(listView).toContain('{snapshot.scope === "finance" && (');
    const importAt = listView.indexOf("<ImportPanel");
    const guardAt = listView.lastIndexOf('{snapshot.scope === "finance" && (', importAt);
    expect(guardAt).toBeGreaterThan(-1);
    expect(importAt).toBeGreaterThan(guardAt);
  });

  it("links only to routes every role that can reach these pages may open", () => {
    for (const [name, source] of VIEWS) {
      const links = hrefs(source);
      expect(links.length, name).toBeGreaterThan(0);
      for (const href of links) {
        expect(
          ALLOWED_LINK_ROOTS.some((root) => href === root || href.startsWith(`${root}/`)),
          `${name}: ${href}`,
        ).toBe(true);
      }
    }
  });
});

describe("inventory surfaces stay honest", () => {
  it("never lets an unrecorded balance read as zero", () => {
    expect(listView).toContain("لا يوجد رصيد مسجل في أي مخزن — وهذه ليست «صفر»");
    expect(itemView).toContain("هذه ليست حالة «لا يوجد مخزون»");
    for (const [name, source] of VIEWS) {
      expect(source, name).not.toMatch(/\?\?\s*0\b/);
      expect(source, name).not.toMatch(/\|\|\s*0\b/);
      expect(source, name).not.toContain('"—"');
    }
  });

  it("never calls the reorder reading a coverage verdict", () => {
    expect(listView).toContain("قراءة لحظية");
    expect(itemView).toContain("تغطية الصنف");
    for (const [name, source] of VIEWS) {
      expect(source, name).not.toMatch(/تغطية المخزون الآن|نسبة التغطية|shortage/i);
    }
  });

  it("states the size of the gap beside every valuation total", () => {
    expect(listView).toContain("valuation.unknownCostItems");
    expect(listView).toContain("valuation.unknownStockItems");
    expect(listView).toContain("الإجمالي ليس قيمة المخزون كله");
  });

  it("publishes the exact total behind every bounded sample", () => {
    expect(listView).toContain("صفحة واحدة من القائمة، لا القائمة كلها");
    expect(itemView).toContain("snapshot.movementTotal");
    expect(itemView).toContain("snapshot.purchaseTotal");
    expect(itemView).toContain("snapshot.openPurchaseTotal");
  });

  it("says so when the inventory source is not verified", () => {
    for (const [name, source] of VIEWS) {
      expect(source, name).toContain("isAuthoritative(snapshot.authority.inventory)");
      expect(source, name).toContain("تغطية مصدر المخزون غير مؤكدة");
    }
  });
});

describe("inventory surfaces are phone-first Arabic RTL", () => {
  it("renders every number and date through the Arabic-Indic helpers", () => {
    for (const [name, source] of VIEWS) {
      expect(source, name).not.toMatch(/toLocaleString\(\)|\bnum\(|\begp\(/);
      expect(source, name).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    expect(listView).toContain("exactCount(");
    expect(itemView).toContain("fmtDate(");
  });

  it("has no axis to overflow on: one column, no table, no chart", () => {
    for (const [name, source] of VIEWS) {
      for (const forbidden of [
        "SimpleTable", "FilterableTable", "MasterTable", "DataTable", "<table",
        "CategoryDoughnut", "CategoryBarChart", "TrendLineChart", "recharts",
        "overflow-x", "whitespace-nowrap", "min-w-[",
      ]) {
        expect(source, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
      expect(source, name).toContain('className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4"');
      expect(source, name).not.toMatch(/text-2xl|text-3xl/);
    }
  });

  it("keeps every control at least 44px", () => {
    for (const [name, source] of VIEWS) {
      const controls = source.split("minHeight: 44").length - 1;
      expect(controls, name).toBeGreaterThanOrEqual(3);
      // Every button-styled element carries the touch target, not just some of them.
      expect(controls, name).toBeGreaterThanOrEqual(source.split("fos-btn fos-btn--").length - 1);
    }
  });

  it("works without JavaScript: the search is a GET form and every control is a link", () => {
    expect(listView).toContain('<form action="/inventory" method="get" role="search"');
    for (const [name, source] of VIEWS) {
      expect(source, name).not.toContain('"use client"');
      expect(source, name).not.toContain("useState");
      expect(source, name).not.toContain("onClick");
    }
  });
});

describe("inventory surfaces are documented where the product explains itself", () => {
  it("keeps the page help truthful about the two new behaviours", () => {
    expect(PAGE_HELP.inventory.avoid).toContain("«بلا رصيد مسجل»");
    expect(PAGE_HELP.inventory.avoid).toContain("قراءة لحظية");
    expect(PAGE_HELP["item-360"].why).toContain("أكثر من موقع");
    expect(PAGE_HELP["item-360"].avoid).toContain("عيّنة محدودة");
  });
});

describe("the inventory snapshot contract itself", () => {
  it("builds the operational payload without the money keys rather than hiding them", () => {
    // Both branches are spelled as "add these keys for finance", never "remove these for the store".
    expect(migration).toContain("v_scope := case when v_role = 'storekeeper' then 'operational' else 'finance' end");
    expect(migration).toContain("if p_filter = 'uncosted' and v_scope <> 'finance'");
    expect(migration).not.toMatch(/jsonb\s*-\s*'unit_cost'|#-\s*'\{unit_cost/);
  });

  it("stays locked to authenticated callers and to the active organization", () => {
    for (const fn of [
      "public.fn_inventory_list_snapshot(uuid, text, text, integer, integer)",
      "public.fn_inventory_item_snapshot(uuid, uuid, integer, integer)",
    ]) {
      expect(migration).toContain(`revoke all on function ${fn} from public;`);
      expect(migration).toContain(`revoke all on function ${fn} from anon;`);
      expect(migration).toContain(`grant execute on function ${fn} to authenticated;`);
    }
    expect(migration.split("security invoker").length - 1).toBe(2);
    expect(migration.split("set search_path = ''").length - 1).toBe(2);
    expect(migration.split("active_org_id").length - 1).toBe(2);
  });

  it("leaves every count and quantity as text", () => {
    expect(parser).toContain("ExactCountString");
    for (const [name, source] of VIEWS) {
      expect(source, name).not.toContain("Number(");
      expect(source, name).not.toContain("parseInt(");
    }
  });
});
