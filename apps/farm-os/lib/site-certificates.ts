import type { SiteCert, SiteContent } from "@/lib/site-content";

// Pure, server-side validation for the owner-editable certifications section.
//
// WHY IT IS SEPARATE AND PURE: the certificate cards are the site's trust surface — a buyer clicks
// `verifyUrl` and looks at `image`. The editor is a client component, so its per-field limits are a
// convenience, NOT a control: the save action receives whatever the client posts. This module is the
// control, runs in the server action BEFORE any storage cleanup or DB write, and is unit-testable.
//
// It intentionally does NOT sanitize/normalize — it accepts or rejects. Rendering still goes through
// SiteLanding's `safeHref`, so this is defence in depth, not a replacement for it.

/** Hard cap on cards. The section is a proof strip, not a document archive. */
export const MAX_CERTIFICATES = 12;

/** Max lengths (characters). Generous enough for the shipped defaults, bounded enough to stop a
 *  megabyte of text landing in the site_content JSON. Reused by the editor as `maxLength`. */
export const CERT_LIMITS = {
  heading: 120,
  intro: 900,
  title: 120,
  detail: 400,
  verifyLabel: 80,
  url: 500,
} as const;

export type CertValidation = { ok: true } | { ok: false; error: string };

const ok: CertValidation = { ok: true };
const fail = (error: string): CertValidation => ({ ok: false, error });

/** HTTPS only — parsed, not regex-matched, so `javascript:`/`data:`/`//host` can't slip through. */
export function isHttpsUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return false;
  }
  return u.protocol === "https:";
}

/**
 * A certificate image must be either a bundled site path (`/site/…`) or an HTTPS URL.
 * Rejects scheme-relative `//host`, traversal, backslashes, and every non-http scheme.
 */
export function isAllowedCertImage(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.includes("\\") || v.includes("..")) return false;
  if (v.startsWith("/site/")) return v.length > "/site/".length;
  return isHttpsUrl(v);
}

/** Non-empty after trimming and within `max` characters. */
function boundedText(value: unknown, max: number): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return v.length > 0 && v.length <= max;
}

/**
 * Validate the whole certifications section. Called by `saveSiteContent` BEFORE the storage
 * orphan-cleanup and the RPC write, so an invalid payload deletes nothing and saves nothing.
 * The four shipped defaults must pass unchanged.
 */
export function validateCertifications(
  section: SiteContent["certifications"] | null | undefined,
): CertValidation {
  if (!section || typeof section !== "object") return fail("قسم الشهادات مفقود");

  if (!boundedText(section.heading?.ar, CERT_LIMITS.heading))
    return fail("عنوان قسم الشهادات (عربي) مطلوب وبحد أقصى 120 حرفًا");
  if (!boundedText(section.heading?.en, CERT_LIMITS.heading))
    return fail("عنوان قسم الشهادات (إنجليزي) مطلوب وبحد أقصى 120 حرفًا");
  if (!boundedText(section.intro?.ar, CERT_LIMITS.intro))
    return fail("مقدمة قسم الشهادات (عربي) مطلوبة وبحد أقصى 900 حرف");
  if (!boundedText(section.intro?.en, CERT_LIMITS.intro))
    return fail("مقدمة قسم الشهادات (إنجليزي) مطلوبة وبحد أقصى 900 حرف");

  const items: SiteCert[] = Array.isArray(section.items) ? section.items : [];
  if (!Array.isArray(section.items)) return fail("قائمة الشهادات غير صالحة");
  if (items.length === 0) return fail("يجب الإبقاء على شهادة واحدة على الأقل");
  if (items.length > MAX_CERTIFICATES)
    return fail(`الحد الأقصى ${MAX_CERTIFICATES} شهادة`);

  for (let i = 0; i < items.length; i++) {
    const c = items[i];
    const n = i + 1;
    if (!c || typeof c !== "object") return fail(`الشهادة ${n}: بيانات غير صالحة`);
    if (!boundedText(c.title?.ar, CERT_LIMITS.title))
      return fail(`الشهادة ${n}: الاسم (عربي) مطلوب وبحد أقصى ${CERT_LIMITS.title} حرفًا`);
    if (!boundedText(c.title?.en, CERT_LIMITS.title))
      return fail(`الشهادة ${n}: الاسم (إنجليزي) مطلوب وبحد أقصى ${CERT_LIMITS.title} حرفًا`);
    if (!boundedText(c.detail?.ar, CERT_LIMITS.detail))
      return fail(`الشهادة ${n}: التفاصيل (عربي) مطلوبة وبحد أقصى ${CERT_LIMITS.detail} حرف`);
    if (!boundedText(c.detail?.en, CERT_LIMITS.detail))
      return fail(`الشهادة ${n}: التفاصيل (إنجليزي) مطلوبة وبحد أقصى ${CERT_LIMITS.detail} حرف`);
    if (!boundedText(c.image, CERT_LIMITS.url) || !isAllowedCertImage(c.image))
      return fail(`الشهادة ${n}: رابط الصورة يجب أن يبدأ بـ /site/ أو https://`);
    if (!boundedText(c.verifyUrl, CERT_LIMITS.url) || !isHttpsUrl(c.verifyUrl))
      return fail(`الشهادة ${n}: رابط التحقق يجب أن يبدأ بـ https://`);
    if (!boundedText(c.verifyLabel, CERT_LIMITS.verifyLabel))
      return fail(`الشهادة ${n}: اسم جهة التحقق مطلوب وبحد أقصى ${CERT_LIMITS.verifyLabel} حرفًا`);
    if (typeof c.verifyIsRegistry !== "boolean")
      return fail(`الشهادة ${n}: نوع رابط التحقق غير محدد`);
  }

  return ok;
}
