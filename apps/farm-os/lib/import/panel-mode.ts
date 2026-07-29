/**
 * Which controls the shared ImportPanel is allowed to render — decided in ONE pure function so the
 * validation-only surface is a data answer that can be unit-tested, not a scattering of `&&` in JSX.
 *
 * The panel is a CONVENIENCE, never the control. `app/api/import` refuses a commit for a
 * validation-only descriptor before it parses the request body at all — the descriptor and the mode
 * are query parameters precisely so that refusal can precede `req.formData()` (lib/import/access.ts)
 * — and `planCommit` throws if one ever reaches it. What this module buys is honesty: a surface that
 * cannot import must not show an import button, an archive warning, or a "تم استيراد N" line — a
 * user who saw any of those would reasonably believe the data had landed.
 */

// The template link and the «تحقّق» button are unconditional in BOTH modes — the template states its
// own no-write boundary, and a dry-run writes nothing either way — so neither gets a flag here. Only
// the three write-flavoured controls vary.
export interface ImportPanelControls {
  /** The «استيراد» commit button. */
  showCommit: boolean;
  /** The archive-by-omission warning + its confirmation checkbox. */
  showArchive: boolean;
  /** The post-commit result block ("تم استيراد N"). */
  showCommitResult: boolean;
  /** The privacy / no-write notice shown above the controls, or null. */
  notice: string | null;
}

export const IMPORT_PANEL_VALIDATION_ONLY_NOTICE_AR =
  "تحقّق فقط — لا يُكتب أي شيء. هذا القالب يفحص شكل البيانات ويعرض الأخطاء، ولا يحفظ أي صف في قاعدة البيانات ولو كان التحقق خاليًا من الأخطاء. استخدم بيانات تجريبية فقط: لا أسماء عاملين حقيقيين ولا أجور ولا ساعات عمل فعلية قبل اعتماد مراجعة الخصوصية (المرحلة M).";

const FULL: ImportPanelControls = {
  showCommit: true,
  showArchive: true,
  showCommitResult: true,
  notice: null,
};

const VALIDATION_ONLY: ImportPanelControls = {
  showCommit: false,
  showArchive: false,
  showCommitResult: false,
  notice: IMPORT_PANEL_VALIDATION_ONLY_NOTICE_AR,
};

/** `validationOnly` is read strictly: anything other than `true` keeps the full, unchanged panel. */
export function importPanelControls(validationOnly?: boolean): ImportPanelControls {
  return validationOnly === true ? VALIDATION_ONLY : FULL;
}
