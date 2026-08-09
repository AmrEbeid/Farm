import { compareDecimals, parseDecimal, type DecimalString } from "./decimal";

export type ExpenseDetailMovement = {
  id: string;
  occurred_at: string;
  created_at: string;
  movement_type: string;
  amount_in: DecimalString;
  amount_out: DecimalString;
  custody_account_id: string;
  custody_account_label: string;
  payment_request_id: string | null;
  reversal_of: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
  expense_reversal_outcome: string | null;
};

type NamedLink = { id: string; name: string | null };
type PlanLink = { id: string; type: string | null; period_start: string | null; period_end: string | null };
type EventLink = { id: string; subtype: string | null; status: string | null; occurred_at: string | null; notes: string | null };
type AccountLink = { id: string; code: string; name_ar: string };

export type ExpenseDetail = {
  id: string;
  date: string | null;
  category: string | null;
  description: string | null;
  total: DecimalString | null;
  qty: DecimalString | null;
  unit: string | null;
  unit_price: DecimalString | null;
  payment_method: string | null;
  status: string | null;
  payment_status: string | null;
  kind: string;
  account_id: string | null;
  cost_center_id: string | null;
  supplier_id: string | null;
  plan_id: string | null;
  event_id: string | null;
  farm_id: string | null;
  sector_id: string | null;
  hawsha_id: string | null;
  supplier: NamedLink | null;
  plan: PlanLink | null;
  farm: NamedLink | null;
  sector: NamedLink | null;
  hawsha: NamedLink | null;
};

export type ExpenseDetailSnapshot = {
  orgId: string;
  expenseId: string;
  expense: ExpenseDetail | null;
  event: EventLink | null;
  account: AccountLink | null;
  movements: ExpenseDetailMovement[];
  requestLinked: boolean;
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expense detail snapshot: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`expense detail snapshot: ${label} must be a non-empty string`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value == null ? null : string(value, label);
}

