import { describe, expect, it } from "vitest";
import { accountOptionLabel, leafPostingAccounts, type AccountSourceRow } from "./account-options";

const baseAccount = {
  account_type: "expense",
  active: true,
} satisfies Pick<AccountSourceRow, "account_type" | "active">;

describe("account options", () => {
  it("returns active leaf posting accounts with parent branch labels", () => {
    const rows: AccountSourceRow[] = [
      {
        ...baseAccount,
        id: "parent",
        code: "5000",
        name_ar: "مصروفات",
        kind: null,
        parent_id: null,
      },
      {
        ...baseAccount,
        id: "child",
        code: "5100",
        name_ar: "تشغيل",
        kind: "operating",
        parent_id: "parent",
      },
      {
        ...baseAccount,
        id: "inactive",
        code: "5200",
        name_ar: "قديم",
        kind: "operating",
        parent_id: "parent",
        active: false,
      },
      {
        ...baseAccount,
        id: "non-posting",
        code: "5300",
        name_ar: "فرع",
        kind: null,
        parent_id: "parent",
      },
    ];

    expect(leafPostingAccounts(rows)).toEqual([
      {
        id: "child",
        code: "5100",
        nameAr: "تشغيل",
        kind: "operating",
        accountType: "expense",
        branchLabel: "5000 — مصروفات",
      },
    ]);
  });

  it("uses the posting-kind label when an account has no parent", () => {
    const [account] = leafPostingAccounts([
      {
        ...baseAccount,
        id: "drawing",
        code: "3100",
        name_ar: "مسحوبات",
        kind: "drawing",
        parent_id: null,
      },
    ]);

    expect(account?.branchLabel).toBe("مسحوبات المالك");
    expect(account ? accountOptionLabel(account) : "").toBe("3100 — مسحوبات");
  });
});
