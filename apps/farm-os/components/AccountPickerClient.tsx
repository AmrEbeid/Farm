"use client";

import {
  accountOptionLabel,
  POSTING_KIND_AR,
  type PickableAccount,
} from "@/lib/account-options";

// SPEC-0024 A.5 — reusable account picker for expense entry and custody/payment
// request classification. Posting targets are active leaf accounts with a posting
// kind; drawings and capex are not expense-type accounts in the COA, so filtering
// by account_type alone would wrongly hide them.

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
    const label = account.branchLabel || POSTING_KIND_AR[account.kind];
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
