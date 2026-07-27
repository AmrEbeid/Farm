import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RECONCILIATION_PAGE_SIZE,
  paginate,
  parsePageParam,
  parseReconciliationQueueFilters,
  reconciliationQueueHref,
  reconciliationQueueStatePredicates,
  summarizeRowStates,
  freezeGate,
  approveGate,
  isUuid,
  evidenceTargetLabel,
  correctionTargetLabel,
  buildReviewDecision,
  BATCH_STATUS_AR,
  REVIEW_STATE_AR,
  CLASSIFICATION_AR,
  type DecisionInput,
} from "../reconciliation review";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-9222-222222222222";

describe("reconciliation review — permanent correction identity", () => {
  it("builds an expense identity suitable for read-only frozen display", () => {
    expect(
      correctionTargetLabel({
        targetTable: "expenses",
        referenceLabel: `مرجع ${UUID_A}`,
        dateLabel: "١٥ يناير ٢٠٢٦",
        amountLabel: "٥٠٠ ج.م",
        primaryLabel: "تسميد",
        secondaryLabel: "دفعة سماد",
      }),
    ).toBe(
      `السجل المُصحَّح: مصروف · مرجع ${UUID_A} · ١٥ يناير ٢٠٢٦ · تسميد · دفعة سماد · ٥٠٠ ج.م`,
    );
  });

  it("builds a sale identity without fabricating an absent note", () => {
    expect(
      correctionTargetLabel({
        targetTable: "sales",
        referenceLabel: `مرجع ${UUID_A}`,
        dateLabel: "١٦ يناير ٢٠٢٦",
        amountLabel: "٧٥٠ ج.م",
        primaryLabel: "تمر",
        secondaryLabel: null,
      }),
    ).toBe(`السجل المُصحَّح: بيع · مرجع ${UUID_A} · ١٦ يناير ٢٠٢٦ · تمر · ٧٥٠ ج.م`);
  });

  it("distinguishes otherwise-identical records by their stable reference", () => {
    const common = {
      targetTable: "expenses" as const,
      dateLabel: "١٥ يناير ٢٠٢٦",
      amountLabel: "٥٠٠ ج.م",
      primaryLabel: "تسميد",
      secondaryLabel: "دفعة سماد",
    };
    expect(correctionTargetLabel({ ...common, referenceLabel: `مرجع ${UUID_A}` })).not.toBe(
      correctionTargetLabel({ ...common, referenceLabel: `مرجع ${UUID_B}` }),
    );
  });
});

describe("reconciliation review — pagination", () => {
  it("clamps the page into range and computes a 0-based offset", () => {
    const p = paginate(120, 2, RECONCILIATION_PAGE_SIZE);
    expect(p.pageCount).toBe(3);
    expect(p.page).toBe(2);
    expect(p.offset).toBe(50);
    expect(p.from).toBe(51);
    expect(p.to).toBe(100);
    expect(p.hasPrev).toBe(true);
    expect(p.hasNext).toBe(true);
  });

  it("clamps an over-large or non-numeric page to the last/first page", () => {
    expect(paginate(120, 99).page).toBe(3);
    expect(paginate(120, 0).page).toBe(1);
    expect(paginate(120, Number.NaN).page).toBe(1);
  });

  it("handles an empty batch honestly (no fabricated rows)", () => {
    const p = paginate(0, 1);
    expect(p.total).toBe(0);
    expect(p.pageCount).toBe(1);
    expect(p.from).toBe(0);
    expect(p.to).toBe(0);
    expect(p.hasPrev).toBe(false);
    expect(p.hasNext).toBe(false);
  });

  it("bounds the last page's `to` to the real total", () => {
    const p = paginate(101, 3);
    expect(p.from).toBe(101);
    expect(p.to).toBe(101);
  });

  it("parses the page query param defensively", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam("3")).toBe(3);
    expect(parsePageParam(["4", "5"])).toBe(4);
    expect(parsePageParam("-2")).toBe(1);
    expect(parsePageParam("abc")).toBe(1);
  });
});

