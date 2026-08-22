export const EXPENSE_PAYMENT_REVERSAL_OUTCOMES = ["unrouted", "cancelled"] as const;

export type ExpensePaymentReversalOutcome = (typeof EXPENSE_PAYMENT_REVERSAL_OUTCOMES)[number];

export type ExpensePaymentReversalInput = {
  expenseId: string;
  movementId: string;
  outcome: string;
  reason: string;
  reversalDate: string;
};

export type ParsedExpensePaymentReversal = {
  expenseId: string;
  movementId: string;
  outcome: ExpensePaymentReversalOutcome;
  reason: string;
  reversalDate: string;
};

export const EXPENSE_CORRECTION_ROUTES = ["custody", "later", "none"] as const;
export type ExpenseCorrectionRoute = (typeof EXPENSE_CORRECTION_ROUTES)[number];

export type ExpenseCorrectionInput = {
  expenseId: string;
  date: string;
  category: string;
  description: string;
  total: number;
  supplierId: string;
  accountId: string;
  costCenterId: string;
  route: string;
  custodyAccountId: string;
};

export type ParsedExpenseCorrection = {
  expenseId: string;
  date: string | null;
  category: string;
  description: string | null;
  total: number;
  supplierId: string | null;
  accountId: string | null;
  costCenterId: string | null;
  route: ExpenseCorrectionRoute;
  custodyAccountId: string | null;
};

type PaymentAttemptMovement = {
  amount_out: number;
  reversal_of: string | null;
  reversed_by: string | null;
};

export function selectExpensePaymentState<T extends PaymentAttemptMovement>(movements: T[]) {
  const activePayment = movements.find(
    (movement) => movement.amount_out > 0 && !movement.reversal_of && !movement.reversed_by,
  );
  const latestReversal = activePayment
    ? undefined
    : movements.filter((movement) => movement.reversal_of).at(-1);

  return { activePayment, latestReversal };
}

export function parseExpensePaymentReversal(
  input: ExpensePaymentReversalInput,
): { ok: true; value: ParsedExpensePaymentReversal } | { ok: false; error: string } {
  const expenseId = input.expenseId.trim();
  if (!expenseId) return { ok: false, error: "المصروف غير محدد" };
  const movementId = input.movementId.trim();
  if (!movementId) return { ok: false, error: "حركة السداد غير محددة" };

  if (!EXPENSE_PAYMENT_REVERSAL_OUTCOMES.includes(input.outcome as ExpensePaymentReversalOutcome)) {
    return { ok: false, error: "اختر نتيجة التصحيح" };
  }

  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "اكتب سبب التصحيح" };
  if (reason.length > 500) return { ok: false, error: "سبب التصحيح أطول من الحد المسموح" };

  const reversalDate = input.reversalDate.trim();
  if (!isDateOnly(reversalDate)) return { ok: false, error: "تاريخ التصحيح غير صالح" };

  return {
    ok: true,
    value: {
      expenseId,
      movementId,
      outcome: input.outcome as ExpensePaymentReversalOutcome,
      reason,
      reversalDate,
    },
  };
}

export function parseExpenseCorrection(
  input: ExpenseCorrectionInput,
): { ok: true; value: ParsedExpenseCorrection } | { ok: false; error: string } {
  const expenseId = input.expenseId.trim();
  if (!expenseId) return { ok: false, error: "المصروف غير محدد" };

  const category = input.category.trim();
  if (!category) return { ok: false, error: "اكتب على ماذا صُرف المبلغ" };
  if (category.length > 80) return { ok: false, error: "فئة المصروف أطول من الحد المسموح" };
  if (!Number.isFinite(input.total) || input.total <= 0) return { ok: false, error: "المبلغ غير صالح" };

  const date = input.date.trim();
  if (date && !isDateOnly(date)) return { ok: false, error: "تاريخ المصروف غير صالح" };
  const description = input.description.trim();
  if (description.length > 200) return { ok: false, error: "بيان المصروف أطول من الحد المسموح" };

  if (!EXPENSE_CORRECTION_ROUTES.includes(input.route as ExpenseCorrectionRoute)) {
    return { ok: false, error: "اختر مسار السداد" };
  }
  const custodyAccountId = input.custodyAccountId.trim();
  if (input.route === "custody" && !custodyAccountId) {
    return { ok: false, error: "اختر العهدة التي دُفع منها" };
  }

  return {
    ok: true,
    value: {
      expenseId,
      date: date || null,
      category,
      description: description || null,
      total: input.total,
      supplierId: input.supplierId.trim() || null,
      accountId: input.accountId.trim() || null,
      costCenterId: input.costCenterId.trim() || null,
      route: input.route as ExpenseCorrectionRoute,
      custodyAccountId: custodyAccountId || null,
    },
  };
}

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
