import type { createClient } from "@/lib/supabase/server";
import { isExecutableOpStatus } from "@/lib/labels";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type LinkedEntityType = "farm" | "sector" | "hawsha" | "line" | "palm";

type EntityIds = {
  farmIds: string[];
  sectorIds: string[];
  hawshaIds: string[];
  lineIds: string[];
  palmIds: string[];
};

type PlanRow = {
  id: string;
  type: string | null;
  period_start: string | null;
  period_end: string | null;
  scope_type: string | null;
  scope_id: string | null;
  status: string;
};

type PlanEmbed = {
  id?: string | null;
  type?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  scope_type?: string | null;
  scope_id?: string | null;
  status?: string | null;
};

export type LinkedOperation = {
  id: string;
  plan_id: string;
  subtype: string | null;
  target_type: string | null;
  target_id: string | null;
  planned_at: string | null;
  ends_on: string | null;
  est_cost: number | string | null;
  status: string;
  responsible_person_id: string | null;
  plan: PlanEmbed | null;
};

export type LinkedAssignee = {
  id: string;
  plan_op_id: string;
  person_id: string;
  is_lead: boolean;
  person: { id?: string | null; name?: string | null; position?: string | null } | null;
};

export type LinkedEvent = {
  id: string;
  type: string | null;
  subtype: string | null;
  status: string | null;
  occurred_at: string | null;
  planned_at: string | null;
  notes: string | null;
  plan_id: string | null;
  performed_by_person_id: string | null;
  assigned_to_person_id: string | null;
};

export type LinkedExpense = {
  id: string;
  date: string | null;
  category: string | null;
  description: string | null;
  total: number | string | null;
  kind: string | null;
  payment_status: string | null;
  sector_id: string | null;
  hawsha_id: string | null;
  event_id: string | null;
  plan_id: string | null;
};

export type LinkedPaymentRequestLine = {
  id: string;
  payment_request_id: string;
  expense_id: string;
  paid_at: string | null;
  paid_by: string | null;
  paid_from_custody_account_id: string | null;
  custody_movement_id: string | null;
  journal_entry_id: string | null;
};

export type LinkedPaymentRequest = {
  id: string;
  request_no: number;
  status: string;
  period_start: string | null;
  period_end: string | null;
  custody_account_id: string | null;
  approved_net_request: number | string | null;
  created_at: string;
};

export type LinkedCustodyMovement = {
  id: string;
  custody_account_id: string;
  occurred_at: string;
  movement_type: string;
  amount_in: number | string;
  amount_out: number | string;
  expense_id: string | null;
  payment_request_id: string | null;
  journal_entry_id: string | null;
};

export type LinkedJournalLine = {
  id: string;
  journal_entry_id: string;
  account_id: string;
  debit: number | string;
  credit: number | string;
  description: string | null;
  custody_account_id: string | null;
  custody_movement_id: string | null;
  expense_id: string | null;
  payment_request_id: string | null;
};

export type LinkedAccount = {
  id: string;
  code: string;
  name_ar: string;
  account_type: string;
};

export type LinkedWorkContext = {
  entityType: LinkedEntityType;
  entityId: string;
  ids: EntityIds;
  plans: PlanRow[];
  operations: LinkedOperation[];
  assignees: LinkedAssignee[];
  events: LinkedEvent[];
  expenses: LinkedExpense[];
  paymentRequestLines: LinkedPaymentRequestLine[];
  paymentRequests: LinkedPaymentRequest[];
  custodyMovements: LinkedCustodyMovement[];
  journalLines: LinkedJournalLine[];
  accounts: LinkedAccount[];
  assigneesByOperation: Map<string, LinkedAssignee[]>;
  openOperations: LinkedOperation[];
  unassignedOperations: LinkedOperation[];
  dueOperations: LinkedOperation[];
  financeTotals: {
    expenseTotal: number;
    unpaidTotal: number;
    custodyOut: number;
    journalDebit: number;
    journalCredit: number;
  };
};

