import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isAgedLiveReceivable, isSaleInLiveEra, monthCloseDates, saleBusinessDate } from "./month-close";
import { buildMonthCloseItems, parseMonthCloseSummary } from "./month-close-summary";

describe("month-close sale business date", () => {
  it("uses sale date, then delivery date, then created date", () => {
    expect(
      saleBusinessDate({
        sale_date: "2026-07-04",
        delivery_date: "2026-07-03",
        created_at: "2026-07-02T09:00:00.000Z",
      }),
    ).toBe("2026-07-04");
    expect(saleBusinessDate({ sale_date: null, delivery_date: "2026-07-03", created_at: "2026-07-02T09:00:00.000Z" })).toBe("2026-07-03");
    expect(saleBusinessDate({ sale_date: null, delivery_date: null, created_at: "2026-07-02T09:00:00.000Z" })).toBe("2026-07-02");
  });

  it("excludes imported pre-cutover sales even when they were created after cutover", () => {
    expect(
      isSaleInLiveEra(
        { sale_date: null, delivery_date: "2026-06-30", created_at: "2026-07-02T09:00:00.000Z" },
        "2026-07-01",
      ),
    ).toBe(false);
  });

  it("includes null-sale-date live deliveries by delivery date", () => {
    expect(
      isSaleInLiveEra(
        { sale_date: null, delivery_date: "2026-07-01", created_at: "2026-07-02T09:00:00.000Z" },
        "2026-07-01",
      ),
    ).toBe(true);
  });

  it("ages only receivables inside the live era", () => {
    expect(
      isAgedLiveReceivable(
        { sale_date: null, delivery_date: "2026-06-30", created_at: "2026-07-02T09:00:00.000Z" },
        "2026-07-01",
        "2026-07-31",
      ),
    ).toBe(false);
    expect(
      isAgedLiveReceivable(
        { sale_date: null, delivery_date: "2026-07-01", created_at: "2026-07-02T09:00:00.000Z" },
        "2026-07-01",
        "2026-07-31",
      ),
    ).toBe(true);
  });
});

describe("monthCloseDates", () => {
  it("uses the Cairo calendar day and current month", () => {
    expect(monthCloseDates(new Date("2026-07-15T12:00:00Z"))).toEqual({
      monthStart: "2026-07-01",
      asOf: "2026-07-15",
    });
  });

  it("rolls into the Cairo day even while UTC is still on the prior day", () => {
    expect(monthCloseDates(new Date("2026-07-31T23:30:00Z"))).toEqual({
      monthStart: "2026-08-01",
      asOf: "2026-08-01",
    });
  });
});

describe("parseMonthCloseSummary", () => {
  const valid = {
    pending_price_count: 2,
    undated_expense_count: 2,
    undated_expense_known_total: "42",
    undated_expense_unknown_count: 1,
    unrouted_count: 3,
    unrouted_known_total: "120.50",
    unrouted_unknown_count: 1,
    unclassified_count: 4,
    unclassified_known_total: "220",
    unclassified_unknown_count: 2,
    unallocated_count: 5,
    unallocated_known_total: "330.25",
    unallocated_unknown_count: 1,
    aged_receivable_count: 6,
    aged_receivable_total: "440",
  };

  it("accepts Postgres numeric strings without changing exact counts", () => {
    expect(parseMonthCloseSummary(valid)).toEqual({
      pendingPriceCount: 2,
      undatedExpenseCount: 2,
      undatedExpenseKnownTotal: "42",
      undatedExpenseUnknownCount: 1,
      unroutedCount: 3,
      unroutedKnownTotal: "120.5",
      unroutedUnknownCount: 1,
      unclassifiedCount: 4,
      unclassifiedKnownTotal: "220",
      unclassifiedUnknownCount: 2,
      unallocatedCount: 5,
      unallocatedKnownTotal: "330.25",
      unallocatedUnknownCount: 1,
      agedReceivableCount: 6,
      agedReceivableTotal: "440",
    });
  });

  it("fails closed on missing, negative, fractional, or non-finite fields", () => {
    for (const bad of [null, undefined, [], "bad"]) {
      expect(() => parseMonthCloseSummary(bad)).toThrow();
    }
    for (const bad of [undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "bad"]) {
      expect(() => parseMonthCloseSummary({ ...valid, pending_price_count: bad })).toThrow();
    }
    for (const bad of [undefined, -1, 1, Infinity, NaN, "bad"]) {
      expect(() => parseMonthCloseSummary({ ...valid, aged_receivable_total: bad })).toThrow();
    }
  });

  it("keeps money as canonical decimal text and rejects JSON numbers", () => {
    expect(
      parseMonthCloseSummary({ ...valid, aged_receivable_total: "9007199254740991.01" })
        .agedReceivableTotal,
    ).toBe("9007199254740991.01");
    expect(() => parseMonthCloseSummary({ ...valid, aged_receivable_total: 0.1 })).toThrow(
      /decimal text/,
    );
  });

  it("marks only valid aged receivables as visible nonblocking follow-up", () => {
    const items = buildMonthCloseItems(parseMonthCloseSummary(valid));

    expect(items.find((item) => item.key === "aged_receivable")).toMatchObject({
      label: "ذمم عمرها ٣٠ يومًا فأكثر",
      count: 6,
      amount: "440",
      href: "/record/collect",
      cta: "تابع التحصيل",
      tone: "watch",
      blocksClose: false,
    });
    expect(items.filter((item) => item.blocksClose).map((item) => item.key)).toEqual([
      "pending_price",
      "undated_expense",
      "unrouted_expense",
      "unclassified_expense",
      "unallocated_expense",
    ]);
    expect(items.find((item) => item.key === "undated_expense")?.href).toBe("/expenses?filter=undated");
  });
});