describe("reconciliation review — read-only queue filters", () => {
  it("accepts only single allowlisted values", () => {
    expect(
      parseReconciliationQueueFilters({
        classification: "source_addition_candidate",
        state: "unreviewed",
      }),
    ).toEqual({ classification: "source_addition_candidate", state: "unreviewed" });
    expect(
      parseReconciliationQueueFilters({
        classification: ["source_addition_candidate"],
        state: "review_state.eq.executed",
      }),
    ).toEqual({ classification: null, state: null });
  });

  it("maps each state to its exact fixed predicates", () => {
    expect(reconciliationQueueStatePredicates("unreviewed")).toEqual([
      { column: "review_state", value: "unreviewed" },
    ]);
    expect(reconciliationQueueStatePredicates("included")).toEqual([
      { column: "disposition", value: "include" },
    ]);
    expect(reconciliationQueueStatePredicates("held")).toEqual([
      { column: "review_state", value: "reviewed" },
      { column: "disposition", value: "hold" },
    ]);
    expect(reconciliationQueueStatePredicates("rejected")).toEqual([
      { column: "review_state", value: "rejected" },
    ]);
    expect(reconciliationQueueStatePredicates("frozen")).toEqual([
      { column: "frozen", value: true },
    ]);
    expect(reconciliationQueueStatePredicates(null)).toEqual([]);
  });

  it("preserves active filters in pagination and omits page one", () => {
    const filters = {
      classification: "amount_correction_candidate" as const,
      state: "held" as const,
    };
    expect(reconciliationQueueHref(UUID_A, 2, filters)).toBe(
      `/finance/reconciliation/${UUID_A}?classification=amount_correction_candidate&state=held&page=2`,
    );
    expect(reconciliationQueueHref(UUID_A, 1, filters)).not.toContain("page=");
  });
});

describe("reconciliation review — queue source contract", () => {
  const pageSource = readFileSync(
    join(process.cwd(), "app/(app)/finance/reconciliation/[batchId]/page.tsx"),
    "utf8",
  );
  const queueStart = pageSource.indexOf("const statePredicates");
  const queueEnd = pageSource.indexOf("// Resolve correction targets");
  const queueSource = pageSource.slice(queueStart, queueEnd);

  it("keeps whole-batch counts independent from the filtered total", () => {
    expect(pageSource.indexOf("const [total, unreviewed")).toBeGreaterThan(-1);
    expect(pageSource.indexOf("const [total, unreviewed")).toBeLessThan(queueStart);
    expect(queueSource).toContain("const { count: filteredCount");
    expect(queueSource).toContain("paginate(\n    filteredCount ?? 0");
  });

  it("scopes both filtered queries by batch, tenant, and the tenant-safe evidence relation", () => {
    expect(queueSource.match(/\.eq\("batch_id", batchId\)/g)).toHaveLength(2);
    expect(queueSource.match(/\.eq\("org_id", m\.orgId\)/g)).toHaveLength(2);
    expect(queueSource.match(/\.eq\("evidence\.org_id", m\.orgId\)/g)).toHaveLength(2);
    expect(
      queueSource.match(
        /reconciliation_evidence_items!reconciliation_batch_rows_evidence_tenant_fk!inner/g,
      ),
    ).toHaveLength(2);
  });

  it("adds no write or RPC path to the filtered queue", () => {
    expect(queueSource).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(queueSource).toContain(".range(pagination.offset");
  });
});

describe("reconciliation review — row-state summary + gates", () => {
  const rows = [
    { review_state: "unreviewed", disposition: "hold" },
    { review_state: "reviewed", disposition: "include" },
    { review_state: "reviewed", disposition: "hold" },
    { review_state: "rejected", disposition: "hold" },
  ];

  it("counts states and dispositions", () => {
    const c = summarizeRowStates(rows);
    expect(c.total).toBe(4);
    expect(c.unreviewed).toBe(1);
    expect(c.reviewed).toBe(2);
    expect(c.rejected).toBe(1);
    expect(c.included).toBe(1);
    expect(c.held).toBe(1);
    expect(c.decided).toBe(3);
    expect(c.allDecided).toBe(false);
  });

  it("allDecided is false for an empty batch and true only when nothing is unreviewed", () => {
    expect(summarizeRowStates([]).allDecided).toBe(false);
    expect(
      summarizeRowStates([{ review_state: "reviewed", disposition: "include" }]).allDecided,
    ).toBe(true);
  });

  it("blocks freeze unless staged, non-empty, and fully decided", () => {
    expect(freezeGate("reviewed", summarizeRowStates(rows)).canFreeze).toBe(false);
    expect(freezeGate("staged", summarizeRowStates([])).canFreeze).toBe(false);
    expect(freezeGate("staged", summarizeRowStates(rows)).canFreeze).toBe(false);
    const allDecided = summarizeRowStates([
      { review_state: "reviewed", disposition: "include" },
      { review_state: "rejected", disposition: "hold" },
    ]);
    expect(freezeGate("staged", allDecided).canFreeze).toBe(true);
    expect(freezeGate("staged", allDecided).reason).toBeNull();
  });

  it("blocks approve unless reviewed AND owner", () => {
    expect(approveGate("staged", "owner").canApprove).toBe(false);
    expect(approveGate("reviewed", "accountant").canApprove).toBe(false);
    expect(approveGate("reviewed", "owner").canApprove).toBe(true);
  });
});