function date(value: unknown, label: string): string {
  const parsed = string(value, label);
  const instant = new Date(`${parsed}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed) || Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== parsed) {
    throw new Error(`expense detail snapshot: ${label} must be an ISO date`);
  }
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const parsed = string(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)$/.exec(parsed);
  if (!match) {
    throw new Error(`expense detail snapshot: ${label} must be an ISO timestamp`);
  }
  const [, year, month, day, hour, minute, second, offsetSign, offsetHour = "00", offsetMinute = "00"] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const validCalendar =
    calendar.getUTCFullYear() === Number(year) &&
    calendar.getUTCMonth() === Number(month) - 1 &&
    calendar.getUTCDate() === Number(day);
  const validTime = Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
  const validOffset =
    !offsetSign ||
    (Number(offsetHour) <= 14 && Number(offsetMinute) <= 59 && (Number(offsetHour) < 14 || offsetMinute === "00"));
  if (!validCalendar || !validTime || !validOffset || Number.isNaN(Date.parse(parsed))) {
    throw new Error(`expense detail snapshot: ${label} must be an ISO timestamp`);
  }
  return parsed;
}

function decimal(value: unknown, label: string): DecimalString {
  const parsed = typeof value === "string" ? parseDecimal(value) : null;
  if (parsed == null || compareDecimals(parsed, "0") < 0) {
    throw new Error(`expense detail snapshot: ${label} must be non-negative decimal text`);
  }
  return parsed;
}

function named(value: unknown, label: string): NamedLink | null {
  if (value == null) return null;
  const row = object(value, label);
  return { id: string(row.id, `${label}.id`), name: nullableString(row.name, `${label}.name`) };
}

export function parseExpenseDetailSnapshot(value: unknown): ExpenseDetailSnapshot {
  const row = object(value, "payload");
  if (row.version !== "farm-os.expense-detail.v1") {
    throw new Error("expense detail snapshot: unsupported version");
  }
  const orgId = string(row.org_id, "org_id");
  const expenseId = string(row.expense_id, "expense_id");
  if (typeof row.request_linked !== "boolean") {
    throw new Error("expense detail snapshot: request_linked must be boolean");
  }

  const movements = (() => {
    if (!Array.isArray(row.movements)) throw new Error("expense detail snapshot: movements must be an array");
    const ids = new Set<string>();
    return row.movements.map((item, index) => {
      const movement = object(item, `movements[${index}]`);
      const id = string(movement.id, `movements[${index}].id`);
      if (ids.has(id)) throw new Error(`expense detail snapshot: duplicate movement id ${id}`);
      ids.add(id);
      const amountIn = decimal(movement.amount_in, `movements[${index}].amount_in`);
      const amountOut = decimal(movement.amount_out, `movements[${index}].amount_out`);
      if ((amountIn !== "0") === (amountOut !== "0")) {
        throw new Error(`expense detail snapshot: movements[${index}] must have exactly one positive direction`);
      }
      return {
        id,
        occurred_at: date(movement.occurred_at, `movements[${index}].occurred_at`),
        created_at: timestamp(movement.created_at, `movements[${index}].created_at`),
        movement_type: string(movement.movement_type, `movements[${index}].movement_type`),
        amount_in: amountIn,
        amount_out: amountOut,
        custody_account_id: string(movement.custody_account_id, `movements[${index}].custody_account_id`),
        custody_account_label: string(movement.custody_account_label, `movements[${index}].custody_account_label`),
        payment_request_id: nullableString(movement.payment_request_id, `movements[${index}].payment_request_id`),
        reversal_of: nullableString(movement.reversal_of, `movements[${index}].reversal_of`),
        reversed_by: nullableString(movement.reversed_by, `movements[${index}].reversed_by`),
        reversal_reason: nullableString(movement.reversal_reason, `movements[${index}].reversal_reason`),
        expense_reversal_outcome: nullableString(movement.expense_reversal_outcome, `movements[${index}].expense_reversal_outcome`),
      };
    });
  })();

  if (row.expense == null) {
    if (row.event != null || row.account != null || movements.length || row.request_linked) {
      throw new Error("expense detail snapshot: missing expense cannot carry linked data");
    }
    return { orgId, expenseId, expense: null, event: null, account: null, movements, requestLinked: false };
  }

  const raw = object(row.expense, "expense");
  const expense: ExpenseDetail = {
    id: string(raw.id, "expense.id"),
    date: raw.date == null ? null : date(raw.date, "expense.date"),
    category: nullableString(raw.category, "expense.category"),
    description: nullableString(raw.description, "expense.description"),
    total: raw.total == null ? null : decimal(raw.total, "expense.total"),
    qty: raw.qty == null ? null : decimal(raw.qty, "expense.qty"),
    unit: nullableString(raw.unit, "expense.unit"),
    unit_price: raw.unit_price == null ? null : decimal(raw.unit_price, "expense.unit_price"),
    payment_method: nullableString(raw.payment_method, "expense.payment_method"),
    status: nullableString(raw.status, "expense.status"),
    payment_status: nullableString(raw.payment_status, "expense.payment_status"),
    kind: string(raw.kind, "expense.kind"),
    account_id: nullableString(raw.account_id, "expense.account_id"),
    cost_center_id: nullableString(raw.cost_center_id, "expense.cost_center_id"),
    supplier_id: nullableString(raw.supplier_id, "expense.supplier_id"),
    plan_id: nullableString(raw.plan_id, "expense.plan_id"),
    event_id: nullableString(raw.event_id, "expense.event_id"),
    farm_id: nullableString(raw.farm_id, "expense.farm_id"),
    sector_id: nullableString(raw.sector_id, "expense.sector_id"),
    hawsha_id: nullableString(raw.hawsha_id, "expense.hawsha_id"),
    supplier: named(raw.supplier, "expense.supplier"),
    plan: (() => {
      if (raw.plan == null) return null;
      const plan = object(raw.plan, "expense.plan");
      return {
        id: string(plan.id, "expense.plan.id"),
        type: nullableString(plan.type, "expense.plan.type"),
        period_start: plan.period_start == null ? null : date(plan.period_start, "expense.plan.period_start"),
        period_end: plan.period_end == null ? null : date(plan.period_end, "expense.plan.period_end"),
      };
    })(),
    farm: named(raw.farm, "expense.farm"),
    sector: named(raw.sector, "expense.sector"),
    hawsha: named(raw.hawsha, "expense.hawsha"),
  };
  if (expense.id !== expenseId) throw new Error("expense detail snapshot: expense id disagrees with scope");

  const assertLink = (id: string | null, link: { id: string } | null, label: string) => {
    if ((id == null) !== (link == null) || (link && link.id !== id)) {
      throw new Error(`expense detail snapshot: ${label} link is inconsistent`);
    }
  };
  assertLink(expense.supplier_id, expense.supplier, "supplier");
  assertLink(expense.plan_id, expense.plan, "plan");
  assertLink(expense.farm_id, expense.farm, "farm");
  assertLink(expense.sector_id, expense.sector, "sector");
  assertLink(expense.hawsha_id, expense.hawsha, "hawsha");

  const event = (() => {
    if (row.event == null) return null;
    const event = object(row.event, "event");
    return {
      id: string(event.id, "event.id"),
      subtype: nullableString(event.subtype, "event.subtype"),
      status: nullableString(event.status, "event.status"),
      occurred_at: event.occurred_at == null ? null : timestamp(event.occurred_at, "event.occurred_at"),
      notes: nullableString(event.notes, "event.notes"),
    };
  })();
  const account = (() => {
    if (row.account == null) return null;
    const account = object(row.account, "account");
    return {
      id: string(account.id, "account.id"),
      code: string(account.code, "account.code"),
      name_ar: string(account.name_ar, "account.name_ar"),
    };
  })();
  assertLink(expense.event_id, event, "event");
  if (account && account.id !== expense.account_id) {
    throw new Error("expense detail snapshot: account link is inconsistent");
  }

  return { orgId, expenseId, expense, event, account, movements, requestLinked: row.request_linked };
}
