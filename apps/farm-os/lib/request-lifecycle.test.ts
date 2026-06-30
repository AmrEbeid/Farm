import { describe, expect, it } from "vitest";
import { paymentRequestLifecyclePermissions } from "./request-lifecycle";

describe("paymentRequestLifecyclePermissions", () => {
  it("allows owner and accountant to submit draft requests", () => {
    expect(paymentRequestLifecyclePermissions("owner", "draft").canSubmit).toBe(true);
    expect(paymentRequestLifecyclePermissions("accountant", "draft").canSubmit).toBe(true);
    expect(paymentRequestLifecyclePermissions("farm_manager", "draft").canSubmit).toBe(false);
  });

  it("allows owner and accountant to approve submitted requests operationally", () => {
    expect(paymentRequestLifecyclePermissions("owner", "submitted").canApproveOperational).toBe(true);
    expect(paymentRequestLifecyclePermissions("accountant", "submitted").canApproveOperational).toBe(true);
    expect(paymentRequestLifecyclePermissions("farm_manager", "submitted").canApproveOperational).toBe(false);
  });

  it("keeps final approval owner-only", () => {
    expect(paymentRequestLifecyclePermissions("owner", "approved_operational").canApproveFinal).toBe(true);
    expect(paymentRequestLifecyclePermissions("accountant", "approved_operational").canApproveFinal).toBe(false);
  });

  it("does not allow lifecycle actions in unrelated statuses", () => {
    expect(paymentRequestLifecyclePermissions("owner", "paid")).toEqual({
      canSubmit: false,
      canApproveOperational: false,
      canApproveFinal: false,
    });
  });
});