describe("reconciliation review — evidence provenance labels", () => {
  it("labels a workbook cell", () => {
    expect(
      evidenceTargetLabel({
        origin_kind: "source_workbook_row",
        sheet_name: "المصروفات",
        row_locator: "R42",
        snapshot_target_table: null,
        snapshot_target_id: null,
      }),
    ).toContain("ورقة «المصروفات» صف R42");
  });

  it("labels a production-snapshot target with a short id", () => {
    const label = evidenceTargetLabel({
      origin_kind: "production_snapshot_row",
      sheet_name: null,
      row_locator: null,
      snapshot_target_table: "expenses",
      snapshot_target_id: UUID_A,
    });
    expect(label).toContain("مصروف");
    expect(label).toContain("11111111");
  });
});

describe("reconciliation review — decision payload contract", () => {
  it("rejects a missing/blank reason for every action", () => {
    expect(buildReviewDecision({ action: "hold", reason: "  " }).ok).toBe(false);
    expect(buildReviewDecision({ action: "reject", reason: "" }).ok).toBe(false);
  });

  it("rejects malformed runtime inputs without throwing", () => {
    expect(buildReviewDecision(null).ok).toBe(false);
    expect(buildReviewDecision({}).ok).toBe(false);
    expect(buildReviewDecision({ action: "review", reason: "x", target_table: "expenses" }).ok).toBe(false);
  });

  it("builds an EXACT hold/reject payload (only action + reason)", () => {
    const hold = buildReviewDecision({ action: "hold", reason: "غير واضح" });
    expect(hold).toEqual({ ok: true, payload: { action: "hold", reason: "غير واضح" } });
    const reject = buildReviewDecision({ action: "reject", reason: "مكرر" });
    expect(reject).toEqual({ ok: true, payload: { action: "reject", reason: "مكرر" } });
  });

  it("builds an expenses include payload with only allowed keys", () => {
    const r = buildReviewDecision({
      action: "review",
      target_table: "expenses",
      reason: "مصروف حقيقي",
      expense: {
        category: "أسمدة",
        kind: "operating",
        account_id: UUID_A,
        description: "سماد",
        payment_decision: "routed_now",
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.payload).sort()).toEqual(["action", "expense", "reason", "target_table"]);
    const expense = r.payload.expense as Record<string, unknown>;
    expect(Object.keys(expense).sort()).toEqual([
      "account_id",
      "category",
      "description",
      "kind",
      "payment_decision",
    ]);
    expect(r.payload.target_table).toBe("expenses");
  });

  it("enforces the expenses required typed fields (category/kind/account)", () => {
    const base = { action: "review", target_table: "expenses", reason: "ok" } as const;
    expect(buildReviewDecision({ ...base, expense: { kind: "operating", account_id: UUID_A } }).ok).toBe(false);
    expect(buildReviewDecision({ ...base, expense: { category: "x", account_id: UUID_A } }).ok).toBe(false);
    expect(buildReviewDecision({ ...base, expense: { category: "x", kind: "operating" } }).ok).toBe(false);
    expect(
      buildReviewDecision({ ...base, expense: { category: "x", kind: "bogus", account_id: UUID_A } }).ok,
    ).toBe(false);
    expect(
      buildReviewDecision({ ...base, expense: { category: "x", kind: "operating", account_id: "not-a-uuid" } }).ok,
    ).toBe(false);
  });

  it("accepts only the explicit historical-treasury payment decision", () => {
    const base = {
      action: "review",
      target_table: "expenses",
      reason: "مصروف تاريخي",
      expense: {
        category: "أسمدة",
        kind: "operating",
        account_id: UUID_A,
      },
    } as const;
    expect(
      buildReviewDecision(base).ok,
    ).toBe(false);
    expect(
      buildReviewDecision({
        ...base,
        expense: { ...base.expense, payment_decision: "routed_now" },
      }).ok,
    ).toBe(true);
    expect(
      buildReviewDecision({
        ...base,
        expense: { ...base.expense, payment_decision: "unrouted" },
      }).ok,
    ).toBe(false);
  });

  it("builds a sales include payload with numeric typed fields", () => {
    const r = buildReviewDecision({
      action: "review",
      target_table: "sales",
      reason: "بيع حقيقي",
      sale: { crop: "برحي", quantity: 100, unit_price: 25, recorded_total: 2500, unit: "كجم" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sale = r.payload.sale as Record<string, unknown>;
    expect(sale.quantity).toBe(100);
    expect(sale.unit_price).toBe(25);
    expect(sale.recorded_total).toBe(2500);
    expect(sale.crop).toBe("برحي");
    expect(sale.unit).toBe("كجم");
  });

  it("enforces the sales required numeric fields and rejects negatives", () => {
    const base = { action: "review", target_table: "sales", reason: "ok" } as const;
    expect(buildReviewDecision({ ...base, sale: { quantity: 1, unit_price: 1, recorded_total: 1 } }).ok).toBe(false);
    expect(buildReviewDecision({ ...base, sale: { crop: "x", unit_price: 1, recorded_total: 1 } }).ok).toBe(false);
    expect(
      buildReviewDecision({ ...base, sale: { crop: "x", quantity: -1, unit_price: 1, recorded_total: 1 } }).ok,
    ).toBe(false);
    expect(
      buildReviewDecision({ ...base, sale: { crop: "x", quantity: 1, unit_price: 1, recorded_total: null } }).ok,
    ).toBe(false);
  });

  it("requires a correction target for amount_correction_candidate and forbids it otherwise", () => {
    const correction = buildReviewDecision({
      action: "review",
      target_table: "expenses",
      reason: "تصحيح",
      classification: "amount_correction_candidate",
      expense: {
        category: "أسمدة",
        kind: "operating",
        account_id: UUID_A,
        payment_decision: "routed_now",
      },
    });
    expect(correction.ok).toBe(false); // missing corrects_expense_id

    const withTarget = buildReviewDecision({
      action: "review",
      target_table: "expenses",
      reason: "تصحيح",
      classification: "amount_correction_candidate",
      expense: {
        category: "أسمدة",
        kind: "operating",
        account_id: UUID_A,
        payment_decision: "routed_now",
      },
      corrects_expense_id: UUID_B,
    });
    expect(withTarget.ok).toBe(true);
    if (withTarget.ok) expect(withTarget.payload.corrects_expense_id).toBe(UUID_B);

    const wrongClass = buildReviewDecision({
      action: "review",
      target_table: "expenses",
      reason: "إضافة",
      classification: "source_addition_candidate",
      expense: {
        category: "أسمدة",
        kind: "operating",
        account_id: UUID_A,
        payment_decision: "routed_now",
      },
      corrects_expense_id: UUID_B,
    });
    expect(wrongClass.ok).toBe(false); // correction id not allowed here
  });

  it("rejects a malformed optional uuid and a malformed date", () => {
    const badBuyer = buildReviewDecision({
      action: "review",
      target_table: "sales",
      reason: "ok",
      sale: { crop: "x", quantity: 1, unit_price: 1, recorded_total: 1, buyer_id: "nope" },
    });
    expect(badBuyer.ok).toBe(false);
    const badDate = buildReviewDecision({
      action: "review",
      target_table: "sales",
      reason: "ok",
      sale: { crop: "x", quantity: 1, unit_price: 1, recorded_total: 1, delivery_date: "2026/01/01" },
    });
    expect(badDate.ok).toBe(false);
  });

  it("isUuid guards the shape", () => {
    expect(isUuid(UUID_A)).toBe(true);
    expect(isUuid("short")).toBe(false);
    expect(isUuid(123 as unknown)).toBe(false);
  });

  it("every enum label map is exhaustive and non-empty", () => {
    for (const map of [BATCH_STATUS_AR, REVIEW_STATE_AR]) {
      for (const v of Object.values(map)) expect(v.label.length).toBeGreaterThan(0);
    }
    for (const v of Object.values(CLASSIFICATION_AR)) expect(v.length).toBeGreaterThan(0);
  });
});

// Type-only guard: DecisionInput stays a discriminated union the builder can exhaust.
const _sample: DecisionInput = { action: "hold", reason: "x" };
void _sample;
