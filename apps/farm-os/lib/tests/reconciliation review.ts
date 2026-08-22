import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RECONCILIATION_PAGE_SIZE,
  paginate,
  parsePageParam,
  parseReconciliationQueueFilters,
  reconciliationQueueHref,
  reconciliationQueueQualityPredicates,
  reconciliationQueueStatePredicates,
  summarizeRowStates,
  QUEUE_QUALITY_AR,
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
    ).toEqual({
      classification: "source_addition_candidate",
      state: "unreviewed",
      quality: null,
    });
    expect(
      parseReconciliationQueueFilters({
        classification: ["source_addition_candidate"],
        state: "review_state.eq.executed",
      }),
    ).toEqual({ classification: null, state: null, quality: null });
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
      quality: null,
    };
    expect(reconciliationQueueHref(UUID_A, 2, filters)).toBe(
      `/finance/reconciliation/${UUID_A}?classification=amount_correction_candidate&state=held&page=2`,
    );
    expect(reconciliationQueueHref(UUID_A, 1, filters)).not.toContain("page=");
  });
});

// The acceptance report raises `تواريخ مصدر غير صالحة` and `صفوف بلا مبلغ مصدر مسجَّل` as named
// exception figures the accountant must resolve before signing, but neither is a review_state nor a
// classification — so before this filter existed the ONLY way to find those rows in a 698-row batch
// was to eyeball all 14 pages. These lock the queue route to each of them.
describe("reconciliation review — evidence-quality queue filter", () => {
  it("accepts only the two allowlisted quality values", () => {
    expect(parseReconciliationQueueFilters({ quality: "invalid_source_date" }).quality).toBe(
      "invalid_source_date",
    );
    expect(parseReconciliationQueueFilters({ quality: "missing_source_amount" }).quality).toBe(
      "missing_source_amount",
    );
  });

  it("treats an unknown, injected, or repeated quality value as «all»", () => {
    for (const raw of [
      "source_amount.is.null",
      "correction_unlinked",
      "",
      "INVALID_SOURCE_DATE",
    ] as const) {
      expect(parseReconciliationQueueFilters({ quality: raw }).quality).toBeNull();
    }
    expect(
      parseReconciliationQueueFilters({ quality: ["invalid_source_date"] }).quality,
    ).toBeNull();
    expect(parseReconciliationQueueFilters({}).quality).toBeNull();
  });

  it("maps each quality value to its exact fixed predicate, operator included", () => {
    // `is` is not interchangeable with `eq`: PostgREST cannot express "no recorded amount" as an
    // equality, and an `eq`-with-null would silently match nothing.
    expect(reconciliationQueueQualityPredicates("invalid_source_date")).toEqual([
      { column: "evidence.invalid_calendar_quality_flag", op: "eq", value: true },
    ]);
    expect(reconciliationQueueQualityPredicates("missing_source_amount")).toEqual([
      { column: "evidence.source_amount", op: "is", value: null },
    ]);
    expect(reconciliationQueueQualityPredicates(null)).toEqual([]);
  });

  it("labels exactly the allowlisted values and nothing else", () => {
    expect(Object.keys(QUEUE_QUALITY_AR).sort()).toEqual([
      "invalid_source_date",
      "missing_source_amount",
    ]);
    for (const label of Object.values(QUEUE_QUALITY_AR)) {
      expect(label.trim().length).toBeGreaterThan(0);
      // Arabic-RTL first: no Western digits and no raw column name leaking into the option.
      expect(label).not.toMatch(/[0-9]|source_|evidence\./);
    }
  });

  it("carries the quality filter across pagination alongside the other two", () => {
    const href = reconciliationQueueHref(UUID_A, 3, {
      classification: "amount_correction_candidate",
      state: "unreviewed",
      quality: "invalid_source_date",
    });
    expect(href).toBe(
      `/finance/reconciliation/${UUID_A}?classification=amount_correction_candidate` +
        `&state=unreviewed&quality=invalid_source_date&page=3`,
    );
    expect(
      reconciliationQueueHref(UUID_A, 2, {
        classification: null,
        state: null,
        quality: "missing_source_amount",
      }),
    ).toBe(`/finance/reconciliation/${UUID_A}?quality=missing_source_amount&page=2`);
    expect(
      reconciliationQueueHref(UUID_A, 2, { classification: null, state: null, quality: null }),
    ).toBe(`/finance/reconciliation/${UUID_A}?page=2`);
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

  // The count drives pagination and the row read drives the page: applying the quality predicate to
  // only one of them would page a filtered list against an unfiltered total.
  it("applies the quality predicates to BOTH filtered queries, from the shared allowlist", () => {
    expect(queueSource).toContain("reconciliationQueueQualityPredicates(filters.quality)");
    expect(queueSource.match(/for \(const predicate of qualityPredicates\)/g)).toHaveLength(2);
    // No FILTER ever names one of those columns literally — the allowlisted predicate object is the
    // only thing that reaches PostgREST. (`invalid_calendar_quality_flag` still appears in the row
    // `select()` list, which is a read of the column, not a filter on it.)
    expect(queueSource).not.toMatch(
      /\.(eq|is|neq|in|filter)\(\s*"evidence\.(invalid_calendar_quality_flag|source_amount)"/,
    );
  });

  it("honours each predicate's own operator instead of forcing equality", () => {
    const applications = queueSource.match(/predicate\.op === "is"/g);
    expect(applications).toHaveLength(2);
    expect(queueSource.match(/\.is\(predicate\.column, null\)/g)).toHaveLength(2);
    expect(queueSource.match(/\.eq\(predicate\.column, predicate\.value\)/g)).toHaveLength(4);
  });

  it("keeps the quality filter out of the whole-batch 698 KPI strip", () => {
    const loader = pageSource.slice(
      pageSource.indexOf("async function loadWholeBatchCounts"),
      pageSource.indexOf("async function loadCorrectionTargets"),
    );
    expect(loader).not.toMatch(/quality|filters/);
  });

  it("exposes the filter as an allowlisted GET control that resets to page one", () => {
    const form = pageSource.slice(
      pageSource.indexOf('<form\n        method="get"'),
      pageSource.indexOf("</form>"),
    );
    expect(form).toContain('name="quality"');
    expect(form).toContain("QUEUE_QUALITY_AR");
    // A GET form carrying no `page` input is what resets the queue to page one on every apply.
    expect(form).not.toContain('name="page"');
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

// The batch page fans its independent server reads out instead of walking them one at a time. That
// is a SOURCE-ORDER property — it cannot be observed from the rendered output — so it is pinned
// here: a future edit that re-serialises the reads (or, worse, renders before one of them settles)
// fails this suite rather than silently costing a round trip per read or shipping a partial page.
describe("reconciliation review — batch page read-concurrency contract", () => {
  const pageSource = readFileSync(
    join(process.cwd(), "app/(app)/finance/reconciliation/[batchId]/page.tsx"),
    "utf8",
  );
  const body = pageSource.slice(
    pageSource.indexOf("export default async function ReconciliationBatchPage"),
  );
  const at = (needle: string) => {
    const index = body.indexOf(needle);
    expect(index, `missing in the page body: ${needle}`).toBeGreaterThan(-1);
    return index;
  };

  const batchAwait = at("const { data: batch, error: batchError } = await sb");
  const wholeCountsStart = at("const wholeBatchCountsRead = started(loadWholeBatchCounts(");
  const filteredCountAwait = at(
    "const { count: filteredCount, error: filteredCountError } = await filteredCountQuery;",
  );
  const rowPageAwait = at("const { data: rowData, error: rowError } = await rowQuery");
  const correctionsStart = at("const correctionTargetsRead = started(loadCorrectionTargets(");
  const settleAll = at("const [counts, correctionTargets] = await Promise.all([");
  const render = at("return (");

  it("starts the whole-batch counts once the batch is known, BEFORE awaiting the filtered count", () => {
    expect(wholeCountsStart).toBeGreaterThan(batchAwait);
    expect(wholeCountsStart).toBeLessThan(filteredCountAwait);
  });

  it("blocks on nothing between starting them and awaiting the filtered count", () => {
    // Any `await` in this window would re-serialise the fan-out and reinstate the waterfall.
    expect(body.slice(wholeCountsStart, filteredCountAwait)).not.toMatch(/\bawait\b/);
  });

  it("lets them keep running across pagination, the row page, and the correction targets", () => {
    const whileInFlight = body.slice(filteredCountAwait, settleAll);
    expect(whileInFlight).not.toMatch(/\bawait\s+wholeBatchCountsRead\b/);
    expect(filteredCountAwait).toBeLessThan(rowPageAwait);
    // Correction targets need the row page, so they start after it — and still before the join.
    expect(correctionsStart).toBeGreaterThan(rowPageAwait);
    expect(correctionsStart).toBeLessThan(settleAll);
  });

  it("awaits every started read before rendering, so no partial page can ship", () => {
    expect(settleAll).toBeGreaterThan(correctionsStart);
    expect(settleAll).toBeLessThan(render);
    const joined = body.slice(settleAll, body.indexOf("]);", settleAll));
    for (const read of ["wholeBatchCountsRead", "correctionTargetsRead"]) {
      expect(joined, `${read} must be awaited before render`).toContain(read);
      // Started exactly once and awaited exactly once — never re-read, never dropped.
      expect(body.match(new RegExp(read, "g")), `${read} start/await pair`).toHaveLength(2);
    }
  });

  it("keeps the whole-batch KPI definition free of the queue filters", () => {
    const loader = pageSource.slice(
      pageSource.indexOf("async function loadWholeBatchCounts"),
      pageSource.indexOf("async function loadCorrectionTargets"),
    );
    expect(loader).not.toMatch(/\bfilters\b|statePredicates|pagination/);
    expect(loader).toContain("const [total, unreviewed");
  });

  it("keeps every extracted loader read-only — no write or RPC path", () => {
    const loaders = pageSource.slice(
      pageSource.indexOf("async function loadWholeBatchCounts"),
      pageSource.indexOf("export default async function ReconciliationBatchPage"),
    );
    expect(loaders).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });
});

describe("reconciliation review — lazy option loading contract", () => {
  const pageSource = readFileSync(
    join(process.cwd(), "app/(app)/finance/reconciliation/[batchId]/page.tsx"),
    "utf8",
  );
  const actionsSource = readFileSync(
    join(process.cwd(), "app/(app)/finance/reconciliation/actions.ts"),
    "utf8",
  );
  const controlsSource = readFileSync(
    join(process.cwd(), "app/(app)/finance/reconciliation/[batchId]/controls.tsx"),
    "utf8",
  );
  const actionStart = actionsSource.indexOf("export async function loadReviewOptions");
  const actionEnd = actionsSource.indexOf("/**\n * Stage an already-generated", actionStart);
  const actionSource = actionsSource.slice(actionStart, actionEnd);

  it("keeps all seven option reads off the initial server render", () => {
    expect(pageSource).not.toContain("loadEditableOptions");
    expect(pageSource).not.toContain("optionsRead");
    for (const table of [
      "accounts",
      "cost_centers",
      "suppliers",
      "buyers",
      "farms",
      "sectors",
      "hawshat",
    ]) {
      expect(pageSource).not.toContain(`.from("${table}")`);
    }
  });

  it("requires the finance role before creating a client and scopes every bounded option read", () => {
    expect(actionStart).toBeGreaterThan(-1);
    expect(actionSource).toContain("loadReviewOptions(batchId: string)");
    expect(actionSource).toContain("if (!isUuid(batchId))");
    expect(actionSource.indexOf('requireRole(["owner", "accountant"])')).toBeLessThan(
      actionSource.indexOf("createClient()"),
    );
    expect(actionSource).toContain('.from("reconciliation_batches")');
    expect(actionSource).toContain('.eq("id", batchId)');
    expect(actionSource).toContain('.eq("status", "staged")');
    expect(actionSource.indexOf(".maybeSingle()")).toBeLessThan(
      actionSource.indexOf("await Promise.all(["),
    );
    expect(actionSource.match(/\.eq\("org_id", m\.orgId\)/g)).toHaveLength(8);
    expect(actionSource.match(/\.limit\(OPTION_LIMIT \+ 1\)/g)).toHaveLength(7);
    expect(actionSource).toContain("leafPostingAccounts(accountRows)");
    expect(actionSource).toContain('.eq("active", true)');
    expect(actionSource).toContain('.eq("archived", false)');
    expect(actionSource).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });

  it("loads once on first open, reuses the client cache, and fails without opening the form", () => {
    expect(controlsSource).toContain("const optionsRef = useRef<OptionList | null>(null)");
    expect(controlsSource).toContain(
      "const pendingOptionsRef = useRef<Promise<ReviewOptionsResult> | null>(null)",
    );
    expect(controlsSource).toContain("if (optionsRef.current) return optionsRef.current");
    expect(controlsSource).toContain("if (!request)");
    expect(controlsSource).toContain("request = loadReviewOptions(batchId)");
    expect(controlsSource).toContain("const loaded = await ensureOptions();");
    expect(controlsSource).toContain("setOpen(true);");
    expect(controlsSource).toContain("open && options && editable");
    expect(controlsSource).toContain("invalidateOptions()");
    expect(controlsSource).toContain("optionsRef.current = null");
    expect(controlsSource).toContain('role="alert" aria-live="assertive"');
    expect(pageSource).toContain('key={`${batchId}:${batch.status}:${m.role}`}');
    const saveSuccess = controlsSource.slice(
      controlsSource.indexOf("if (r.ok) {"),
      controlsSource.indexOf("} else {", controlsSource.indexOf("if (r.ok) {")),
    );
    expect(saveSuccess.indexOf("invalidateOptions()")).toBeLessThan(
      saveSuccess.indexOf("router.refresh()"),
    );
  });
});

// The review card is keyed by row id and never unmounts while the batch page is open, so its form
// state is NOT re-created by `router.refresh()`. Whether the form re-seeds itself from the row is a
// SOURCE property — there is no jsdom in this suite (adding @testing-library/react is a dependency
// hard-stop), so it is pinned here exactly as the read-concurrency and lazy-option contracts above
// are. A regression that drops the re-seed lets an abandoned edit reappear as the stored decision and
// be written back on the next save, which on a money batch silently flips a reviewed row.
describe("reconciliation review — review form discard contract", () => {
  const controlsSource = readFileSync(
    join(process.cwd(), "app/(app)/finance/reconciliation/[batchId]/controls.tsx"),
    "utf8",
  );
  const card = controlsSource.slice(
    controlsSource.indexOf("function RowCard({"),
    controlsSource.indexOf("export type MoneyAction"),
  );
  const resetBody = card.slice(card.indexOf("function resetForm() {"), card.indexOf("/** Close the form"));

  it("seeds the initial mount through the same helpers the re-seed uses", () => {
    expect(controlsSource).toContain("function initialActionOf(row: RowVM)");
    expect(controlsSource).toContain("function saleFormOf(sale: RowSalePrefill)");
    expect(card).toContain("useState<\"review\" | \"hold\" | \"reject\">(() => initialActionOf(row))");
    expect(card).toContain("useState(() => saleFormOf(row.sale))");
  });

  it("re-seeds EVERY editable field, and the last message, from the current row", () => {
    expect(resetBody).not.toBe("");
    for (const seed of [
      "setAction(initialActionOf(row));",
      'setTarget((row.targetTable as "expenses" | "sales" | null) ?? "expenses");',
      'setReason(row.reviewReason ?? "");',
      "setExp(row.expense);",
      "setSale(saleFormOf(row.sale));",
      "setCorrectsExpenseId(row.correctsExpenseId);",
      "setCorrectsSaleId(row.correctsSaleId);",
      "setMsg(null);",
    ]) {
      expect(resetBody, `resetForm must re-seed: ${seed}`).toContain(seed);
    }
    // The picker owns its own query/results/chosen label, so it must remount rather than be re-seeded.
    expect(resetBody).toContain("setFormNonce((nonce) => nonce + 1);");
    expect(card).toContain("key={`exp-corr-${formNonce}`}");
    expect(card).toContain("key={`sl-corr-${formNonce}`}");
  });

  it("discards on «إلغاء» and on closing the card, and re-seeds before every open", () => {
    expect(card).toContain("function discard() {\n    resetForm();\n    setOpen(false);\n  }");
    // Both close paths go through discard; neither may collapse the form on its own.
    expect(card).toContain("onClick={discard}");
    expect(card).toContain("if (open) {\n                discard();\n                return;\n              }");
    const openPath = card.slice(card.indexOf("const loaded = await ensureOptions();"));
    expect(openPath.indexOf("resetForm();")).toBeLessThan(openPath.indexOf("setOpen(true);"));
  });

  it("keeps the save path unchanged — a successful save is not a discard", () => {
    const saveSuccess = card.slice(card.indexOf("if (r.ok) {"), card.indexOf("} else {", card.indexOf("if (r.ok) {")));
    expect(saveSuccess).toContain("setOpen(false);");
    expect(saveSuccess).not.toContain("discard()");
    expect(saveSuccess).not.toContain("resetForm()");
  });

  // resetForm() seeds from the `row` PROP. router.refresh() returns void and commits the refreshed RSC
  // payload LATER, so between a successful save and that commit the prop is still the PRE-save row.
  // Unless opening is blocked for exactly that window, a fast reopen re-seeds the form from the old
  // stored decision and writes it back on the next save. The window is closed by running the refresh in
  // a transition and gating the open path on that transition's pending flag — so the two must be the
  // SAME flag. The identifier is read out of the useTransition destructuring below rather than
  // hardcoded, so an unrelated `pending`/`optionsPending` in the gate cannot satisfy this suite.
  describe("post-save refresh window", () => {
    const transition = card.match(/const \[(\w+), (\w+)\] = useTransition\(\);/);
    const [, pendingFlag, startTransition] = transition ?? [];
    const saveSuccess = card.slice(card.indexOf("if (r.ok) {"), card.indexOf("} else {", card.indexOf("if (r.ok) {")));
    const openButton = card.slice(card.indexOf("{editable && !row.frozen && ("), card.indexOf("{open && options && editable"));
    // Comments in this card discuss router.refresh() by name, so the "only through the transition"
    // assertion below counts CODE occurrences, not prose.
    const cardCode = card.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    it("drives the post-save refresh through a transition, and only through it", () => {
      expect(transition, "RowCard must own a useTransition for the post-save refresh").not.toBeNull();
      expect(controlsSource).toContain('import { useRef, useState, useTransition } from "react";');
      // The refresh is started inside the transition callback...
      expect(saveSuccess).toContain(`${startTransition}(() => {`);
      expect(saveSuccess).toContain("router.refresh();");
      expect(saveSuccess.indexOf(`${startTransition}(() => {`)).toBeLessThan(
        saveSuccess.indexOf("router.refresh();"),
      );
      // ...and nowhere else in this card, so no path can reopen against a stale row.
      expect(cardCode.match(/router\.refresh\(\)/g)).toHaveLength(1);
      expect(cardCode).toMatch(
        new RegExp(`${startTransition}\\(\\(\\) => \\{\\s*router\\.refresh\\(\\);\\s*\\}\\);`),
      );
      // The existing ordering contract still holds: the option cache is dropped before the refresh.
      expect(saveSuccess.indexOf("invalidateOptions()")).toBeLessThan(
        saveSuccess.indexOf("router.refresh();"),
      );
    });

    it("gates opening on THAT transition's pending flag, not on any other pending variable", () => {
      expect(pendingFlag).toBeTruthy();
      // The flag must be the transition's own, and it must reach both the visible state and the guard.
      expect(openButton).toContain(`loading={!open && (optionsPending || ${pendingFlag})}`);
      expect(openButton).toContain(`disabled={!open && (optionsPending || ${pendingFlag})}`);
      expect(openButton).toContain(`if (${pendingFlag}) return;`);
      // The guard must precede the seed-and-open, or it gates nothing.
      expect(openButton.indexOf(`if (${pendingFlag}) return;`)).toBeLessThan(
        openButton.indexOf("resetForm();"),
      );
      // Closing/discarding stays available while the refresh is in flight.
      expect(openButton.indexOf("discard();")).toBeLessThan(
        openButton.indexOf(`if (${pendingFlag}) return;`),
      );
    });
  });
});

// Type-only guard: DecisionInput stays a discriminated union the builder can exhaust.
const _sample: DecisionInput = { action: "hold", reason: "x" };
void _sample;
