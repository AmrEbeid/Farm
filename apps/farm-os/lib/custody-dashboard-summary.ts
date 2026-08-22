import { parseDecimal, type DecimalString } from "./decimal";

export const CUSTODY_DASHBOARD_SUMMARY_VERSION = "farm-os.custody-dashboard.v1";

export interface CustodyDashboardAccount {
  id: string;
  holder_label: string;
  holder_user_id: string | null;
  target_float: DecimalString;
  active: boolean;
  balance: DecimalString;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`custody dashboard summary: field "${key}" must be text`);
  }
  return value;
}

function money(row: Record<string, unknown>, key: string): DecimalString {
  if (typeof row[key] !== "string") {
    throw new Error(`custody dashboard summary: field "${key}" must be decimal text`);
  }
  const decimal = parseDecimal(row[key]);
  if (decimal === null) throw new Error(`custody dashboard summary: field "${key}" is not decimal text`);
  return decimal;
}

export function parseCustodyDashboardSummary(value: unknown): CustodyDashboardAccount[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("custody dashboard summary: RPC returned no object payload");
  }
  const payload = value as Record<string, unknown>;
  if (payload.version !== CUSTODY_DASHBOARD_SUMMARY_VERSION) {
    throw new Error("custody dashboard summary: version is invalid");
  }
  if (!Array.isArray(payload.accounts)) {
    throw new Error('custody dashboard summary: field "accounts" must be an array');
  }

  const ids = new Set<string>();
  return payload.accounts.map((account) => {
    if (!account || typeof account !== "object" || Array.isArray(account)) {
      throw new Error("custody dashboard summary: account must be an object");
    }
    const row = account as Record<string, unknown>;
    const id = text(row, "id");
    if (ids.has(id)) throw new Error(`custody dashboard summary: duplicate account ${id}`);
    ids.add(id);
    if (row.holder_user_id !== null && typeof row.holder_user_id !== "string") {
      throw new Error('custody dashboard summary: field "holder_user_id" must be text or null');
    }
    if (typeof row.active !== "boolean") {
      throw new Error('custody dashboard summary: field "active" must be boolean');
    }
    return {
      id,
      holder_label: text(row, "holder_label"),
      holder_user_id: row.holder_user_id,
      target_float: money(row, "target_float"),
      active: row.active,
      balance: money(row, "closing_balance"),
    };
  });
}
