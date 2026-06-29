/**
 * Bulk-import route (spec §4, §6). Two modes via the `mode` form field:
 *  - "dry-run": parse + validate the uploaded .xlsx, return per-row results, WRITE NOTHING.
 *  - "commit":  validate, then write each valid row through the descriptor's gated fn_* RPC.
 *
 * Uses the USER-SESSION server client (createClient), NOT the service-role admin client, so
 * each row honors the RPC's own role/RLS gate exactly as single-record entry does — service
 * role would bypass that gate. Authn is checked here; authz (role) is enforced in the DB RPC
 * (42501 → Arabic via toArabicError).
 *
 * SECURITY: this is the framework's write surface. Per the operating method, money/authoritative
 * imports require independent review + runtime verification before production use.
 */
import "server-only";
import { NextResponse } from "next/server";
import { getActiveMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toArabicError } from "@/lib/errors";
import { getDescriptor } from "@/lib/import/registry";
import { generateTemplate, parseUpload } from "@/lib/import/xlsx";
import { validateRows } from "@/lib/import/validate";
import { resolveRefs, type RefLookup } from "@/lib/import/resolve";
import { planCommit } from "@/lib/import/commit-plan";
import "@/lib/import/descriptors"; // side-effect: register all descriptors

export const runtime = "nodejs"; // exceljs needs the Node runtime

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB upload cap
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Download the fill-in template for `?descriptor=<key>`. */
export async function GET(req: Request): Promise<Response> {
  const member = await getActiveMembership();
  if (!member) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const descriptor = getDescriptor(new URL(req.url).searchParams.get("descriptor") ?? "");
  if (!descriptor) return NextResponse.json({ error: "نوع استيراد غير معروف" }, { status: 400 });

  const buf = await generateTemplate(descriptor);
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${descriptor.key}-template.xlsx"`,
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  const member = await getActiveMembership();
  if (!member) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const form = await req.formData();
  const mode = String(form.get("mode") ?? "dry-run");
  const descriptor = getDescriptor(String(form.get("descriptor") ?? ""));
  if (!descriptor) return NextResponse.json({ error: "نوع استيراد غير معروف" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "لم يتم رفع ملف" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "حجم الملف كبير جدًا" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());

  let rows: Record<string, unknown>[];
  try {
    rows = await parseUpload(buf, descriptor);
  } catch {
    return NextResponse.json({ error: "تعذّر قراءة الملف. تأكد أنه ملف Excel صالح." }, { status: 400 });
  }

  const dry = validateRows(descriptor, rows);

  // Resolve any ref columns (code → id) via RLS-scoped lookups. Read-only; runs in both modes.
  const sb = await createClient();
  const fromLoose = sb.from as unknown as (
    table: string,
  ) => {
    select: (cols: string) => {
      in: (col: string, vals: string[]) => Promise<{ data: Record<string, unknown>[] | null }>;
    };
  };
  const refLookup: RefLookup = async (spec, codes) => {
    const { data } = await fromLoose(spec.table)
      .select(`${spec.idColumn},${spec.codeColumn}`)
      .in(spec.codeColumn, codes);
    const map = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const r of data ?? []) {
      const code = String(r[spec.codeColumn]);
      if (map.has(code)) ambiguous.add(code);
      else map.set(code, String(r[spec.idColumn]));
    }
    for (const code of ambiguous) map.delete(code); // ambiguous code → treated as not found
    return map;
  };

  const resolved = await resolveRefs(descriptor, dry.okRows, refLookup);
  const errors = [...dry.errors, ...resolved.errors];
  const errorCount = dry.errorCount + (dry.okRows.length - resolved.rows.length);

  if (mode !== "commit") {
    return NextResponse.json({ okCount: resolved.rows.length, errorCount, errors });
  }

  // commit: write valid + resolved rows through the gated RPC, one per row (partial success).
  const plan = planCommit(descriptor, resolved.rows);
  const rpc = sb.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: { code?: string | null; message?: string } | null }>;

  const failures: { row: number; error: string }[] = [];
  let written = 0;
  for (const call of plan.calls) {
    const { error } = await rpc(call.rpc, call.args);
    if (error) failures.push({ row: call.sourceRow, error: toArabicError(error) });
    else written += 1;
  }

  return NextResponse.json({
    written,
    failed: failures.length,
    skipped: plan.skipped,
    validationErrors: errors,
    failures,
  });
}