export async function getLinkedWorkContext(
  sb: SupabaseServerClient,
  {
    orgId,
    entityType,
    entityId,
    canSeeFinance = false,
  }: {
    orgId: string;
    entityType: LinkedEntityType;
    entityId: string;
    canSeeFinance?: boolean;
  },
): Promise<LinkedWorkContext> {
  const ids = await resolveEntityIds(sb, orgId, entityType, entityId);
  const plans = await fetchPlans(sb, orgId, ids);
  const planIds = new Set(plans.map((plan) => plan.id));
  const operations = await fetchOperations(sb, orgId, ids, planIds);
  operations.forEach((op) => planIds.add(op.plan_id));

  const [assignees, events] = await Promise.all([
    fetchAssignees(sb, operations.map((op) => op.id)),
    fetchEvents(sb, orgId, ids),
  ]);
  const eventIds = new Set(events.map((event) => event.id));
  const assigneesByOperation = groupAssignees(assignees);

  const finance = canSeeFinance
    ? await fetchFinanceLinks(sb, orgId, ids, planIds, eventIds)
    : {
        expenses: [] as LinkedExpense[],
        paymentRequestLines: [] as LinkedPaymentRequestLine[],
        paymentRequests: [] as LinkedPaymentRequest[],
        custodyMovements: [] as LinkedCustodyMovement[],
        journalLines: [] as LinkedJournalLine[],
        accounts: [] as LinkedAccount[],
      };

  const openOperations = operations.filter((op) => isExecutableOpStatus(op.status));
  const unassignedOperations = openOperations.filter((op) => {
    const current = assigneesByOperation.get(op.id) ?? [];
    return current.length === 0 && !op.responsible_person_id;
  });
  const today = new Date().toISOString().slice(0, 10);
  const dueOperations = openOperations.filter((op) => op.planned_at && op.planned_at.slice(0, 10) <= today);

  return {
    entityType,
    entityId,
    ids,
    plans,
    operations,
    assignees,
    events,
    ...finance,
    assigneesByOperation,
    openOperations,
    unassignedOperations,
    dueOperations,
    financeTotals: buildFinanceTotals(finance),
  };
}

async function resolveEntityIds(
  sb: SupabaseServerClient,
  orgId: string,
  entityType: LinkedEntityType,
  entityId: string,
): Promise<EntityIds> {
  const ids: EntityIds = { farmIds: [], sectorIds: [], hawshaIds: [], lineIds: [], palmIds: [] };

  if (entityType === "farm") {
    ids.farmIds = [entityId];
    const { data: sectors, error: sectorsError } = await sb
      .from("sectors")
      .select("id")
      .eq("org_id", orgId)
      .eq("farm_id", entityId)
      .eq("archived", false);
    if (sectorsError) throw sectorsError;
    ids.sectorIds = unique((sectors ?? []).map((row) => row.id));
  }

  if (entityType === "sector") {
    const { data: sector, error } = await sb
      .from("sectors")
      .select("id, farm_id")
      .eq("org_id", orgId)
      .eq("id", entityId)
      .maybeSingle();
    if (error) throw error;
    if (sector) {
      ids.farmIds = [sector.farm_id];
      ids.sectorIds = [sector.id];
    }
  }

  if (entityType === "hawsha") {
    const { data: hawsha, error } = await sb
      .from("hawshat")
      .select("id, sector_id")
      .eq("org_id", orgId)
      .eq("id", entityId)
      .maybeSingle();
    if (error) throw error;
    if (hawsha) {
      ids.hawshaIds = [hawsha.id];
      ids.sectorIds = [hawsha.sector_id];
      const { data: sector, error: sectorError } = await sb
        .from("sectors")
        .select("farm_id")
        .eq("org_id", orgId)
        .eq("id", hawsha.sector_id)
        .maybeSingle();
      if (sectorError) throw sectorError;
      if (sector?.farm_id) ids.farmIds = [sector.farm_id];
    }
  }

  if (entityType === "line") {
    const { data: line, error } = await sb
      .from("lines")
      .select("id, hawsha_id")
      .eq("org_id", orgId)
      .eq("id", entityId)
      .maybeSingle();
    if (error) throw error;
    if (line) {
      ids.lineIds = [line.id];
      ids.hawshaIds = [line.hawsha_id];
      await addHawshaAncestors(sb, orgId, ids, line.hawsha_id);
    }
  }

  if (entityType === "palm") {
    const { data: palm, error } = await sb
      .from("assets")
      .select("id, sector_id, hawsha_id, line_id")
      .eq("org_id", orgId)
      .eq("id", entityId)
      .eq("type", "palm")
      .maybeSingle();
    if (error) throw error;
    if (palm) {
      ids.palmIds = [palm.id];
      if (palm.line_id) ids.lineIds = [palm.line_id];
      if (palm.hawsha_id) {
        ids.hawshaIds = [palm.hawsha_id];
        await addHawshaAncestors(sb, orgId, ids, palm.hawsha_id);
      } else if (palm.sector_id) {
        ids.sectorIds = [palm.sector_id];
        await addSectorAncestor(sb, orgId, ids, palm.sector_id);
      }
    }
  }

  if (ids.sectorIds.length > 0 && entityType !== "hawsha" && entityType !== "line" && entityType !== "palm") {
    const { data: hawshat, error } = await sb
      .from("hawshat")
      .select("id")
      .eq("org_id", orgId)
      .in("sector_id", ids.sectorIds)
      .eq("archived", false);
    if (error) throw error;
    ids.hawshaIds = unique([...ids.hawshaIds, ...(hawshat ?? []).map((row) => row.id)]);
  }

  if (ids.hawshaIds.length > 0 && entityType !== "line" && entityType !== "palm") {
    const { data: lines, error } = await sb
      .from("lines")
      .select("id")
      .eq("org_id", orgId)
      .in("hawsha_id", ids.hawshaIds)
      .eq("archived", false);
    if (error) throw error;
    ids.lineIds = unique([...ids.lineIds, ...(lines ?? []).map((row) => row.id)]);
  }

  if (ids.lineIds.length > 0) {
    const { data: palms, error } = await sb
      .from("assets")
      .select("id")
      .eq("org_id", orgId)
      .eq("type", "palm")
      .eq("archived", false)
      .in("line_id", ids.lineIds);
    if (error) throw error;
    ids.palmIds = unique([...ids.palmIds, ...(palms ?? []).map((row) => row.id)]);
  } else if (ids.hawshaIds.length > 0) {
    const { data: palms, error } = await sb
      .from("assets")
      .select("id")
      .eq("org_id", orgId)
      .eq("type", "palm")
      .eq("archived", false)
      .in("hawsha_id", ids.hawshaIds);
    if (error) throw error;
    ids.palmIds = unique([...ids.palmIds, ...(palms ?? []).map((row) => row.id)]);
  }

  ids.farmIds = unique(ids.farmIds);
  ids.sectorIds = unique(ids.sectorIds);
  ids.hawshaIds = unique(ids.hawshaIds);
  ids.lineIds = unique(ids.lineIds);
  ids.palmIds = unique(ids.palmIds);

  return ids;
}

