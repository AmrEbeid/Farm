import "server-only";
import { NextResponse } from "next/server";
import { getActiveMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import { canAccessMarketing } from "@/lib/marketing/queries";
import {
  MARKETING_SOURCE_MAX_HTML_BYTES,
  MARKETING_SOURCE_MAX_STATE_BYTES,
  REVIEWED_MARKETING_SOURCE_DIGEST,
  prepareMarketingSource,
} from "@/lib/marketing/source-import";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types.ext";

export const runtime = "nodejs";

type ImportMode = "preview" | "commit";
const MAX_MULTIPART_BYTES = MARKETING_SOURCE_MAX_HTML_BYTES + MARKETING_SOURCE_MAX_STATE_BYTES + 100_000;

function requestMode(request: Request): ImportMode | null {
  const mode = new URL(request.url).searchParams.get("mode");
  return mode === "preview" || mode === "commit" ? mode : null;
}

function uploadedFile(form: FormData, key: string): File | null {
  const value = form.get(key);
  return value instanceof File ? value : null;
}

export async function POST(request: Request): Promise<Response> {
  const membership = await getActiveMembership();
  if (!membership) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (!canAccessMarketing(membership.role)) {
    return NextResponse.json({ error: "لا تملك صلاحية الوصول إلى وحدة التسويق." }, { status: 403 });
  }

  const mode = requestMode(request);
  if (!mode) return NextResponse.json({ error: "وضع الاستيراد غير صالح." }, { status: 400 });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    return NextResponse.json({ error: "حجم طلب الاستيراد أكبر من الحد المسموح." }, { status: 413 });
  }

  const form = await request.formData();
  const htmlFile = uploadedFile(form, "html");
  const stateFile = uploadedFile(form, "state");
  if (!htmlFile || !stateFile) {
    return NextResponse.json({ error: "اختر ملف HTML وملف JSON معًا." }, { status: 400 });
  }
  if (htmlFile.size > MARKETING_SOURCE_MAX_HTML_BYTES || stateFile.size > MARKETING_SOURCE_MAX_STATE_BYTES) {
    return NextResponse.json({ error: "أحد الملفين أكبر من الحد المسموح." }, { status: 400 });
  }

  let prepared;
  try {
    prepared = prepareMarketingSource(await htmlFile.text(), await stateFile.text());
  } catch {
    return NextResponse.json(
      { error: "تعذّرت قراءة المصدر أو لا يطابق ملف تسويق 2026 الذي تمت مراجعته." },
      { status: 400 },
    );
  }
  if (prepared.digest !== REVIEWED_MARKETING_SOURCE_DIGEST) {
    return NextResponse.json(
      { error: "الملفان لا يطابقان النسخة التي تمت مراجعتها واعتمادها." },
      { status: 400 },
    );
  }

  if (mode === "preview") {
    return NextResponse.json({ digest: prepared.digest, summary: prepared.summary });
  }

  if (membership.role !== "owner") {
    return NextResponse.json({ error: "اعتماد أرشيف التسويق متاح لمالك المزرعة فقط." }, { status: 403 });
  }

  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_import_marketing_source", {
    p_org: membership.orgId,
    p_source_hash: prepared.digest,
    p_contacts: prepared.pack.contacts as unknown as Json,
    p_records: prepared.pack.records as unknown as Json,
    p_expected_contacts: prepared.pack.contacts.length,
    p_expected_records: prepared.pack.records.length,
    p_coverage: prepared.pack.coverage as unknown as Json,
  });
  if (error) return NextResponse.json({ error: toArabicError(error) }, { status: 400 });

  return NextResponse.json({ digest: prepared.digest, summary: prepared.summary, result: data });
}
