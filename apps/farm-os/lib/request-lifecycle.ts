type PaymentRequestRole = string;
type PaymentRequestStatus = string;

export interface PaymentRequestLifecyclePermissions {
  canSubmit: boolean;
  canApproveOperational: boolean;
  canApproveFinal: boolean;
}

export function paymentRequestLifecyclePermissions(
  role: PaymentRequestRole,
  status: PaymentRequestStatus,
): PaymentRequestLifecyclePermissions {
  const isFinanceRole = role === "owner" || role === "accountant";
  const isOwner = role === "owner";

  return {
    canSubmit: status === "draft" && isFinanceRole,
    canApproveOperational: status === "submitted" && isFinanceRole,
    canApproveFinal: status === "approved_operational" && isOwner,
  };
}