async function addHawshaAncestors(
  sb: SupabaseServerClient,
  orgId: string,
  ids: EntityIds,
  hawshaId: string,
) {
  const { data: hawsha, error } = await sb
    .from("hawshat")
    .select("sector_id")
    .eq("org_id", orgId)
    .eq("id", hawshaId)
    .maybeSingle();
  if (error) throw error;
  if (hawsha?.sector_id) {
    ids.sectorIds = unique([...ids.sectorIds, hawsha.sector_id]);
    await addSectorAncestor(sb, orgId, ids, hawsha.sector_id);
  }
}

async function addSectorAncestor(
  sb: SupabaseServerClient,
  orgId: string,
  ids: EntityIds,
  sectorId: string,
) {
  const { data: sector, error } = await sb
    .from("sectors")
    .select("farm_id")
    .eq("org_id", orgId)
    .eq("id", sectorId)
    .maybeSingle();
  if (error) throw error;
  if (sector?.farm_id) ids.farmIds = unique([...ids.farmIds, sector.farm_id]);
}

async function fetchPlans(
  sb: SupabaseServerClient,
  orgId: string,
  ids: EntityIds,
): Promise<PlanRow[]> {
  const { data, error } = await sb
    .from("plans")
    .select("id, type, period_start, period_end, scope_type, scope_id, status")
    .eq("org_id", orgId)
    .order("period_start", { ascending: false })
    .limit(120);
  if (error) throw error;
  return ((data ?? []) as PlanRow[]).filter((plan) => matchesScope(plan.scope_type, plan.scope_id, ids));
}

async function fetchOperations(
  sb: SupabaseServerClient,
  orgId: string,
  ids: EntityIds,
  planIds: Set<string>,
): Promise<LinkedOperation[]> {
  const { data, error } = await sb
    .from("plan_operations")
    .select(
      "id, plan_id, subtype, target_type, target_id, planned_at, ends_on, est_cost, status, responsible_person_id, plans(id, type, period_start, period_end, scope_type, scope_id, status)",
    )
    .eq("org_id", orgId)
    .order("planned_at", { ascending: true })
    .limit(200);
  if (error) throw error;

  return ((data ?? []) as unknown as LinkedOperation[]).filter(
    (op) => planIds.has(op.plan_id) || matchesScope(op.target_type, op.target_id, ids),
  );
}

