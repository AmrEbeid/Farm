export interface AccountTreeRow {
  id: string;
  org_id?: string | null;
  code: string;
  parent_id?: string | null;
}

export interface AccountNetRow {
  account_id: string;
  net?: number | string | null;
}

export function subtreeNetByCode(
  accounts: AccountTreeRow[],
  trialBalance: AccountNetRow[],
  code: string,
  orgId?: string | null,
): number {
  const scopedAccounts = orgId ? accounts.filter((account) => account.org_id === orgId) : accounts;
  const root = scopedAccounts.find((account) => account.code === code);
  if (!root) return 0;

  const childrenByParent = new Map<string, string[]>();
  for (const account of scopedAccounts) {
    if (!account.parent_id) continue;
    const siblings = childrenByParent.get(account.parent_id) ?? [];
    siblings.push(account.id);
    childrenByParent.set(account.parent_id, siblings);
  }

  const netByAccountId = new Map(trialBalance.map((row) => [row.account_id, Number(row.net ?? 0)]));
  let sum = 0;
  const stack = [root.id];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    sum += netByAccountId.get(id) ?? 0;
    for (const child of childrenByParent.get(id) ?? []) stack.push(child);
  }
  return sum;
}
