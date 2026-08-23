import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  custodyMovementAmountEgp,
  custodyMovementDisplayState,
  type CustodyMovementCorrectionCandidate,
} from "./custody-movement-detail";

const PAGE_PATH = "app/(app)/custody/movements/[movementId]/page.tsx";
const pageSource = readFileSync(join(process.cwd(), PAGE_PATH), "utf8");

describe("custody movement detail read pipeline", () => {
  it("loads the movement in one query and only adds one bounded counterpart query for a transfer", () => {
    expect(pageSource.match(/await\s+sb/g) ?? []).toHaveLength(2);
    expect(pageSource).toContain("custody_accounts!inner(holder_label)");
    expect(pageSource).toContain("amount_in::text, amount_out::text");
    expect(pageSource).not.toContain('.from("custody_accounts")');
    expect(pageSource).toContain('.eq("transfer_group_id", movement.transfer_group_id)');
    expect(pageSource).toContain('.neq("id", movement.id)');
    expect(pageSource).toContain(".limit(1)");
  });

  it("scopes both the movement and embedded account to the active organization", () => {
    expect(pageSource).toContain('.eq("org_id", member.orgId)');
    expect(pageSource).toContain('.eq("custody_accounts.org_id", member.orgId)');
    expect(pageSource).toContain("if (!movement) notFound()");
    expect(pageSource).toContain("if (!account) notFound()");
  });

  it("preserves owner/accountant access", () => {
    expect(pageSource).toContain('requireRole(["owner", "accountant"])');
    expect(pageSource).toContain("custodyMovementDisplayState(movement)");
  });

  it("exposes the already-loaded financial source links and correction reason", () => {
    expect(pageSource).toContain("`/expenses/${movement.expense_id}`");
    expect(pageSource).toContain("`/custody/request/${movement.payment_request_id}`");
    expect(pageSource).toContain("movement.journal_entry_id");
    expect(pageSource).toContain("movement.transfer_group_id");
    expect(pageSource).toContain("movement.reversal_reason");
    expect(pageSource).toContain("`/custody/movements/${transferCounterpart.id}`");
    expect(pageSource).toContain('href="/accounting"');
  });

  it("renders movement money through the fail-closed exact-decimal path", () => {
    expect(pageSource).toContain("description: custodyMovementAmountEgp(amount)");
    expect(pageSource).not.toMatch(/Number\(movement\.amount_(?:in|out)\)/);
    expect(custodyMovementDisplayState(candidate({ amount_in: "100.49" }))).toMatchObject({
      amount: "100.49",
      isIncoming: true,
      eligible: true,
    });
    expect(() => custodyMovementDisplayState(candidate({ amount_in: "not-money" }))).toThrow(
      "unreadable amount",
    );
    expect(custodyMovementAmountEgp("100.499")).toContain("١٠٠٫٤٩٩");
    expect(custodyMovementAmountEgp("100.499")).not.toContain("١٠٠٫٥٠");
  });

  it.each([
    ["wrong movement type", { movement_type: "صرف نقدي" }],
    ["no incoming amount", { amount_in: "0", amount_out: "100" }],
    ["nonzero outgoing amount", { amount_out: "0.01" }],
    ["missing journal", { journal_entry_id: null }],
    ["linked expense", { expense_id: "expense-id" }],
    ["linked request", { payment_request_id: "request-id" }],
    ["linked transfer", { transfer_group_id: "transfer-id" }],
    ["is a reversal", { reversal_of: "original-id" }],
    ["already reversed", { reversed_by: "reversal-id" }],
  ])("rejects correction eligibility for %s", (_label, override) => {
    expect(custodyMovementDisplayState(candidate(override)).eligible).toBe(false);
  });
});

function candidate(
  override: Partial<CustodyMovementCorrectionCandidate> = {},
): CustodyMovementCorrectionCandidate {
  return {
    movement_type: "استلام عهدة من المالك",
    amount_in: "100",
    amount_out: "0",
    journal_entry_id: "journal-id",
    expense_id: null,
    payment_request_id: null,
    transfer_group_id: null,
    reversal_of: null,
    reversed_by: null,
    ...override,
  };
}