async function fetchAssignees(
  sb: SupabaseServerClient,
  operationIds: string[],
): Promise<LinkedAssignee[]> {
  if (operationIds.length === 0) return [];
  const { data, error } = await sb
    .from("plan_operation_assignees")
    .select("id, plan_op_id, person_id, is_lead")
    .in("plan_op_id", operationIds);
  if (error) throw error;
  const rows = data ?? [];
  const personIds = unique(rows.map((row) => row.person_id));
  const { data: people, error: peopleError } = personIds.length
    ? await sb.from("people").select("id, name, position").in("id", personIds)
    : { data: [], error: null };
  if (peopleError) throw peopleError;
  const peopleById = new Map((people ?? []).map((person) => [person.id, person]));
  return rows.map((row) => ({
    id: row.id,
    plan_op_id: row.plan_op_id,
    person_id: row.person_id,
    is_lead: row.is_lead,
    person: peopleById.get(row.person_id) ?? null,
  }));
}

async function fetchEvents(
  sb: SupabaseServerClient,
  orgId: string,
  ids: EntityIds,
): Promise<LinkedEvent[]> {
  const eventIds = new Set<string>();

  await Promise.all([
    addLocationEventIds(sb, orgId, "farm_id", ids.farmIds, eventIds),
    addLocationEventIds(sb, orgId, "sector_id", ids.sectorIds, eventIds),
    addLocationEventIds(sb, orgId, "hawsha_id", ids.hawshaIds, eventIds),
    addLocationEventIds(sb, orgId, "line_id", ids.lineIds, eventIds),
  ]);

  if (ids.palmIds.length) {
    const { data, error } = await sb
      .from("event_assets")
      .select("event_id")
      .eq("org_id", orgId)
      .in("asset_id", ids.palmIds);
    if (error) throw error;
    for (const row of data ?? []) eventIds.add(row.event_id);
  }

  if (eventIds.size === 0) return [];
  const { data, error } = await sb
    .from("farm_event")
    .select("id, type, subtype, status, occurred_at, planned_at, notes, plan_id, performed_by_person_id, assigned_to_person_id")
    .eq("org_id", orgId)
    .in("id", [...eventIds])
    .order("occurred_at", { ascending: false })
    .limit(120);
  if (error) throw error;
  return (data ?? []) as LinkedEvent[];
}

async function addLocationEventIds(
  sb: SupabaseServerClient,
  orgId: string,
  column: "farm_id" | "sector_id" | "hawsha_id" | "line_id",
  values: string[],
  eventIds: Set<string>,
) {
  if (values.length === 0) return;
  const { data, error } = await sb
    .from("event_locations")
    .select("event_id")
    .eq("org_id", orgId)
    .in(column, values);
  if (error) throw error;
  for (const row of data ?? []) eventIds.add(row.event_id);
}

async function fetchFinanceLinks(
  sb: SupabaseServerClient,
  orgId: string,
  ids: EntityIds,
  planIds: Set<string>,
  eventIds: Set<string>,
) {
  const { data: rawExpenses, error: expensesError } = await sb
    .from("expenses")
    .select("id, date, category, description, total, kind, payment_status, sector_id, hawsha_id, event_id, plan_id")
    .eq("org_id", orgId)
    .order("date", { ascending: false })
    .limit(200);
  if (expensesError) throw expensesError;

  const expenses = ((rawExpenses ?? []) as LinkedExpense[]).filter(
    (expense) =>
      has(ids.sectorIds, expense.sector_id) ||
      has(ids.hawshaIds, expense.hawsha_id) ||
      has(planIds, expense.plan_id) ||
      has(eventIds, expense.event_id),
  );
  const expenseIds = expenses.map((expense) => expense.id);

  const paymentRequestLines = await fetchPaymentRequestLines(sb, expenseIds);
  const paymentRequestIds = unique(paymentRequestLines.map((line) => line.payment_request_id));
  const paymentRequests = await fetchPaymentRequests(sb, paymentRequestIds);
  const custodyMovements = await fetchCustodyMovements(sb, orgId, expenseIds, paymentRequestIds);
  const journalLines = await fetchJournalLines(sb, orgId, expenseIds, paymentRequestIds);
  const accountIds = unique(journalLines.map((line) => line.account_id));
  const accounts = await fetchAccounts(sb, accountIds);

  return {
    expenses,
    paymentRequestLines,
    paymentRequests,
    custodyMovements,
    journalLines,
    accounts,
  };
}

