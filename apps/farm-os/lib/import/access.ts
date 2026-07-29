/**
 * The import framework's ACCESS GATES — pure, so the rule and the message are testable without a
 * request, and so the route can apply them at the one place where they are still cheap: immediately
 * after the membership and the descriptor are known, and before anything reads data or parses bytes.
 *
 * WHY THE ROUTING METADATA IS PRE-BODY. Both gates need to know WHICH descriptor and WHICH mode the
 * request is for. If that answer lived in the multipart body, answering it would mean calling
 * `req.formData()` first — which parses the whole upload into memory. The gates would then be
 * running AFTER the very work they exist to prevent. So `descriptor` and `mode` travel in the QUERY
 * STRING (`importRequestFromQuery`), which is readable from the request line while the body is still
 * an unread stream. The body is never a routing input; `importBodyDisagreement` enforces that a
 * client which also states them there cannot disagree with what was already gated on.
 *
 * TWO INDEPENDENT GATES, BOTH SERVER-SIDE.
 *
 *   1. ROLE (`descriptorRoleDenial`). A descriptor may declare `allowedRoles`. GET (template) and
 *      POST (dry-run and commit alike) both refuse a caller outside that set BEFORE the template's
 *      existing-rows query runs and BEFORE the uploaded file is read. A descriptor without
 *      `allowedRoles` is unchanged: the DB RPC's own gate stays the boundary, exactly as today.
 *
 *   2. NO COMMIT PATH (`commitDenial`). A validation-only descriptor has no RPC, no argument mapper
 *      and no table, so a `commit` POST for one is refused outright — before `req.formData()`, before
 *      `file.arrayBuffer()`, before `parseUpload`, before any ref lookup and before `planCommit`. The
 *      panel also hides the commit control, but hiding a button is not a control; this is.
 *
 * The messages are FIXED Arabic constants. They never echo a role, a descriptor internal, a
 * submitted mode or a DB string — a refusal must not become a probe that describes the surface it
 * just refused.
 */
import type { Role } from "@/lib/auth";
import { isValidationOnly, type ImportDescriptor } from "./types";

/** Returned instead of throwing so the route can answer with the exact status the gate implies. */
export interface ImportDenial {
  error: string;
  status: 403;
}

/**
 * A malformed request, refused before it is allowed to mean anything — 400, not 403: the caller may
 * well be entitled to import, they just did not say what they were importing.
 */
export interface ImportRequestDenial {
  error: string;
  status: 400;
}

/**
 * The only two POST modes, spelled exactly. There is deliberately no default and no coercion: a mode
 * the route does not recognise is a malformed request, not a dry-run. Silently treating an unknown
 * mode as a dry-run would be safe today only because dry-run happens to be the harmless one — that
 * is an accident of naming, not a control, and it would invert the day a third mode is added.
 */
export const IMPORT_MODES = ["dry-run", "commit"] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

function isImportMode(value: string): value is ImportMode {
  return (IMPORT_MODES as readonly string[]).includes(value);
}

/** The registry lookup, injected so the resolution below stays pure and testable with fixtures. */
export type DescriptorLookup = (key: string) => ImportDescriptor | undefined;

export const IMPORT_DESCRIPTOR_UNKNOWN_AR = "نوع استيراد غير معروف";

export const IMPORT_MODE_INVALID_AR = "طلب استيراد غير صالح: وضع الاستيراد مفقود أو غير معروف.";

export const IMPORT_BODY_MISMATCH_AR =
  "طلب استيراد غير متسق: محتوى الطلب لا يطابق نوع الاستيراد ووضعه المحددين في عنوانه.";

export const IMPORT_ROLE_DENIED_AR =
  "هذا النوع من الاستيراد متاح لأدوار محددة فقط، ودورك الحالي ليس منها.";

