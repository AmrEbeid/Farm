import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIONS } from "./record-actions";
import { visibleModulesForRole } from "./nav";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const component = read("app/(app)/inventory/dashboard/storekeeper-home.tsx");
const dashboardPage = read("app/(app)/inventory/dashboard/page.tsx");
const receivePage = read("app/(app)/m/receive/page.tsx");
const stockTakePage = read("app/(app)/inventory/stock-take/page.tsx");
const stockTakeAction = read("app/(app)/inventory/stock-take/actions.ts");
const stockTakeSheet = read("components/StockTakeSheet.tsx");
const inventoryListPage = read("app/(app)/inventory/page.tsx");
const inventoryItemPage = read("app/(app)/inventory/[itemId]/page.tsx");
const inventoryCoveragePage = read("app/(app)/inventory/[itemId]/coverage/page.tsx");
const reportsHub = read("app/(app)/reports/page.tsx");
const parser = read("lib/storekeeper-home-reads.ts");

const ALLOWED_LINK_ROOTS = ["/m/receive", "/inventory"];

function hrefs(source: string): string[] {
  return [...source.matchAll(/href=[{"]`?(\/[A-Za-z0-9\-_/]*)/g)].map((match) => match[1]);
}

describe("storekeeper home surface", () => {
  it("uses one bounded storekeeper snapshot and no direct table reads", () => {
    expect(component.split('supabase.rpc("fn_storekeeper_home_snapshot"').length - 1).toBe(1);
    expect(component).not.toContain(".from(");
    expect(component).not.toContain("Promise.all(");
    expect(component).toContain("parseStorekeeperHomeSnapshot(data, orgId, asOf)");
    expect(component).toContain("STOREKEEPER_HOME_DETAIL_LIMIT");
    expect(component).toContain("cairoTodayIso(new Date())");
  });

  it("requires membership once and branches the storekeeper before any legacy query", () => {
    expect(dashboardPage.split("await requireMembership()").length - 1).toBe(1);
    const gate = dashboardPage.indexOf("const m = await requireMembership()");
    const branch = dashboardPage.indexOf('if (m.role === "storekeeper") return <StorekeeperHome');
    expect(gate).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(gate);
    // No legacy read, and no Supabase client at all, runs for this role before the branch.
    expect(dashboardPage.indexOf("await createClient()")).toBeGreaterThan(branch);
    for (const legacy of ['.from("inventory_items")', '.from("purchase_requests")']) {
      expect(dashboardPage.indexOf(legacy)).toBeGreaterThan(branch);
    }
    expect(dashboardPage).not.toContain('.from("suppliers")');
    expect(dashboardPage.indexOf("Promise.all([")).toBeGreaterThan(branch);
  });

  it("leaves the Owner/Manager inventory dashboard workflow unchanged", () => {
    expect(dashboardPage).toContain("<CategoryDoughnut");
    expect(dashboardPage).toContain("<FilterableTable");
    expect(dashboardPage).toContain('href="/inventory/dashboard?filter=reorder"');
    expect(dashboardPage).toContain("currentInventoryState(bins, it.reorder_point, it.min_stock)");
    expect(dashboardPage).toContain("<OnboardingChecklist role={m.role} />");
  });

  it("shows exactly four recorded storekeeper KPIs", () => {
    expect(component.split("<KpiCard").length - 1).toBe(4);
    for (const label of ["جاهز للاستلام", "متأخر عن موعده", "تحت حد إعادة الطلب", "صرف اليوم"]) {
      expect(component).toContain(label);
    }
  });

  it("puts attention and actions before the numbers", () => {
    const actions = component.indexOf('href="/m/receive" className="fos-btn fos-btn--primary');
    const attentionInbox = component.indexOf("<AttentionInbox items={attention} />");
    const kpis = component.indexOf("<KpiCard");
    expect(actions).toBeGreaterThan(-1);
    expect(attentionInbox).toBeGreaterThan(actions);
    expect(kpis).toBeGreaterThan(attentionInbox);
  });

  it("carries no chart, no card wall and no oversized header", () => {
    for (const forbidden of ["CategoryDoughnut", "CategoryBarChart", "recharts", "FilterableTable", "SimpleTable"]) {
      expect(component).not.toContain(forbidden);
    }
    expect(component).toContain('className="mx-auto flex max-w-md flex-col gap-5 p-4"');
    expect(component).toContain("<PageHeader");
    expect(component).not.toMatch(/text-2xl|text-3xl/);
    // One two-column KPI grid only — never a wall of cards.
    expect(component.split('className="grid grid-cols-2 gap-3"').length - 1).toBe(1);
    expect(component).not.toContain("lg:grid-cols-3");
  });

  it("links only to routes the storekeeper may open", () => {
    const links = hrefs(component);
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      expect(ALLOWED_LINK_ROOTS.some((root) => href === root || href.startsWith(`${root}/`))).toBe(true);
    }
    expect(component).toContain('href="/m/receive"');
    expect(component).toContain('href="/inventory/stock-take"');
    expect(component).toContain('href="/inventory/movements"');
    expect(component).not.toContain('href="/inventory"');
    expect(component).not.toContain("`/inventory/${row.itemId}`");
    expect(component).not.toContain("`/inventory/${row.itemId}/coverage`");
    // Money-bearing or role-forbidden destinations never appear. `/purchase-requests/[prId]` renders
    // التكلفة التقديرية and per-line costs to any member, so a receipt row never drills into it.
    for (const forbidden of ["/purchase-requests", "/plans", "/transactions", "/approvals", "/finance", "/suppliers", "/people", "/m/execute", "/record"]) {
      expect(component).not.toContain(forbidden);
    }
  });

  it("keeps every control at least 44px and free of emoji", () => {
    const controls = component.split("minHeight: 44").length - 1;
    expect(controls).toBe(component.split("fos-btn fos-btn--").length - 1);
    expect(controls).toBeGreaterThanOrEqual(4);
    expect(component).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("exposes no finance value or accounting term anywhere", () => {
    expect(component).not.toMatch(/est_cost|unit_cost|egpExact|moneyNumber|جنيه|تكلفة|سعر|أجر|مصروف|ميزانية|موازنة/i);
    expect(parser).not.toMatch(/est_cost|unit_cost|egpExact|price/i);
    expect(parser).not.toMatch(/\bamount\b/i);
  });

  it("names no person and reads no person table", () => {
    expect(component).not.toMatch(/personName|person_id|people|requested_by|approved_by|supplier/i);
    expect(parser).not.toMatch(/personName|person_id|\bpeople\b|requested_by|approved_by|supplier/i);
  });

  it("never claims a completed stock-take and offers الجرد only as an action", () => {
    // No count, no KPI, no list of stock-takes anywhere — fn_record_stock_take writes no provenance
    // row and posts nothing at all when the count matches, so any such number would be fabricated.
    expect(component).not.toMatch(/stockTake|stockTakes|جرد مكتمل|تم الجرد|عمليات الجرد|عدد الجرد/);
    expect(parser).not.toMatch(/stockTake|stockTakes/);
    expect(component).toContain('href="/inventory/stock-take"');
    expect(component).toContain("ابدأ جردًا");
    expect(component).toContain("الجرد أداة المطابقة مع الواقع، ولا يُسجَّل كإنجاز هنا");
    // Adjustment/loss/expiry rows are labelled recorded movements, explicitly not a stock-take log.
    expect(component).toContain("حركات مسجلة تحتاج تفسيرًا");
    expect(component).toContain("ليست سجل جرد، لأن الجرد لا يترك أثرًا مسجلًا عند تطابق العد");
    expect(component).toContain("MOVEMENT_TYPE_AR[row.type]");
  });

  it("counts each physical location independently and passes that location to the RPC", () => {
    expect(stockTakePage).toContain("inventory_bin(location, on_hand)");
    expect(stockTakePage).toContain("flatMap((it)");
    expect(stockTakePage).toContain("location: bin.location");
    expect(stockTakeSheet).toContain("countKey(it)");
    expect(stockTakeSheet).toContain("recordStockTake(it.id, it.location");
    expect(stockTakeAction).toContain("p_location: location");
  });

  it("server-gates the money-bearing coverage page for the storekeeper", () => {
    // SPEC-0033 R4a: `/inventory` and `/inventory/[itemId]` no longer bounce this role, because they
    // now read a role-scoped snapshot whose storekeeper payload carries no money, supplier or
    // counterparty key at all. `/inventory/[itemId]/coverage` still renders the engine's
    // money-bearing surface, so its server-side redirect stays exactly as it was.
    expect(inventoryCoveragePage).toContain('m.role === "storekeeper"');
    expect(inventoryCoveragePage).toContain('redirect("/inventory/dashboard")');
    for (const page of [inventoryListPage, inventoryItemPage]) {
      expect(page).not.toContain('redirect("/inventory/dashboard")');
      // The role still decides the PAYLOAD, in one place, and the RPC decides it again server-side.
      expect(page).toContain("inventoryScopeForRole(membership.role)");
    }
  });

  it("labels counts as recorded and never claims completeness without verified authority", () => {
    expect(component).toContain("المسجل الآن");
    expect(component).toContain("الأرقام هنا مسجلة فقط، وتغطية مصدر المخزون غير مؤكدة");
    expect(component).toContain("attention.length > 0 || inventoryVerified ? <AttentionInbox");
    expect(component).toContain('inventoryVerified ? "لا يوجد شغل مخزن مفتوح الآن"');
    expect(component).toContain("لا يوجد شغل مخزن مسجل الآن");
    expect(component).toContain("isAuthoritative(snapshot.authority.inventory)");
    // Recorded counts are never blanked by a partial source.
    expect(component).not.toContain('"—"');
  });

  it("states unknown stock as unknown rather than zero", () => {
    expect(component).toContain("بلا رصيد مسجل");
    expect(component).toContain("هذه ليست حالة «لا يوجد مخزون»");
    expect(component).toContain("فلا تُقرأ كصفر ولا تدخل في حساب الحد");
    expect(component).toContain("قراءة لحظية لمجموع كل مخازن الصنف مقابل حده المسجل");
  });

  it("offers receiving only for unblocked requests and names every recorded blocker", () => {
    expect(component).toContain('action="receive"');
    expect(component).toContain('{action === "receive" && (');
    expect(component).toContain('drivers.receivable.map((row) => <ReceiptRow key={row.id} row={row} action="receive" />)');
    expect(component).toContain('drivers.blocked.map((row) => <ReceiptRow key={row.id} row={row} action="none" />)');
    expect(component).toContain("بند بلا كمية مسجلة");
    // A line unit that differs from the item's unit is NOT a blocker on the shipped receipt path
    // (fn_post_receipt passes NULL so fn_post_movement uses the item's own unit). The home says what
    // the receipt will actually be recorded in instead of inventing a gate.
    expect(component).toContain("line.itemUnit ?? line.unit");
    expect(component).toContain("مسجل على الطلب بـ");
    // The receive shortcut is never presented as a guarantee that the receipt will post.
    expect(component).toContain("وقد يرفضه النظام إن تجاوزت الكمية المتبقية على الطلب");
  });

  it("formats every displayed number and date in Arabic-Indic digits", () => {
    expect(component).toContain('new Intl.NumberFormat("ar-EG")');
    expect(component).toContain("formatDecimalArabic");
    expect(component).toContain("fmtDate(snapshot.asOf)");
    expect(component).not.toMatch(/toLocaleString\(\)|String\(\s*Number\(/);
  });

  it("shows the recorded total behind every truncated nested sample", () => {
    expect(component).toContain("بند مفتوح آخر");
    expect(component).toContain("BigInt(row.openLineCount) - BigInt(row.lines.length)");
  });

  it("keeps the record launcher receive-only for the storekeeper", () => {
    const storekeeperActions = ACTIONS.filter((action) => action.roles.includes("storekeeper"));
    expect(storekeeperActions.map((action) => action.href)).toEqual(["/m/receive"]);
  });

  it("keeps every storekeeper receive back-link legal", () => {
    // `/m` rejects the storekeeper (field roles only), so the receive page must send them home.
    expect(receivePage).toContain('requireRole(["storekeeper", "owner", "farm_manager"])');
    expect(receivePage).toContain('m.role === "storekeeper" ? "/inventory/dashboard" : "/m"');
    expect(receivePage).toContain('رجوع {m.role === "storekeeper" ? "إلى المخزون" : "إلى الميدان"}');
    expect(stockTakePage).toContain('requireRole(["owner", "farm_manager", "storekeeper"])');
  });

  it("no longer advertises the money-bearing planning dashboard to field/store roles denied by its route", () => {
    const card = reportsHub
      .split("\n")
      .find((row) => row.includes('href: "/plans/dashboard"'));
    expect(card).toBeDefined();
    expect(card).not.toContain("storekeeper");
    expect(card).not.toContain("supervisor");
    // The route itself is the enforcement; the hub must not offer what it will bounce.
    expect(read("app/(app)/plans/dashboard/page.tsx"))
      .toContain('requireRole(["owner", "accountant", "farm_manager", "agri_engineer"])');
  });

  it("keeps every reports-hub card the storekeeper still sees openable", () => {
    const storekeeperCards = [...reportsHub.matchAll(/href: "(\/[^"]+)"[^\n]*roles: \[([^\]]*)\]/g)]
      .filter((match) => match[2].includes('"storekeeper"'))
      .map((match) => match[1]);
    expect(storekeeperCards).not.toContain("/plans/dashboard");
    expect(storekeeperCards.length).toBeGreaterThan(0);
    for (const href of storekeeperCards) {
      expect(read(`app/(app)${href}/page.tsx`)).not.toMatch(
        /requireRole\(\[(?![^\]]*"storekeeper")/,
      );
    }
  });

  it("keeps the storekeeper's inventory navigation intact", () => {
    const pages = visibleModulesForRole("storekeeper").flatMap((module) => module.pages);
    const ids = pages.map((page) => page.id);
    for (const id of ["inventory-dashboard", "inventory", "inventory-movements", "stock-take", "m-receive"]) {
      expect(ids).toContain(id);
    }
    expect(ids).not.toContain("plans-dashboard");
    expect(ids).not.toContain("plans");
    expect(ids).not.toContain("mobile");
  });
});
