import { describe, expect, it } from "vitest";
import {
  APPROVE_PR_NO_OWNER,
  APPROVE_PR_NOT_FOUND,
  APPROVE_PR_SELF,
  APPROVE_PR_STALE,
  APPROVE_PR_WRONG_STATUS,
  classifyApprovalFailure,
} from "./pr-approval-errors";

const ctx = {
  expectedVersion: 3,
  userId: "user-1",
  role: "owner" as const,
};

describe("classifyApprovalFailure", () => {
  it("distinguishes missing or unreadable requests", () => {
    expect(classifyApprovalFailure(null, ctx)).toBe(APPROVE_PR_NOT_FOUND);
  });

  it("reports wrong status before permission hints", () => {
    expect(
      classifyApprovalFailure(
        { status: "approved", version: 3, requested_by: "user-2" },
        { ...ctx, role: "accountant" },
      ),
    ).toBe(APPROVE_PR_WRONG_STATUS);
  });

  it("reports stale optimistic-lock versions", () => {
    expect(
      classifyApprovalFailure({ status: "submitted", version: 4, requested_by: "user-2" }, ctx),
    ).toBe(APPROVE_PR_STALE);
  });

  it("reports self-approval distinctly from missing owner permission", () => {
    expect(
      classifyApprovalFailure({ status: "submitted", version: 3, requested_by: "user-1" }, ctx),
    ).toBe(APPROVE_PR_SELF);
  });

  it("reports a non-owner approval attempt when the row is otherwise current", () => {
    expect(
      classifyApprovalFailure(
        { status: "submitted", version: 3, requested_by: "user-2" },
        { ...ctx, role: "farm_manager" },
      ),
    ).toBe(APPROVE_PR_NO_OWNER);
  });
});
