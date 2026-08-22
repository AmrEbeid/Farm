import {
  compareDecimals,
  formatDecimalArabic,
  parseDecimal,
  type DecimalString,
} from "@/lib/decimal";

const OWNER_FUNDING = "استلام عهدة من المالك";

export type CustodyMovementCorrectionCandidate = {
  movement_type: string;
  amount_in: unknown;
  amount_out: unknown;
  journal_entry_id: string | null;
  expense_id: string | null;
  payment_request_id: string | null;
  transfer_group_id: string | null;
  reversal_of: string | null;
  reversed_by: string | null;
};

export function custodyMovementDisplayState(movement: CustodyMovementCorrectionCandidate): {
  amount: DecimalString;
  isIncoming: boolean;
  eligible: boolean;
} {
  const amountIn = parseDecimal(movement.amount_in);
  const amountOut = parseDecimal(movement.amount_out);
  if (amountIn == null || amountOut == null) {
    throw new Error("custody movement contains an unreadable amount");
  }
  const isIncoming = compareDecimals(amountIn, "0") > 0;
  return {
    amount: isIncoming ? amountIn : amountOut,
    isIncoming,
    eligible:
      movement.movement_type === OWNER_FUNDING &&
      isIncoming &&
      compareDecimals(amountOut, "0") === 0 &&
      movement.journal_entry_id != null &&
      movement.expense_id == null &&
      movement.payment_request_id == null &&
      movement.transfer_group_id == null &&
      movement.reversal_of == null &&
      movement.reversed_by == null,
  };
}

export function custodyMovementAmountEgp(amount: DecimalString): string {
  const fractionDigits = amount.includes(".") ? amount.length - amount.indexOf(".") - 1 : 0;
  return `${formatDecimalArabic(amount, Math.max(2, fractionDigits))} ج.م`;
}