async function fetchPaymentRequestLines(
  sb: SupabaseServerClient,
  expenseIds: string[],
): Promise<LinkedPaymentRequestLine[]> {
  if (expenseIds.length === 0) return [];
  const { data, error } = await sb
    .from("payment_request_lines")
    .select(
      "id, payment_request_id, expense_id, paid_at, paid_by, paid_from_custody_account_id, custody_movement_id, journal_entry_id",
    )
    .in("expense_id", expenseIds);
  if (error) throw error;
  return (data ?? []) as LinkedPaymentRequestLine[];
}

async function fetchPaymentRequests(
  sb: SupabaseServerClient,
  requestIds: string[],
): Promise<LinkedPaymentRequest[]> {
  if (requestIds.length === 0) return [];
  const { data, error } = await sb
    .from("payment_requests")
    .select("id, request_no, status, period_start, period_end, custody_account_id, approved_net_request, created_at")
    .in("id", requestIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as LinkedPaymentRequest[];
}

async function fetchCustodyMovements(
  sb: SupabaseServerClient,
  orgId: string,
  expenseIds: string[],
  requestIds: string[],
): Promise<LinkedCustodyMovement[]> {
  const { data, error } = await sb
    .from("custody_movements")
    .select(
      "id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, expense_id, payment_request_id, journal_entry_id",
    )
    .eq("org_id", orgId)
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as LinkedCustodyMovement[]).filter(
    (movement) => has(expenseIds, movement.expense_id) || has(requestIds, movement.payment_request_id),
  );
}

async function fetchJournalLines(
  sb: SupabaseServerClient,
  orgId: string,
  expenseIds: string[],
  requestIds: string[],
): Promise<LinkedJournalLine[]> {
  const { data, error } = await sb
    .from("journal_lines")
    .select(
      "id, journal_entry_id, account_id, debit, credit, description, custody_account_id, custody_movement_id, expense_id, payment_request_id",
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as LinkedJournalLine[]).filter(
    (line) => has(expenseIds, line.expense_id) || has(requestIds, line.payment_request_id),
  );
}

async function fetchAccounts(
  sb: SupabaseServerClient,
  accountIds: string[],
): Promise<LinkedAccount[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await sb
    .from("accounts")
    .select("id, code, name_ar, account_type")
    .in("id", accountIds)
    .order("code");
  if (error) throw error;
  return (data ?? []) as LinkedAccount[];
}

function matchesScope(scopeType: string | null | undefined, scopeId: string | null | undefined, ids: EntityIds) {
  if (!scopeType) return false;
  if (scopeType === "farm") return scopeId == null || has(ids.farmIds, scopeId);
  if (scopeType === "sector") return has(ids.sectorIds, scopeId);
  if (scopeType === "hawsha") return has(ids.hawshaIds, scopeId);
  if (scopeType === "line") return has(ids.lineIds, scopeId);
  if (scopeType === "palm") return has(ids.palmIds, scopeId);
  return false;
}

function groupAssignees(assignees: LinkedAssignee[]) {
  const grouped = new Map<string, LinkedAssignee[]>();
  for (const assignee of assignees) {
    const current = grouped.get(assignee.plan_op_id) ?? [];
    current.push(assignee);
    grouped.set(assignee.plan_op_id, current);
  }
  return grouped;
}

function buildFinanceTotals(finance: {
  expenses: LinkedExpense[];
  custodyMovements: LinkedCustodyMovement[];
  journalLines: LinkedJournalLine[];
}) {
  const expenseTotal = finance.expenses.reduce((sum, expense) => sum + Number(expense.total ?? 0), 0);
  const unpaidTotal = finance.expenses
    .filter((expense) => expense.payment_status === "post_paid_unpaid")
    .reduce((sum, expense) => sum + Number(expense.total ?? 0), 0);
  const custodyOut = finance.custodyMovements.reduce((sum, movement) => sum + Number(movement.amount_out ?? 0), 0);
  const journalDebit = finance.journalLines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0);
  const journalCredit = finance.journalLines.reduce((sum, line) => sum + Number(line.credit ?? 0), 0);
  return { expenseTotal, unpaidTotal, custodyOut, journalDebit, journalCredit };
}

function unique(values: (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function has(values: string[] | Set<string>, value: string | null | undefined) {
  if (!value) return false;
  return Array.isArray(values) ? values.includes(value) : values.has(value);
}
