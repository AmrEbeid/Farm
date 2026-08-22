import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const PAGE_PATH = "app/(app)/expenses/[expenseId]/page.tsx";
const pageSource = readFileSync(join(process.cwd(), PAGE_PATH), "utf8");

function promiseAllArguments(): string[][] {
  const file = ts.createSourceFile("expense-detail.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches: string[][] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isAwaitExpression(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.expression.getText(file) === "Promise" &&
      node.expression.expression.name.text === "all" &&
      node.expression.arguments.length === 1 &&
      ts.isArrayLiteralExpression(node.expression.arguments[0])
    ) {
      matches.push(node.expression.arguments[0].elements.map((element) => element.getText(file)));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return matches;
}

describe("expense detail read pipeline", () => {
  it("loads the expense and linked core detail atomically, then correction options in one conditional wave", () => {
    expect(promiseAllArguments()).toEqual([
      [
        'sb.from("suppliers").select("id, name").eq("org_id", m.orgId).order("name")',
        'sb.from("accounts").select("id, code, name_ar, kind, parent_id, active").eq("org_id", m.orgId).order("code")',
        'sb.from("cost_centers").select("id, code, name_ar, parent_id, active").eq("org_id", m.orgId).order("code")',
        'sb.from("custody_accounts").select("id, holder_label, active").eq("org_id", m.orgId).order("holder_label")',
      ],
    ]);
    expect(pageSource).toContain('sb.rpc("fn_expense_detail_snapshot"');
    expect(pageSource).not.toContain('.from("farm_event")');
    expect(pageSource).not.toContain('.from("custody_movements")');
  });

  it("keeps payment evidence reads behind the owner/accountant role gate", () => {
    expect(pageSource).toContain('const canCorrectPayment = m.role === "owner" || m.role === "accountant"');
    expect(pageSource).toContain("const requestLinked = Boolean(activePayment?.payment_request_id || snapshot.requestLinked)");
  });

  it("scopes linked data to the active organization", () => {
    expect(pageSource).toContain("p_org: m.orgId");
    expect(pageSource).toContain("snapshot.orgId !== m.orgId");
  });

  it("fails closed on snapshot and conditional option-query errors", () => {
    expect(pageSource).toContain("if (snapshotRes.error) throw snapshotRes.error;");
    for (const response of ["correctionSuppliers", "correctionAccounts", "correctionCenters", "correctionCustody"]) {
      expect(pageSource).toContain(`if (${response}.error) throw ${response}.error;`);
    }
  });
});
