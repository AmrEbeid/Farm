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

export const POSTING_KIND_AR: Record<PostingKind, string> = {
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
        branchLabel: parent ? `${parent.code} — ${parent.name_ar}` : POSTING_KIND_AR[row.kind],
      };
    });
}