export const IMPORT_COMMIT_FORBIDDEN_AR =
  "هذا القالب للتحقق فقط ولا يوجد له مسار استيراد: النظام لا يكتب أي صف منه في قاعدة البيانات، حتى بعد تحقّق خالٍ من الأخطاء.";

/**
 * The instruction lines a validation-only template carries, in order: the no-write boundary, then
 * the Stage-M privacy boundary. Stated in the FILE, because the workbook outlives the page it was
 * downloaded from and is often filled in days later.
 */
export const VALIDATION_ONLY_TEMPLATE_NOTES_AR: readonly string[] = [
  "هذا القالب للتحقق فقط: لا يُنشئ ولا يُعدّل أي بيانات في قاعدة البيانات، ولا يوجد زر استيراد له.",
  "استخدم بيانات تجريبية فقط. لا تُدخل أسماء عاملين حقيقيين ولا أجورًا ولا ساعات عمل فعلية قبل اعتماد مراجعة الخصوصية (المرحلة M).",
];

/** A POST's routing metadata once resolved, or the refusal that stops the request reading a body. */
export type ImportRequestResolution =
  | { descriptor: ImportDescriptor; mode: ImportMode }
  | ImportRequestDenial;

/**
 * Resolve a POST's descriptor and mode from the QUERY STRING alone — everything the two gates need,
 * obtained without touching the request body. Fails closed: an absent, unknown or misspelled value
 * is a 400, never a guess.
 */
export function importRequestFromQuery(
  params: URLSearchParams,
  lookup: DescriptorLookup,
): ImportRequestResolution {
  const descriptor = lookup(params.get("descriptor") ?? "");
  if (!descriptor) return { error: IMPORT_DESCRIPTOR_UNKNOWN_AR, status: 400 };

  // Absent and malformed collapse into the same branch on purpose — neither is a mode.
  const mode = params.get("mode") ?? "";
  if (!isImportMode(mode)) return { error: IMPORT_MODE_INVALID_AR, status: 400 };

  return { descriptor, mode };
}

/**
 * Refuse a request whose body contradicts the metadata the gates already ran on. The body is never
 * consulted to DECIDE anything — by the time this runs, the descriptor and the mode are settled — so
 * a disagreement can only mean a confused or forged client, and the request is dropped rather than
 * silently resolved in favour of one of the two answers. Absent body fields are the normal case
 * (the panel sends neither) and are fine.
 */
export function importBodyDisagreement(
  body: { descriptor: string | null; mode: string | null },
  resolved: { descriptorKey: string; mode: ImportMode },
): ImportRequestDenial | null {
  const disagrees =
    (body.descriptor !== null && body.descriptor !== resolved.descriptorKey) ||
    (body.mode !== null && body.mode !== resolved.mode);
  return disagrees ? { error: IMPORT_BODY_MISMATCH_AR, status: 400 } : null;
}

/**
 * Deny when the descriptor declares `allowedRoles` and the caller's role is not in it.
 * Null = allowed (which is also the answer for every descriptor that declares nothing).
 */
export function descriptorRoleDenial(
  descriptor: ImportDescriptor,
  role: Role,
): ImportDenial | null {
  const allowed = descriptor.allowedRoles;
  if (!allowed || allowed.includes(role)) return null;
  return { error: IMPORT_ROLE_DENIED_AR, status: 403 };
}

/**
 * Deny a `commit` POST against a descriptor with no commit path. `mode` is the ALREADY-VALIDATED
 * mode from `importRequestFromQuery`, not a raw request value: the type makes it impossible to reach
 * this gate with a string the route never recognised, so "not commit" here means a real dry-run
 * rather than an unparsed input that merely failed to spell `commit`.
 */
export function commitDenial(descriptor: ImportDescriptor, mode: ImportMode): ImportDenial | null {
  if (mode !== "commit") return null;
  if (!isValidationOnly(descriptor)) return null;
  return { error: IMPORT_COMMIT_FORBIDDEN_AR, status: 403 };
}