describe("month-close page source contract", () => {
  const page = readFileSync(new URL("../app/(app)/finance/close/page.tsx", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../app/(app)/finance/periods/actions.ts", import.meta.url), "utf8");
  const classicExpenseActions = readFileSync(
    new URL("../app/(app)/expenses/actions.ts", import.meta.url),
    "utf8",
  );
  const guidedExpenseActions = readFileSync(
    new URL("../app/(app)/record/actions.ts", import.meta.url),
    "utf8",
  );
  const expenseRegisterPage = readFileSync(
    new URL("../app/(app)/expenses/page.tsx", import.meta.url),
    "utf8",
  );
  const expenseDetailPage = readFileSync(
    new URL("../app/(app)/expenses/[expenseId]/page.tsx", import.meta.url),
    "utf8",
  );
  const migration = readFileSync(
    new URL("../supabase/migrations/20260808070000_month_close_exact_summary.sql", import.meta.url),
    "utf8",
  );

  it("uses one exact RPC and fails closed instead of reducing PostgREST row arrays", () => {
    expect(page).toContain('.rpc("fn_month_close_summary"');
    expect(page).toContain("if (summaryRes.error) throw summaryRes.error");
    expect(page).not.toContain('.from("expenses")');
    expect(page).not.toContain('.from("sales")');
    expect(page).not.toContain('.from("sale_collections")');
    expect(page).not.toContain(".reduce(");
  });

  it("ties the inline close action to the exact Cairo dates the checklist evaluated", () => {
    expect(page).toContain('name="period_start"');
    expect(page).toContain('name="period_end"');
    expect(page).toContain("readOnly");
    expect(actions).toContain("returnTo === RETURN_TO.close");
    expect(actions).toContain("monthCloseDates()");
    expect(actions).toContain("بيانات قائمة الإقفال قديمة");
  });

  it("rechecks the exact blocker snapshot inside the serialized close transaction", () => {
    const sourceMutex = migration.indexOf(
      "create or replace function private.fn_lock_month_close_source_write()",
    );
    const tenantGuard = migration.indexOf(
      "forbidden: source write requires budget.write in every organization",
      sourceMutex,
    );
    const nonWaitingLock = migration.indexOf("pg_try_advisory_xact_lock_shared", tenantGuard);
    const expenseTrigger = migration.indexOf("before insert or update or delete on public.expenses", sourceMutex);
    const saleTrigger = migration.indexOf("before insert or update or delete on public.sales", expenseTrigger);
    const collectionTrigger = migration.indexOf(
      "before insert or update or delete on public.sale_collections",
      saleTrigger,
    );
    const periodMutex = migration.indexOf(
      "pg_catalog.pg_advisory_xact_lock(private.fn_accounting_period_mutex_key(p_org))",
      collectionTrigger,
    );
    const readiness = migration.indexOf(
      "v_readiness := public.fn_month_close_summary(p_org, date '2026-07-01', p_period_end)",
      periodMutex,
    );
    const insert = migration.indexOf("insert into public.accounting_periods", readiness);

    expect(sourceMutex).toBeGreaterThan(-1);
    expect(tenantGuard).toBeGreaterThan(sourceMutex);
    expect(nonWaitingLock).toBeGreaterThan(tenantGuard);
    expect(expenseTrigger).toBeGreaterThan(sourceMutex);
    expect(saleTrigger).toBeGreaterThan(expenseTrigger);
    expect(collectionTrigger).toBeGreaterThan(saleTrigger);
    expect(periodMutex).toBeGreaterThan(collectionTrigger);
    expect(readiness).toBeGreaterThan(periodMutex);
    expect(insert).toBeGreaterThan(readiness);
    expect(migration).toContain("using errcode = '55000'");
    expect(migration).toContain("using errcode = '55P03'");
    expect(actions).toContain('"55000":');
  });

  it("takes the reversal mutex before delegating to the released row-locking implementation", () => {
    const conditionalMove = migration.indexOf(
      "if pg_catalog.to_regprocedure(\n    'private.fn_reverse_expense_payment_after_month_close_lock",
    );
    const wrapper = migration.indexOf("create or replace function public.fn_reverse_expense_payment(");
    const nonWaitingLock = migration.indexOf("pg_catalog.pg_try_advisory_xact_lock_shared", wrapper);
    const delegate = migration.indexOf("private.fn_reverse_expense_payment_after_month_close_lock(", nonWaitingLock);

    expect(conditionalMove).toBeGreaterThan(-1);
    expect(wrapper).toBeGreaterThan(-1);
    expect(nonWaitingLock).toBeGreaterThan(wrapper);
    expect(delegate).toBeGreaterThan(nonWaitingLock);
    expect(migration).toContain(
      "revoke all on function private.fn_reverse_expense_payment_after_month_close_lock",
    );
  });

  it("rejects accounting periods beyond the current Cairo business date", () => {
    expect(migration).toContain("p_period_end > (pg_catalog.now() at time zone 'Africa/Cairo')::date");
    expect(migration).toContain("period end cannot be after the current Cairo business date");
  });

  it("pins the timestamptz fallback to UTC instead of the database session timezone", () => {
    expect(migration.match(/created_at at time zone 'UTC'/g)).toHaveLength(2);
    expect(migration).not.toContain("created_at::date");
  });

  it("discloses unknown amounts and that readiness is a dated snapshot", () => {
    expect(page).toContain("unknownCount");
    expect(page).toContain("مبالغها غير مسجلة");
    expect(page).toContain("لقطة");
  });

  it("keeps aged receivables visible for follow-up without making collection a close prerequisite", () => {
    const closeFunction = migration.slice(
      migration.indexOf("create or replace function public.fn_close_accounting_period("),
      migration.indexOf("create or replace function public.fn_set_missing_expense_date("),
    );

    expect(page).toContain("buildMonthCloseItems(summary)");
    expect(page).toContain("visibleItems.filter((i) => i.blocksClose)");
    expect(page).toContain("لا معلّقات تمنع الإقفال");
    expect(page).toContain("لا تمنع إقفال الفترة");
    expect(closeFunction).toContain("v_blocker_count :=");
    expect(closeFunction).not.toContain("(v_readiness->>'aged_receivable_count')::bigint");
  });

  it("routes source-write mutex errors through the central Arabic retry mapper", () => {
    for (const source of [classicExpenseActions, guidedExpenseActions]) {
      expect(source).toContain("toArabicError(");
      expect(source).toContain('"42501": "تعذّر تسجيل المصروف (تحقّق من صلاحياتك)"');
    }
  });

  it("routes every undated blocker to an exact filter and controlled date correction", () => {
    expect(expenseRegisterPage).toContain('p_filter: effectiveFilter');
    expect(expenseRegisterPage).toContain('effectiveFilter === "undated"');
    expect(expenseRegisterPage).toContain("value: matchingCount");
    expect(expenseRegisterPage).not.toContain('.from("expenses")');
    expect(expenseDetailPage).toContain("setMissingExpenseDate");
    expect(classicExpenseActions).toContain('.rpc("fn_set_missing_expense_date"');
    expect(migration).toContain("expense date falls inside a locked accounting period");
  });
});
