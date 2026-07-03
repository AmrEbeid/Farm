import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SITE_CONTENT_DEFAULTS, type SiteContent } from "@/lib/site-content";
import { SiteEditor } from "@/components/site/SiteEditor";

/**
 * Owner-only editor for the public website's content («الموقع»). Loads the current content (or the
 * typed defaults if nothing saved yet) and hands it to the client editor, which persists the full
 * object via fn_save_site_content (owner-gated in the DB). Reads are RLS-scoped to org members; the
 * write gate is site.write = owner.
 *
 * TYPES: site_content regenerates into database.types.ext.ts after the Owner applies migration
 * 20260701420000 (A1); the select is cast until then, and falls back to defaults on any error.
 */
export default async function WebsiteEditorPage() {
  const m = await requireMembership();

  if (m.role !== "owner") {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <h1 className="mb-1 text-xl font-bold">الموقع</h1>
        <p className="text-sm text-muted-foreground">
          تعديل محتوى الموقع العام متاح لصلاحية المالك فقط.
        </p>
      </div>
    );
  }

  let content: SiteContent = SITE_CONTENT_DEFAULTS;
  try {
    const sb = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- site_content untyped until post-apply regen (A1)
    const { data } = await (sb.from("site_content" as any) as any)
      .select("content")
      .limit(1)
      .maybeSingle();
    if (data?.content && typeof data.content === "object") {
      content = { ...SITE_CONTENT_DEFAULTS, ...(data.content as Partial<SiteContent>) };
    }
  } catch {
    // fall back to defaults (table not applied yet, etc.)
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-1 text-xl font-bold">الموقع</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        عدّل محتوى الموقع العام (الصفحة الرئيسية). تُحفظ التغييرات مباشرة وتظهر على الموقع خلال دقائق.
      </p>
      <SiteEditor orgId={m.orgId} initial={content} />
    </div>
  );
}
