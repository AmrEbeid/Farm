import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  custodyAmountEgp,
  isPositiveCustodyAmount,
  normalizeNonNegativeCustodyAmount,
  normalizePositiveCustodyAmount,
} from "./custody write money";

const formsSource = readFileSync(join(process.cwd(), "components/CustodyForms.tsx"), "utf8");
const wizardSource = readFileSync(join(process.cwd(), "components/CustodyInWizard.tsx"), "utf8");
const actionSource = readFileSync(join(process.cwd(), "app/(app)/custody/actions.ts"), "utf8");

describe("custody write money", () => {
  it("canonicalizes positive and non-negative input without floating point", () => {
    expect(normalizeNonNegativeCustodyAmount("000.000")).toBe("0");
    expect(normalizeNonNegativeCustodyAmount("-0.01")).toBeNull();
    expect(normalizePositiveCustodyAmount("9007199254740993.123456789012345678")).toBe(
      "9007199254740993.123456789012345678",
    );
    expect(normalizePositiveCustodyAmount("0")).toBeNull();
    expect(isPositiveCustodyAmount("0.000000000000000001")).toBe(true);
    expect(normalizePositiveCustodyAmount(0.1 + 0.2)).toBeNull();
    expect(normalizePositiveCustodyAmount(BigInt(1))).toBeNull();
    expect(normalizeNonNegativeCustodyAmount(0)).toBeNull();
  });

  it("renders every significant decimal digit", () => {
    expect(custodyAmountEgp("9007199254740993.123456789012345678")).toContain(
      "١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦٧٨",
    );
  });

  it("keeps all custody client write surfaces out of JavaScript Number", () => {
    expect(formsSource).not.toMatch(/targetFloat:\s*Number|amountIn:\s*Number|amount:\s*Number\(transferAmount\)/);
    expect(wizardSource).not.toContain("Number(amount)");
    expect(wizardSource).toContain("custodyAmountEgp(amountValue)");
  });

  it("normalizes every custody numeric input again at the server boundary", () => {
    const accountAction = actionSource.slice(
      actionSource.indexOf("export async function createCustodyAccount"),
      actionSource.indexOf("export async function recordCustodyMovement"),
    );
    const movementAction = actionSource.slice(
      actionSource.indexOf("export async function recordCustodyMovement"),
      actionSource.indexOf("export async function reverseCustodyMovement"),
    );
    const transferAction = actionSource.slice(
      actionSource.indexOf("export async function transferCustody"),
      actionSource.indexOf("export async function setExpensePaymentStatus"),
    );

    expect(accountAction).toContain("normalizeNonNegativeCustodyAmount(input.targetFloat)");
    expect(movementAction).toContain("normalizeNonNegativeCustodyAmount(input.amountIn)");
    expect(movementAction).toContain("normalizeNonNegativeCustodyAmount(input.amountOut)");
    expect(movementAction).toContain("isValidDateOnly(input.occurredAt)");
    expect(movementAction).toContain("p_occurred_at: input.occurredAt");
    expect(formsSource).toContain("occurredAt: movementDate");
    expect(wizardSource).toContain("occurredAt,");
    expect(transferAction).toContain("normalizePositiveCustodyAmount(input.amount)");
    expect(`${accountAction}${movementAction}${transferAction}`).not.toContain("Number(");
  });
});
