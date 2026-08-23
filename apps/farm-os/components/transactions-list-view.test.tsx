import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TransactionsListView } from "@/app/(app)/transactions/transactions-list-view";
import type { TransactionsSnapshot } from "@/lib/transactions snapshot";

const EXPENSE_ID = "22222222-2222-4222-8222-222222222221";
const COLLECTION_ID = "33333333-3333-4333-8333-333333333331";

const snapshot: TransactionsSnapshot = {
  rowLimit: 400,
  counts: { expense: 5, sale: 0, collection: 3, custody: 0, pendingPrice: 0 },
  rows: [
    {
      id: EXPENSE_ID, type: "expense", event_date: null, category: "تشغيل", description: "سماد",
      crop: null, quantity: null, unit: null, pending_price: false, party_id: null, party_name: null,
      amount: null, direction: "out", collected_by: null, movement_type: null,
    },
    {
      id: COLLECTION_ID, type: "collection", event_date: "2026-08-22", category: null, description: null,
      crop: null, quantity: null, unit: null, pending_price: false, party_id: null, party_name: null,
      amount: "1250.00", direction: "in", collected_by: "المحاسب", movement_type: null,
    },
  ],
};

describe("TransactionsListView", () => {
  it("renders exact counts, unknown expense money, and only truthful record links", () => {
    const html = renderToStaticMarkup(<TransactionsListView snapshot={snapshot} context={{ type: null, query: "سماد" }} />);
    expect(html).toContain("٨ معاملة في السجل");
    expect(html).toContain("المبلغ غير مسجل");
    expect(html).toContain(`/expenses/${EXPENSE_ID}?from=`);
    expect(html).not.toContain(`/collections/${COLLECTION_ID}`);
    expect(html).not.toContain("/finance/revenue-reports");
  });

  it("always discloses per-source bounds and omits client-table/export wiring", () => {
    const html = renderToStaticMarkup(<TransactionsListView snapshot={snapshot} context={{ type: null, query: "" }} />);
    expect(html).toContain("هذه قائمة تشغيل محدودة وليست دفترًا زمنيًا كاملاً");
    expect(html).toContain("من أحدث كل نوع على حدة");
    expect(html).toContain("ولا يتوفر تصدير جزئي");
    expect(html).not.toContain("<table");
  });
});
