import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const PAGE_PATH = "app/(app)/approvals/page.tsx";

function readPage(): string {
  return readFileSync(join(process.cwd(), PAGE_PATH), "utf8");
}

function promiseAllArguments(source: string): string[][] {
  const file = ts.createSourceFile("approvals-page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
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

describe("approvals inbox database reads", () => {
  it("loads every independent inbox category in one fail-closed parallel wave", () => {
    const source = readPage();

    expect(promiseAllArguments(source)).toEqual([
      ["signoffsPromise", "purchaseRequestsPromise", "paymentsPromise"],
    ]);
    expect(source).not.toMatch(/await\s+sb\s*\./);
    expect(source.match(/\.eq\("org_id", m\.orgId\)/g)).toHaveLength(3);
    expect(source).toContain("if (signoffsRes.error) throw signoffsRes.error");
    expect(source).toContain("if (purchaseRequestsRes.error) throw purchaseRequestsRes.error");
    expect(source).toContain("if (paymentsRes.error) throw paymentsRes.error");
  });

  it("embeds material names while retaining dose, role, and separation-of-duties gates", () => {
    const source = readPage();

    expect(source).toContain(
      "plan_material_requirements(qty, unit, item_id, inventory_items(name))",
    );
    expect(source).toContain('.in("subtype", Array.from(DOSE_BEARING_SUBTYPES))');
    expect(source).toContain('.or("signed_off_at.is.null,signed_off_by.is.null")');
    expect(source).toContain('const canSignoff = role === "owner" || role === "agri_engineer"');
    expect(source).toContain('const canApprovePr = role === "owner"');
    expect(source).toContain("request.requested_by !== userId");
    expect(source).toContain("paymentRequestLifecyclePermissions(role, p.status)");
  });
});
