import type { Role } from "./auth";

export interface ApprovalFailurePr {
  status: string | null;
  version: number | null;
  requested_by: string | null;
}

export interface ApprovalFailureContext {
  expectedVersion: number;
  userId: string;
  role: Role;
}

export const APPROVE_PR_NOT_FOUND = "تعذّر الاعتماد: الطلب غير موجود أو لا يمكنك الوصول إليه.";
export const APPROVE_PR_WRONG_STATUS = "تعذّر الاعتماد: الطلب ليس في حالة انتظار الاعتماد.";
export const APPROVE_PR_STALE = "تم تعديل الطلب منذ فتح الصفحة. حدّث الصفحة ثم حاول مرة أخرى.";
export const APPROVE_PR_SELF = "لا يمكن لصاحب الطلب اعتماد طلبه.";
export const APPROVE_PR_NO_OWNER = "ليس لديك صلاحية المالك لاعتماد الطلب.";
export const APPROVE_PR_GENERIC = "تعذّر الاعتماد. راجع حالة الطلب والصلاحيات ثم حاول مرة أخرى.";

export function classifyApprovalFailure(
  pr: ApprovalFailurePr | null,
  ctx: ApprovalFailureContext,
): string {
  if (!pr) return APPROVE_PR_NOT_FOUND;
  if (pr.status !== "submitted") return APPROVE_PR_WRONG_STATUS;
  if (pr.version !== ctx.expectedVersion) return APPROVE_PR_STALE;
  if (pr.requested_by === ctx.userId) return APPROVE_PR_SELF;
  if (ctx.role !== "owner") return APPROVE_PR_NO_OWNER;
  return APPROVE_PR_GENERIC;
}
