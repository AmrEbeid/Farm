import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth";
import {
  ACTIONS,
  ACTION_GROUPS,
  groupVisibleActions,
  type ActionGroupId,
} from "@/lib/record-actions";

const GROUP_IDS = new Set<ActionGroupId>(ACTION_GROUPS.map((group) => group.id));

const EXPECTED: Record<string, { roles: Role[]; group: ActionGroupId }> = {
  "/record/expense?payment=custody": { roles: ["owner", "accountant"], group: "cash-out" },
  "/record/expense?payment=later": { roles: ["owner", "accountant"], group: "on-account" },
  "/record/scale": { roles: ["owner", "accountant"], group: "sales" },
  "/record/price": { roles: ["owner", "accountant"], group: "sales" },
  "/record/collect": { roles: ["owner", "accountant"], group: "cash-in" },
  "/m": {
    roles: ["owner", "farm_manager", "agri_engineer", "supervisor"],
    group: "operations",
  },
  "/record/activity": {
    roles: ["owner", "farm_manager", "agri_engineer", "supervisor"],
    group: "operations",
  },
  "/m/receive": { roles: ["owner", "farm_manager", "storekeeper"], group: "operations" },
  "/record/custody-in": { roles: ["owner", "accountant"], group: "cash-in" },
  "/record/plan": { roles: ["owner", "farm_manager"], group: "operations" },
  "/people/attendance": {
    roles: ["owner", "farm_manager", "supervisor"],
    group: "operations",
  },
};

describe("record-actions registry", () => {
  it("preserves the exact route set", () => {
    expect(ACTIONS.map((action) => action.href).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("preserves each action's role visibility and money-direction group", () => {
    for (const action of ACTIONS) {
      const expected = EXPECTED[action.href];
      expect(expected, `unexpected route ${action.href}`).toBeDefined();
      expect([...action.roles].sort()).toEqual([...expected.roles].sort());
      expect(action.group).toBe(expected.group);
    }
  });

  it("assigns every action to a declared group", () => {
    for (const action of ACTIONS) expect(GROUP_IDS.has(action.group)).toBe(true);
  });

  it("uses distinct expense cards for paid and unpaid expenses", () => {
    const paid = ACTIONS.find((action) => action.href === "/record/expense?payment=custody");
    const unpaid = ACTIONS.find((action) => action.href === "/record/expense?payment=later");
    expect(paid?.title).toBe("دفعت مصروفًا من العهدة");
    expect(unpaid?.title).toBe("سجّلت مصروفًا آجلًا");
  });

  it("orders groups by money direction", () => {
    expect(ACTION_GROUPS.map((group) => group.id)).toEqual([
      "cash-in",
      "cash-out",
      "on-account",
      "sales",
      "operations",
    ]);
  });
});

describe("groupVisibleActions", () => {
  it("owner sees all five groups and every action", () => {
    const groups = groupVisibleActions("owner");
    expect(groups.map((group) => group.id)).toEqual([
      "cash-in",
      "cash-out",
      "on-account",
      "sales",
      "operations",
    ]);
    expect(groups.reduce((count, group) => count + group.actions.length, 0)).toBe(ACTIONS.length);
  });

  it("accountant sees only the four money groups", () => {
    expect(groupVisibleActions("accountant").map((group) => group.id)).toEqual([
      "cash-in",
      "cash-out",
      "on-account",
      "sales",
    ]);
  });

  it("storekeeper sees only the receive-goods operation", () => {
    const groups = groupVisibleActions("storekeeper");
    expect(groups.map((group) => group.id)).toEqual(["operations"]);
    expect(groups[0].actions.map((action) => action.href)).toEqual(["/m/receive"]);
  });

  it("drops every empty group", () => {
    const roles: Role[] = [
      "owner",
      "accountant",
      "farm_manager",
      "agri_engineer",
      "supervisor",
      "storekeeper",
    ];
    for (const role of roles) {
      for (const group of groupVisibleActions(role)) expect(group.actions.length).toBeGreaterThan(0);
    }
  });

  it("preserves declared action order within a group", () => {
    const cashIn = groupVisibleActions("owner").find((group) => group.id === "cash-in");
    expect(cashIn?.actions.map((action) => action.href)).toEqual([
      "/record/collect",
      "/record/custody-in",
    ]);
  });
});

describe("record expense preset and loader contract", () => {
  const page = readFileSync(join(process.cwd(), "app/(app)/record/expense/page.tsx"), "utf8");
  const wizard = readFileSync(join(process.cwd(), "components/ExpenseWizard.tsx"), "utf8");
  const readonlySuite = readFileSync(
    join(process.cwd(), "e2e/accounting readonly.spec.ts"),
    "utf8",
  );

  it("accepts only the later preset and keeps direct visits on custody", () => {
    expect(page).toContain('const initialPayment = payment === "later" ? "later" : "custody"');
    expect(page).toContain("initialPayment={initialPayment}");
    expect(wizard).toContain('initialPayment = "custody"');
    expect(wizard).toContain("useState<GuidedPayment>(initialPayment)");
  });

  it("scopes all four picker reads to the active organization and fails closed", () => {
    expect(page.match(/\.eq\("org_id", membership\.orgId\)/g)).toHaveLength(4);
    expect(page).toContain("const loadError =");
    expect(page).toContain('if (loadError) throw new Error("تعذّر تحميل بيانات تسجيل المصروف")');
  });

  it("makes read-only role acceptance prove both expense presets", () => {
    const moneyEntryBlock = readonlySuite.match(
      /async function verifyMoneyEntryForms[\s\S]*?(?=\nasync function expectPdfDownload)/,
    )?.[0];
    const requestGuardBlock = readonlySuite.match(
      /async function installRequestGuard[\s\S]*?(?=\nasync function login)/,
    )?.[0];
    const loginBlock = readonlySuite.match(
      /async function login[\s\S]*?(?=\nasync function expectAuthenticatedIdentity)/,
    )?.[0];
    expect(moneyEntryBlock).toBeDefined();
    expect(requestGuardBlock).toBeDefined();
    expect(loginBlock).toBeDefined();
    expect(moneyEntryBlock).toContain(
      '["/record/expense?payment=custody", "سجّل مصروفًا", "custody"]',
    );
    expect(moneyEntryBlock).toContain(
      '["/record/expense?payment=later", "سجّل مصروفًا", "later"]',
    );
    expect(moneyEntryBlock).toContain(
      'page.locator("#w-pay")).toHaveValue(expectedPayment)',
    );
    const nextStatement =
      'await page.getByRole("button", { name: "التالي ←", exact: true }).click();';
    expect(moneyEntryBlock?.split(nextStatement)).toHaveLength(3);
    expect(moneyEntryBlock?.replaceAll(nextStatement, "")).not.toMatch(
      /\.(?:click|press)\s*\(|\b(?:submit|save)\b|احفظ/i,
    );
    expect(requestGuardBlock).toContain(
      "createAccountingE2ERequestPolicy(approvedOrigin, approvedAuthOrigin)",
    );
    expect(requestGuardBlock).toContain(
      "Blocked non-approved ${request.method()} request during accounting acceptance.",
    );
    expect(loginBlock).toContain("await installRequestGuard(page);");
  });
});
