"use client";

// SPEC-0024 A.5 — reusable account picker for expense entry and custody/payment
// request classification. Posting targets are active leaf accounts with a posting
// kind; drawings and capex are not expense-type accounts in the COA, so filtering
// by account_type alone would wrongly hide them.

export type PostingKind = "operating" | "drawing" | "capex";

export interface PickableAccount {
  id: string;
  code: string;
  nameAr: string;
  kind: PostingKind;
  accountType: string;
  branchLabel: string;
}

export interface AccountSourceRow {
  id: string;
  code: string;
  name_ar: string;
  account_type: string;
  kind: string | null;
  parent_id: string | null;
  active: boolean;
}

const KIND_AR: Record<PostingKind, string> = {
  operating: "تشغيلي",
  drawing: "مسحوبات المالك",
  capex: "رأسمالي",
};

const POSTING_KINDS = new Set<string>(["operating", "drawing", "capex"]);

function isPostingKind(kind: string | null): kind is PostingKind {
  return kind != null && POSTING_KINDS.has(kind);
}

export function accountOptionLabel(account: PickableAccount): string {
  return `${account.code} — ${account.nameAr}`;
}

export function AccountPicker({
  id,
  value,
  onChange,
  accounts,
  required,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (accountId: string) => void;
  accounts: PickableAccount[];
  required?: boolean;
  disabled?: boolean;
}) {
  const groups = new Map<string, PickableAccount[]>();
  for (const account of accounts) {
    const label = account.branchLabel || KIND_AR[account.kind];
    groups.set(label, [...(groups.get(label) ?? []), account]);
  }

  return (
    <select
      id={id}
      className="w-full rounded-md px-3 py-2 text-sm"
      style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
      value={value}
      required={required}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">— اختر الحساب —</option>
      {[...groups.entries()].map(([label, rows]) => (
        <optgroup key={label} label={label}>
          {rows.map((account) => (
            <option key={account.id} value={account.id}>
              {accountOptionLabel(account)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Compute the active leaf posting accounts from a flat account list. */
export function leafPostingAccounts(rows: AccountSourceRow[]): PickableAccount[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const activeParentIds = new Set(
    rows.flatMap((row) => (row.active && row.parent_id ? [row.parent_id] : [])),
  );

  return rows
    .filter(
      (row): row is AccountSourceRow & { kind: PostingKind } =>
        row.active && isPostingKind(row.kind) && !activeParentIds.has(row.id),
    )
    .map((row) => {
      const parent = row.parent_id ? byId.get(row.parent_id) : null;
      return {
        id: row.id,
        code: row.code,
        nameAr: row.name_ar,
        kind: row.kind,
        accountType: row.account_type,
        branchLabel: parent ? `${parent.code} — ${parent.name_ar}` : KIND_AR[row.kind],
      };
    });
}
