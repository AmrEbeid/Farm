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
  nextVisibleUnreviewedRowId,
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
      })
    ).toBe(`السجل المُصحَّح: مصروف · مرجع ${UUID_A} · ١٥ يناير ٢٠٢٦ · تسميد · دفعة سماد · ٥٠٠ ج.م`);
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
      })
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
      correctionTargetLabel({ ...common, referenceLabel: `مرجع ${UUID_B}` })
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
    expect(parsePageParam("2147483648")).toBe(2_147_483_647);
    expect(parsePageParam(String(Number.MAX_SAFE_INTEGER))).toBe(2_147_483_647);
  });
});

describe("reconciliation review — next visible undecided row", () => {
  const rows = [
    { id: "a", reviewState: "unreviewed" },
    { id: "b", reviewState: "reviewed" },
    { id: "c", reviewState: "unreviewed" },
    { id: "d", reviewState: "rejected" },
  ];

  it("advances only forward to the next visible unreviewed row", () => {
    expect(nextVisibleUnreviewedRowId(rows, "a")).toBe("c");
  });

  it("does not wrap, cross a page, or revisit an earlier decision", () => {
    expect(nextVisibleUnreviewedRowId(rows, "c")).toBeNull();
  });

  it("fails closed when the saved row is absent", () => {
    expect(nextVisibleUnreviewedRowId(rows, "missing")).toBeNull();
  });
});

describe("reconciliation review — read-only queue filters", () => {
  it("accepts only single allowlisted values", () => {
    expect(
      parseReconciliationQueueFilters({
        classification: "source_addition_candidate",
        state: "unreviewed",
      })
    ).toEqual({
      classification: "source_addition_candidate",
      state: "unreviewed",
      quality: null,
    });
    expect(
      parseReconciliationQueueFilters({
        classification: ["source_addition_candidate"],
        state: "review_state.eq.executed",
      })
    ).toEqual({ classification: null, state: null, quality: null });
  });

  it("maps each state to its exact fixed predicates", () => {
    expect(reconciliationQueueStatePredicates("unreviewed")).toEqual([{ column: "review_state", value: "unreviewed" }]);
    expect(reconciliationQueueStatePredicates("included")).toEqual([{ column: "disposition", value: "include" }]);
    expect(reconciliationQueueStatePredicates("held")).toEqual([
      { column: "review_state", value: "reviewed" },
      { column: "disposition", value: "hold" },
    ]);
    expect(reconciliationQueueStatePredicates("rejected")).toEqual([{ column: "review_state", value: "rejected" }]);
    expect(reconciliationQueueStatePredicates("frozen")).toEqual([{ column: "frozen", value: true }]);
    expect(reconciliationQueueStatePredicates(null)).toEqual([]);
  });

  it("preserves active filters in pagination and omits page one", () => {
    const filters = {
      classification: "amount_correction_candidate" as const,
      state: "held" as const,
      quality: null,
    };
    expect(reconciliationQueueHref(UUID_A, 2, filters)).toBe(
      `/finance/reconciliation/${UUID_A}?classification=amount_correction_candidate&state=held&page=2`
    );
    expect(reconciliationQueueHref(UUID_A, 1, filters)).not.toContain("page=");
  });
});

