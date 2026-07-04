"use client";

// SPEC-0024 A.5 — reusable account picker. Lists active LEAF expense accounts (the only valid posting
// targets), each labelled with its code + name. Used by the expense form and the custody flow so an
// expense is classified to a specific account before it can be routed to payment.

export interface PickableAccount {
  id: string;
  code: string;
  nameAr: string;
  kind: string | null;
}

const KIND_AR: Record<string, string> = {
  operating: "تشغيلي",
  drawing: "مسحوبات",
  capex: "رأسمالي",
};

export function AccountPicker({
  id,
  value,
  onChange,
  accounts,
  required,
}: {
  id: string;
  value: string;
  onChange: (accountId: string) => void;
  accounts: PickableAccount[];
  required?: boolean;
}) {
  return (
    <select
      id={id}
      className="w-full rounded-md px-3 py-2 text-sm"
      style={{ border: "1px solid var(--line, rgba(0,0,0,0.15))", background: "var(--surface, #fff)" }}
      value={value}
      required={required}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">— اختر حسابًا —</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.code} — {a.nameAr}
          {a.kind ? ` (${KIND_AR[a.kind] ?? a.kind})` : ""}
        </option>
      ))}
    </select>
  );
}

/** Compute the active LEAF expense accounts from a flat account list (a leaf has no active children). */
export function leafExpenseAccounts(
  rows: { id: string; code: string; name_ar: string; account_type: string; kind: string | null; parent_id: string | null; active: boolean }[],
): PickableAccount[] {
  const activeParentIds = new Set(rows.filter((r) => r.active && r.parent_id).map((r) => r.parent_id as string));
  return rows
    .filter((r) => r.active && r.account_type === "expense" && !activeParentIds.has(r.id))
    .map((r) => ({ id: r.id, code: r.code, nameAr: r.name_ar, kind: r.kind }));
}