// These lock the queue route to every named row-quality exception in the acceptance report.
describe("reconciliation review — evidence-quality queue filter", () => {
  it("accepts only the three allowlisted quality values", () => {
    expect(parseReconciliationQueueFilters({ quality: "invalid_source_date" }).quality).toBe("invalid_source_date");
    expect(parseReconciliationQueueFilters({ quality: "missing_source_amount" }).quality).toBe("missing_source_amount");
    expect(parseReconciliationQueueFilters({ quality: "unlinked_correction" }).quality).toBe("unlinked_correction");
  });

  it("treats an unknown, injected, or repeated quality value as «all»", () => {
    for (const raw of ["source_amount.is.null", "correction_unlinked", "", "INVALID_SOURCE_DATE"] as const) {
      expect(parseReconciliationQueueFilters({ quality: raw }).quality).toBeNull();
    }
    expect(parseReconciliationQueueFilters({ quality: ["invalid_source_date"] }).quality).toBeNull();
    expect(parseReconciliationQueueFilters({}).quality).toBeNull();
  });

  it("maps each quality value to its exact fixed predicate, operator included", () => {
    // `is` is not interchangeable with `eq`: PostgREST cannot express "no recorded amount" as an
    // equality, and an `eq`-with-null would silently match nothing.
    expect(reconciliationQueueQualityPredicates("invalid_source_date")).toEqual([
      {
        column: "evidence.invalid_calendar_quality_flag",
        op: "eq",
        value: true,
      },
    ]);
    expect(reconciliationQueueQualityPredicates("missing_source_amount")).toEqual([
      { column: "evidence.source_amount", op: "is", value: null },
    ]);
    expect(reconciliationQueueQualityPredicates("unlinked_correction")).toEqual([
      { column: "evidence.classification", op: "eq", value: "amount_correction_candidate" },
      { column: "corrects_expense_id", op: "is", value: null },
      { column: "corrects_sale_id", op: "is", value: null },
    ]);
    expect(reconciliationQueueQualityPredicates(null)).toEqual([]);
  });

  it("labels exactly the allowlisted values and nothing else", () => {
    expect(Object.keys(QUEUE_QUALITY_AR).sort()).toEqual([
      "invalid_source_date",
      "missing_source_amount",
      "unlinked_correction",
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
        `&state=unreviewed&quality=invalid_source_date&page=3`
    );
    expect(
      reconciliationQueueHref(UUID_A, 2, {
        classification: null,
        state: null,
        quality: "missing_source_amount",
      })
    ).toBe(`/finance/reconciliation/${UUID_A}?quality=missing_source_amount&page=2`);
    expect(
      reconciliationQueueHref(UUID_A, 1, {
        classification: null,
        state: "held",
        quality: "unlinked_correction",
      })
    ).toBe(`/finance/reconciliation/${UUID_A}?state=held&quality=unlinked_correction`);
    expect(
      reconciliationQueueHref(UUID_A, 2, {
        classification: null,
        state: null,
        quality: null,
      })
    ).toBe(`/finance/reconciliation/${UUID_A}?page=2`);
  });
});

describe("reconciliation review — queue source contract", () => {
  const pageSource = readFileSync(join(process.cwd(), "app/(app)/finance/reconciliation/[batchId]/page.tsx"), "utf8");
  const queueMigration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260808060000_accounting_reconciliation_ordered_queue.sql"),
    "utf8",
  );
  const queueStart = pageSource.indexOf("const { data: queuePageData");
  const queueEnd = pageSource.indexOf("const rowVms:");
  const queueSource = pageSource.slice(queueStart, queueEnd);

  it("returns whole-batch counts beside the canonical filtered page in one RPC snapshot", () => {
    expect(queueSource).toContain('"fn_reconciliation_queue_page"');
    expect(queueSource).toContain("const counts = queuePage.counts");
    expect(queueSource).toContain("paginate(queuePage.total, queuePage.page, queuePage.pageSize)");
    expect(pageSource).not.toContain("loadWholeBatchCounts");
    expect(pageSource).not.toContain("headCount");
  });

  it("uses the bounded row payload from the same RPC snapshot as filters, order, and total", () => {
    expect(queueSource).toContain("const orderedBatchRows = queuePage.rows");
    expect(queueSource).not.toContain('.from("reconciliation_batch_rows")');
    expect(queueSource).not.toContain("queuePage.rowIds");
  });

  it("uses one named read RPC and adds no write path", () => {
    expect(queueSource.match(/\.rpc\(/g)).toHaveLength(1);
    expect(queueSource).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(queueSource).not.toContain('.order("evidence_item_id"');
    expect(queueSource).not.toContain(".range(");
  });

  it("passes only the parsed allowlisted filters and the fixed 50-row bound to the RPC", () => {
    expect(queueSource).toContain("p_classification: filters.classification");
    expect(queueSource).toContain("p_state: filters.state");
    expect(queueSource).toContain("p_quality: filters.quality");
    expect(queueSource).toContain("p_limit: RECONCILIATION_PAGE_SIZE");
    expect(queueSource).toContain("parseReconciliationQueuePage(");
  });

  it("limits the lightweight locator set before building detailed row JSON and dimension joins", () => {
    const paged = queueMigration.indexOf("paged as materialized");
    const limit = queueMigration.indexOf("limit p_limit", paged);
    const payload = queueMigration.indexOf("pg_catalog.to_jsonb(r)", limit);
    const dimensionJoin = queueMigration.indexOf("left join public.accounts expense_account", payload);
    expect(paged).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(paged);
    expect(payload).toBeGreaterThan(limit);
    expect(dimensionJoin).toBeGreaterThan(payload);
    expect(queueMigration.slice(paged, limit)).not.toContain("pg_catalog.to_jsonb(r)");
  });

  it("keeps queue filters out of the whole-batch KPI aggregate", () => {
    const aggregate = queueMigration.slice(
      queueMigration.indexOf("select\n    pg_catalog.count(*)::integer"),
      queueMigration.indexOf("if v_batch_rows <> v_evidence_rows"),
    );
    expect(aggregate).toContain("v_unreviewed, v_included");
    expect(aggregate).not.toMatch(/p_classification|p_state|p_quality/);
  });

  it("routes every whole-batch KPI to its exact queue population", () => {
    const helper = pageSource.slice(pageSource.indexOf("function QueueKpiLink"), pageSource.indexOf("export default"));
    expect(helper).toContain("reconciliationQueueHref(batchId, 1");
    expect(helper).toContain("classification: null");
    expect(helper).toContain("state,");
    expect(helper).toContain("quality: null");
    expect(helper).toContain("aria-label={`عرض ${label}: ${value}`}");

    const kpis = pageSource.slice(
      pageSource.indexOf('<section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">'),
      pageSource.indexOf("</section>", pageSource.indexOf('<section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">')),
    );
    const routes = [
      ["الصفوف", "counts.total", "state={null}"],
      ["بدون قرار", "counts.unreviewed", 'state="unreviewed"'],
      ["تُضمَّن", "counts.included", 'state="included"'],
      ["مُعلَّقة", "counts.held", 'state="held"'],
      ["مرفوضة", "counts.rejected", 'state="rejected"'],
      ["مُجمَّدة", "counts.frozen", 'state="frozen"'],
    ] as const;
    for (const [label, count, state] of routes) {
      const start = kpis.indexOf(`label="${label}"`);
      const end = kpis.indexOf("/>", start);
      expect(start).toBeGreaterThan(-1);
      const kpi = kpis.slice(start, end);
      expect(kpi).toContain(`value={num(${count})}`);
      expect(kpi).toContain(state);
    }
    expect(kpis.match(/<QueueKpiLink /g)).toHaveLength(6);
    expect(kpis).not.toContain("<KpiCard ");
  });

  it("exposes the filter as an allowlisted GET control that resets to page one", () => {
    const form = pageSource.slice(pageSource.indexOf('<form\n        method="get"'), pageSource.indexOf("</form>"));
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
    expect(summarizeRowStates([{ review_state: "reviewed", disposition: "include" }]).allDecided).toBe(true);
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
    const eligible = { isBatchCreator: false, hasReviewedRow: false };
    expect(approveGate("staged", "owner", eligible).canApprove).toBe(false);
    expect(approveGate("reviewed", "accountant", eligible).canApprove).toBe(false);
    expect(approveGate("reviewed", "owner", eligible).canApprove).toBe(true);
  });

  it("blocks an owner who created the batch or reviewed any row", () => {
    expect(
      approveGate("reviewed", "owner", { isBatchCreator: true, hasReviewedRow: false }),
    ).toEqual({
      canApprove: false,
      reason: "لا يجوز لمن أنشأ الدفعة اعتمادها (فصل المهام).",
    });
    expect(
      approveGate("reviewed", "owner", { isBatchCreator: false, hasReviewedRow: true }),
    ).toEqual({
      canApprove: false,
      reason: "لا يجوز لمن راجع أي صف في الدفعة اعتمادها (فصل المهام).",
    });
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
      })
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
    expect(
      buildReviewDecision({
        action: "review",
        reason: "x",
        target_table: "expenses",
      }).ok
    ).toBe(false);
  });

  it("builds an EXACT hold/reject payload (only action + reason)", () => {
    const hold = buildReviewDecision({ action: "hold", reason: "غير واضح" });
    expect(hold).toEqual({
      ok: true,
      payload: { action: "hold", reason: "غير واضح" },
    });
    const reject = buildReviewDecision({ action: "reject", reason: "مكرر" });
    expect(reject).toEqual({
      ok: true,
      payload: { action: "reject", reason: "مكرر" },
    });
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
    expect(Object.keys(expense).sort()).toEqual(["account_id", "category", "description", "kind", "payment_decision"]);
    expect(r.payload.target_table).toBe("expenses");
  });

  it("enforces the expenses required typed fields (category/kind/account)", () => {
    const base = {
      action: "review",
      target_table: "expenses",
      reason: "ok",
    } as const;
    expect(
      buildReviewDecision({
        ...base,
        expense: { kind: "operating", account_id: UUID_A },
      }).ok
    ).toBe(false);
    expect(
      buildReviewDecision({
        ...base,
        expense: { category: "x", account_id: UUID_A },
      }).ok
    ).toBe(false);
    expect(
      buildReviewDecision({
        ...base,
        expense: { category: "x", kind: "operating" },
      }).ok
    ).toBe(false);
    expect(
      buildReviewDecision({
        ...base,
        expense: { category: "x", kind: "bogus", account_id: UUID_A },
      }).ok
    ).toBe(false);
    expect(
      buildReviewDecision({
        ...base,
        expense: { category: "x", kind: "operating", account_id: "not-a-uuid" },
      }).ok
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
    expect(buildReviewDecision(base).ok).toBe(false);
    expect(
      buildReviewDecision({
        ...base,
        expense: { ...base.expense, payment_decision: "routed_now" },
      }).ok
    ).toBe(true);
    expect(
      buildReviewDecision({
        ...base,
        expense: { ...base.expense, payment_decision: "unrouted" },
      }).ok
    ).toBe(false);
  });

  it("builds a sales include payload with numeric typed fields", () => {
    const r = buildReviewDecision({
      action: "review",
      target_table: "sales",
      reason: "بيع حقيقي",
      sale: {
        crop: "برحي",
        quantity: 100,
        unit_price: 25,
        recorded_total: 2500,
        unit: "كجم",
      },
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
    const base = {
      action: "review",
      target_table: "sales",
      reason: "ok",
    } as const;
    expect(
      buildReviewDecision({
        ...base,
        sale: { quantity: 1, unit_price: 1, recorded_total: 1 },
      }).ok
    ).toBe(false);
    expect(
      buildReviewDecision({
        ...base,
        sale: { crop: "x", unit_price: 1, recorded_total: 1 },
      }).ok
    ).toBe(false);
    expect(
      buildReviewDecision({
        ...base,
        sale: { crop: "x", quantity: -1, unit_price: 1, recorded_total: 1 },
      }).ok
    ).toBe(false);
    expect(
      buildReviewDecision({
        ...base,
        sale: { crop: "x", quantity: 1, unit_price: 1, recorded_total: null },
      }).ok
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
      sale: {
        crop: "x",
        quantity: 1,
        unit_price: 1,
        recorded_total: 1,
        buyer_id: "nope",
      },
    });
    expect(badBuyer.ok).toBe(false);
    const badDate = buildReviewDecision({
      action: "review",
      target_table: "sales",
      reason: "ok",
      sale: {
        crop: "x",
        quantity: 1,
        unit_price: 1,
        recorded_total: 1,
        delivery_date: "2026/01/01",
      },
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

// The batch page delegates its filtered total, bounded rows, correction summaries, and whole-batch
// KPIs to one read RPC. This request-consolidation property cannot be observed from rendered output,
// so source tests prevent the seven independent KPI requests from returning unnoticed.
describe("reconciliation review — batch page read-consolidation contract", () => {
  const pageSource = readFileSync(join(process.cwd(), "app/(app)/finance/reconciliation/[batchId]/page.tsx"), "utf8");
  const body = pageSource.slice(pageSource.indexOf("export default async function ReconciliationBatchPage"));
  const at = (needle: string) => {
    const index = body.indexOf(needle);
    expect(index, `missing in the page body: ${needle}`).toBeGreaterThan(-1);
    return index;
  };

  const batchAwait = at("const { data: batch, error: batchError } = await sb");
  const queuePageAwait = at("const { data: queuePageData, error: queuePageError } = await sb.rpc(");
  const parsedPage = at("const queuePage = parseReconciliationQueuePage(");
  const countsReady = at("const counts = queuePage.counts");
  const rowPayloadReady = at("const orderedBatchRows = queuePage.rows");
  const render = at("return (");

  it("loads the batch before the single canonical queue snapshot", () => {
    expect(queuePageAwait).toBeGreaterThan(batchAwait);
  });

  it("validates the queue payload before exposing either counts or rows", () => {
    expect(queuePageAwait).toBeLessThan(parsedPage);
    expect(parsedPage).toBeLessThan(countsReady);
    expect(parsedPage).toBeLessThan(rowPayloadReady);
    expect(countsReady).toBeLessThan(render);
    expect(rowPayloadReady).toBeLessThan(render);
  });

  it("uses one read RPC after the batch lookup and no independent KPI requests", () => {
    expect(body.match(/\.rpc\(/g)).toHaveLength(1);
    expect(body).not.toContain('.select("id", { count: "exact", head: true })');
    expect(body).not.toMatch(/loadWholeBatchCounts|wholeBatchCountsRead|executedRowCount|headCount|started\(/);
    expect(body).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("checks Owner approval separation before enabling the control", () => {
    expect(body).toContain("created_at, created_by, result_summary");
    expect(body).toContain('if (m.role === "owner" && batch.status === "reviewed")');
    expect(body).toContain('.from("reconciliation_batch_rows")');
    expect(body).toContain('.eq("org_id", m.orgId)');
    expect(body).toContain('.eq("batch_id", batchId)');
    expect(body).toContain('.eq("reviewer_id", m.userId)');
    expect(body).toContain("if (reviewedRowsError) throw reviewedRowsError");
    expect(body).toContain("isBatchCreator: batch.created_by === m.userId");
    expect(body).toContain("hasReviewedRow,");
  });
});

describe("reconciliation review — lazy option loading contract", () => {
  const pageSource = readFileSync(join(process.cwd(), "app/(app)/finance/reconciliation/[batchId]/page.tsx"), "utf8");
  const actionsSource = readFileSync(join(process.cwd(), "app/(app)/finance/reconciliation/actions.ts"), "utf8");
  const controlsSource = readFileSync(
    join(process.cwd(), "app/(app)/finance/reconciliation/[batchId]/controls.tsx"),
    "utf8"
  );
  const actionStart = actionsSource.indexOf("export async function loadReviewOptions");
  const actionEnd = actionsSource.indexOf("/**\n * Stage an already-generated", actionStart);
  const actionSource = actionsSource.slice(actionStart, actionEnd);

  it("keeps all seven option reads off the initial server render", () => {
    expect(pageSource).not.toContain("loadEditableOptions");
    expect(pageSource).not.toContain("optionsRead");
    for (const table of ["accounts", "cost_centers", "suppliers", "buyers", "farms", "sectors", "hawshat"]) {
      expect(pageSource).not.toContain(`.from("${table}")`);
    }
  });

  it("requires the finance role before creating a client and scopes every bounded option read", () => {
    expect(actionStart).toBeGreaterThan(-1);
    expect(actionSource).toContain("loadReviewOptions(batchId: string)");
    expect(actionSource).toContain("if (!isUuid(batchId))");
    expect(actionSource.indexOf('requireRole(["owner", "accountant"])')).toBeLessThan(
      actionSource.indexOf("createClient()")
    );
    expect(actionSource).toContain('.from("reconciliation_batches")');
    expect(actionSource).toContain('.eq("id", batchId)');
    expect(actionSource).toContain('.eq("status", "staged")');
    expect(actionSource.indexOf(".maybeSingle()")).toBeLessThan(actionSource.indexOf("await Promise.all(["));
    expect(actionSource.match(/\.eq\("org_id", m\.orgId\)/g)).toHaveLength(8);
    expect(actionSource.match(/\.limit\(OPTION_LIMIT \+ 1\)/g)).toHaveLength(7);
    expect(actionSource).toContain("leafPostingAccounts(accountRows)");
    expect(actionSource).toContain('.eq("active", true)');
    expect(actionSource).toContain('.eq("archived", false)');
    expect(actionSource).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });

  it("loads once on first open, reuses the client cache, and fails without opening the form", () => {
    expect(controlsSource).toContain("const optionsRef = useRef<OptionList | null>(null)");
    expect(controlsSource).toContain("const pendingOptionsRef = useRef<Promise<ReviewOptionsResult> | null>(null)");
    expect(controlsSource).toContain("if (optionsRef.current) return optionsRef.current");
    expect(controlsSource).toContain("if (!request)");
    expect(controlsSource).toContain("request = loadReviewOptions(batchId)");
    expect(controlsSource).toContain("const loaded = await ensureOptions();");
    expect(controlsSource).toContain("setOpenRow(row.id);");
    expect(controlsSource).toContain("open && options && editable");
    expect(controlsSource).toContain("invalidateOptions()");
    expect(controlsSource).toContain("optionsRef.current = null");
    expect(controlsSource).toContain('role="alert" aria-live="assertive"');
    expect(pageSource).toContain("key={`${batchId}:${batch.status}:${m.role}`}");
    expect(controlsSource).toContain("const ensureOptions = useCallback(async ()");
    const saveHandler = controlsSource.slice(
      controlsSource.indexOf("function handleRowSaved(nextRowId: string | null)"),
      controlsSource.indexOf("return (", controlsSource.indexOf("function handleRowSaved"))
    );
    expect(saveHandler).toContain("invalidateOptions();");
    expect(saveHandler.indexOf("invalidateOptions();")).toBeLessThan(saveHandler.indexOf("router.refresh();"));
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
    "utf8"
  );
  const card = controlsSource.slice(
    controlsSource.indexOf("function RowCard({"),
    controlsSource.indexOf("export type MoneyAction")
  );
  const compactCard = card.replace(/\s+/g, " ");
  const resetBody = card.slice(card.indexOf("function resetForm() {"), card.indexOf("/** Close the form"));

  it("seeds the initial mount through the same helpers the re-seed uses", () => {
    expect(controlsSource).toContain("function initialActionOf(row: RowVM)");
    expect(controlsSource).toContain("function saleFormOf(sale: RowSalePrefill)");
    expect(compactCard).toMatch(/useState<"review" \| "hold" \| "reject">\(\(\) =>\s*initialActionOf\(row\)\s*\)/);
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
    expect(card).toContain("function discard() {\n    resetForm();\n    setOpenRow(null);\n  }");
    // Both close paths go through discard; neither may collapse the form on its own.
    expect(card).toContain("onClick={discard}");
    expect(card).toContain("if (open) {\n                discard();\n                return;\n              }");
    const openPath = card.slice(card.indexOf("const loaded = await ensureOptions();"));
    expect(openPath.indexOf("resetForm();")).toBeLessThan(openPath.indexOf("setOpenRow(row.id);"));
  });

  it("keeps successful saves explicit and never turns advance into a discard", () => {
    const saveSuccess = card.slice(card.indexOf("if (r.ok) {"), card.indexOf("} else {", card.indexOf("if (r.ok) {")));
    expect(saveSuccess).toContain("const advanceTo = advance ? nextUnreviewedRowId : null;");
    expect(saveSuccess).toContain("onSaved(advanceTo);");
    expect(saveSuccess).not.toContain("discard()");
    expect(saveSuccess).not.toContain("resetForm()");
  });

  // resetForm() seeds from the `row` PROP. The parent therefore owns one shared refresh transition:
  // every card closes before refresh, all open buttons are gated while it is pending, and an advance
  // candidate opens only after the refreshed RSC rows commit and still report it as unreviewed.
  describe("post-save refresh window", () => {
    const controls = controlsSource.slice(
      controlsSource.indexOf("export function ReconciliationControls({"),
      controlsSource.indexOf("function PageLink({")
    );
    const compactControls = controls.replace(/\s+/g, " ");
    const cardCode = card.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const openButton = card.slice(
      card.indexOf("{editable && !row.frozen && ("),
      card.indexOf("{open && options && editable")
    );

    it("closes all cards and refreshes through the parent's shared transition", () => {
      expect(controlsSource).toContain(
        'import { useCallback, useEffect, useRef, useState, useTransition } from "react";'
      );
      expect(controls).toContain("function handleRowSaved(nextRowId: string | null)");
      expect(controls).toContain("queuedOpenRowRef.current = nextRowId;");
      expect(controls).toContain("setOpenRow(null);");
      expect(controls).toContain("invalidateOptions();");
      expect(controls).toContain("startRefreshTransition(() => {\n      router.refresh();\n    });");
      expect(cardCode).not.toContain("router.refresh()");
    });

    it("opens the candidate only after commit and only if it remains visibly unreviewed", () => {
      expect(compactControls).toContain(
        "const refreshJustCommitted = wasRefreshPendingRef.current && !refreshPending;"
      );
      expect(controls).toContain("if (!refreshJustCommitted) return;");
      expect(compactControls).toMatch(
        /rows\.some\(\s*\(row\) => row\.id === candidate && row\.reviewState === "unreviewed"\s*\)/
      );
      expect(controls).toContain("void ensureOptions().then((loaded) => {");
      expect(controls).toContain("if (!cancelled && loaded) setOpenRow(candidate);");
      expect(controls.indexOf("if (!refreshJustCommitted) return;")).toBeLessThan(
        controls.indexOf("ensureOptions().then")
      );
    });

    it("gates every other card during refresh or while one form is open", () => {
      expect(openButton).toContain("loading={!open && opening}");
      expect(openButton).toContain("!reviewSupported ||");
      expect(openButton).toContain("if (!reviewSupported || refreshPending || anotherRowOpen) return;");
      expect(openButton.indexOf("if (!reviewSupported || refreshPending || anotherRowOpen) return;")).toBeLessThan(
        openButton.indexOf("resetForm();")
      );
      expect(openButton.indexOf("discard();")).toBeLessThan(
        openButton.indexOf("if (!reviewSupported || refreshPending || anotherRowOpen) return;")
      );
      expect(controls).toContain("(refreshPending || (openRowId === null && optionsPending))");
      expect(controls).toContain('<div role="status" aria-live="polite">');
    });

    it("shows loading on exactly the save command that was chosen", () => {
      expect(compactCard).toMatch(
        /const \[pendingAction, setPendingAction\] = useState<\s*"save" \| "save-next" \| null\s*>\(null\)/
      );
      expect(card).toContain('const command = advance ? "save-next" : "save";');
      expect(card).toContain('loading={pendingAction === "save"}');
      expect(card).toContain('loading={pendingAction === "save-next"}');
      expect(card).toContain("disabled={pendingAction !== null}");
    });

    it("renders the explicit advance command only when a later visible row is undecided", () => {
      expect(card).toContain("{nextUnreviewedRowId && (");
      expect(card).toContain("onClick={() => submit(true)}");
      expect(card).toContain("حفظ ومراجعة التالي");
      expect(controls).toContain("nextVisibleUnreviewedRowId(rows, row.id)");
      expect(controls).toContain('key={`${row.id}:${openRowId === row.id ? "open" : "closed"}`}');
    });

    it("blocks batch actions and pagination while a review form is open", () => {
      expect(compactControls).toContain(
        "const { reviewOpen, historyGuardStatus, setReviewOpen } = useReviewWorkspaceGuard();"
      );
      expect(controls).toContain("setReviewOpen(rowId !== null);");
      expect(controlsSource).toContain("if (reviewOpen) return;");
      expect(controlsSource).toContain("disabled={!canFreeze || pending !== null || reviewOpen}");
      expect(compactControls).toContain('disabled={page <= 1 || reviewOpen} label="السابق"');
      expect(compactControls).toContain('disabled={page >= pageCount || reviewOpen} label="التالي"');
    });

    it("keeps review editing fail-closed when exact history restoration is unavailable", () => {
      expect(controls).toContain('historyGuardStatus === "unsupported"');
      expect(controls).toContain("المراجعة غير متاحة بأمان في هذا المتصفح");
      expect(controls).toContain('reviewSupported={historyGuardStatus === "supported"}');
      expect(openButton).toContain("!reviewSupported ||");
      expect(openButton).toContain("if (!reviewSupported || refreshPending || anotherRowOpen) return;");
    });
  });
});

describe("reconciliation review — optimistic concurrency contract", () => {
  const page = readFileSync(join(process.cwd(), "app/(app)/finance/reconciliation/[batchId]/page.tsx"), "utf8");
  const controls = readFileSync(join(process.cwd(), "app/(app)/finance/reconciliation/[batchId]/controls.tsx"), "utf8");
  const actions = readFileSync(join(process.cwd(), "app/(app)/finance/reconciliation/actions.ts"), "utf8");
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260808050000_accounting_reconciliation_review_concurrency.sql"),
    "utf8"
  );
  const queueData = readFileSync(
    join(process.cwd(), "lib/reconciliation queue data.ts"),
    "utf8"
  );
  const queueMigration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260808060000_accounting_reconciliation_ordered_queue.sql"),
    "utf8"
  );
  const dbTest = readFileSync(
    join(process.cwd(), "supabase/tests/160_accounting_reconciliation_review_concurrency_test.sql"),
    "utf8"
  );

  it("carries the exact server version from the bounded row read to the one-row RPC", () => {
    expect(queueMigration).toContain("pg_catalog.to_jsonb(r)");
    expect(queueData).toContain("review_version: number");
    expect(page).toContain("reviewVersion: r.review_version");
    expect(controls).toContain("expectedReviewVersion: row.reviewVersion");
    expect(actions).toContain("expected_review_version: candidate.expectedReviewVersion as number");
    expect(actions).toContain('"40001": "غيّر مستخدم آخر هذا الصف. لم يُحفظ قرارك؛ حدّث الصفحة وراجعه من جديد."');
  });

  it("compares the version under batch-then-row locks and hides the unversioned writer", () => {
    expect(migration.indexOf("from public.reconciliation_batches b")).toBeLessThan(
      migration.indexOf("select br.frozen, br.reviewed_at")
    );
    expect(migration).toContain("for update;");
    expect(migration).toContain("v_current_review_version <> v_expected_review_version");
    expect(migration).toContain("using errcode = '40001'");
    expect(migration).toContain("revoke all on function public.fn_review_reconciliation_row_unversioned(uuid, jsonb)");
    expect(migration).toContain("p_decision - 'expected_review_version'");
    expect(migration).toContain("new.review_version := old.review_version + 1;");
  });

  it("pins stale-token, tokenless-old-client, and fresh-token behavior in pgTAP", () => {
    expect(dbTest).toContain("a stale explicit token cannot overwrite the first reviewer");
    expect(dbTest).toContain("a tokenless old client cannot overwrite an existing decision");
    expect(dbTest).toContain("both stale attempts leave the first decision byte-for-byte authoritative");
    expect(dbTest).toContain("a fresh exact token permits an explicit re-review");
  });
});

// Type-only guard: DecisionInput stays a discriminated union the builder can exhaust.
const _sample: DecisionInput = { action: "hold", reason: "x" };
void _sample;
