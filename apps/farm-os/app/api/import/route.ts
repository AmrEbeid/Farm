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
import { resolveRefs, reverseResolveRefs, type RefLookup, type ReverseRefLookup } from "@/lib/import/resolve";
import { seenKeysOf, computeMatchPlan, matchKeyOf, type ExistingRow } from "@/lib/import/match";
import { planCommit } from "@/lib/import/commit-plan";
import { getSourceRow, type ImportDescriptor } from "@/lib/import/types";
import "@/lib/import/descriptors"; // side-effect: register all descriptors

export const runtime = "nodejs"; // exceljs needs the Node runtime

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB upload cap
// xlsx is zip-compressed, so the byte cap alone can't bound row count — a small file can expand to
// hundreds of thousands of rows (memory/timeout + unbounded sequential RPCs). Cap parsed rows too;
// the templates only provision dropdowns for 1000 rows (lib/import/xlsx.ts).
const MAX_ROWS = 1000;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Fetch a descriptor's current active rows (RLS-scoped to the caller's active org), mapped
 * through `fromRow` + `reverseResolveRefs` (ref columns shown as their human code, matching
 * what a re-upload would contain). Returns both the display row (for template prefill / the
 * archive-confirmation label) and its id (for reconcile-upsert matching). A descriptor that
 * hasn't opted into `table`/`fromRow` (SPEC-0020) is a no-op — today's blank-template,
 * insert-only behavior.
 */
async function fetchExistingRows(
  descriptor: ImportDescriptor,
  sb: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<{ id: string; row: Record<string, unknown> }[]> {
  if (!descriptor.table || !descriptor.fromRow) return [];
  const fromRow = descriptor.fromRow;

  // sb is generated against the Database types, which don't know about a descriptor's dynamic
  // table name — loosely typed the same way the ref lookups below already are.
  type LooseQuery = Promise<{ data: Record<string, unknown>[] | null; error: unknown }> & {
    eq: (col: string, val: unknown) => LooseQuery;
    in: (col: string, vals: string[]) => LooseQuery;
  };
  const fromLoose = sb.from as unknown as (table: string) => { select: (cols: string) => LooseQuery };

  const { data, error } = await fromLoose(descriptor.table).select("*").eq("org_id", orgId).eq("archived", false);
  if (error) throw error;

  const mapped = (data ?? []).map((r) => ({ id: String(r.id), row: fromRow(r) }));

  const reverseLookup: ReverseRefLookup = async (spec, ids) => {
    // Same active-org narrowing rationale as the forward refLookup in POST: constrain to the
    // caller's ACTIVE org so a multi-org user's ref never resolves against another of their orgs.
    const { data: refData, error: refError } = await fromLoose(spec.table)
      .select(`${spec.idColumn},${spec.codeColumn}`)
      .in(spec.idColumn, ids)
      .eq("org_id", orgId);
    if (refError) throw refError;
    const map = new Map<string, string>();
    for (const r of refData ?? []) map.set(String(r[spec.idColumn]), String(r[spec.codeColumn]));
    return map;
  };

  const displayRows = await reverseResolveRefs(descriptor, mapped.map((m) => m.row), reverseLookup);
  return mapped.map((m, i) => ({ id: m.id, row: displayRows[i] }));
}

/** Download the fill-in template for `?descriptor=<key>`, pre-filled with the org's existing
 * active rows (reconcile-upsert, SPEC-0020) when the descriptor opts in. */
export async function GET(req: Request): Promise<Response> {
  const member = await getActiveMembership();
  if (!member) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  const descriptor = getDescriptor(new URL(req.url).searchParams.get("descriptor") ?? "");
  if (!descriptor) return NextResponse.json({ error: "نوع استيراد غير معروف" }, { status: 400 });

  const sb = await createClient();
  let existing: { id: string; row: Record<string, unknown> }[];
  try {
    existing = await fetchExistingRows(descriptor, sb, member.orgId);
  } catch {
    return NextResponse.json({ error: "تعذّر تحميل البيانات الحالية. حاول مرة أخرى." }, { status: 500 });
  }

  const buf = await generateTemplate(descriptor, existing.map((e) => e.row));
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
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `الحد الأقصى ${MAX_ROWS} صف في الاستيراد الواحد. قسّم الملف.` },
      { status: 400 },
    );
  }

  const dry = validateRows(descriptor, rows);

  // Resolve any ref columns (code → id) via RLS-scoped lookups. Read-only; runs in both modes.
  const sb = await createClient();
  const fromLoose = sb.from as unknown as (
    table: string,
  ) => {
    select: (cols: string) => {
      in: (col: string, vals: string[]) => RefQuery;
    };
  };
  type RefQuery = Promise<{ data: Record<string, unknown>[] | null; error: unknown }> & {
    eq: (col: string, val: unknown) => RefQuery;
  };
  const refLookup: RefLookup = async (spec, codes) => {
    // Constrain resolution to the ACTIVE org. RLS narrows to all of the user's orgs, so without this a
    // multi-org user's ref (e.g. a farm code that exists only in another of their orgs) would resolve
    // there and the row would be written into the WRONG tenant. All import ref tables carry org_id.
    let query = fromLoose(spec.table)
      .select(`${spec.idColumn},${spec.codeColumn}`)
      .in(spec.codeColumn, codes)
      .eq("org_id", member.orgId);
    if (spec.activeColumn != null) {
      query = query.eq(spec.activeColumn, spec.activeValue ?? false);
    }
    const { data, error } = await query;
    // A DB error here must not be swallowed into an empty result — that would
    // silently downgrade real failures to "code not found" and skip valid rows.
    // Surface it so the route's try/catch returns a 500 instead of a misleading
    // partial import.
    if (error) throw error;
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

  let resolved;
  try {
    resolved = await resolveRefs(descriptor, dry.okRows, refLookup);
  } catch {
    // A ref lookup hit a real DB error (now surfaced from refLookup, not swallowed
    // into an empty result). Fail the request rather than reporting valid rows as
    // "code not found" and silently dropping them.
    return NextResponse.json(
      { error: "تعذّر التحقق من المراجع. حاول مرة أخرى." },
      { status: 500 },
    );
  }
  const errors = [...dry.errors, ...resolved.errors];
  const errorCount = dry.errorCount + (dry.okRows.length - resolved.rows.length);

  // Reconcile-upsert matching (SPEC-0020): match uploaded rows to the org's existing active rows
  // by matchKey, so a commit updates what changed, inserts what's new, and flags what's missing
  // from the file (archive candidates). No-op (empty existing/matchPlan) for a descriptor that
  // hasn't opted into table/matchKey — preserves today's insert-only behavior.
  let existing: { id: string; row: Record<string, unknown> }[];
  try {
    existing = await fetchExistingRows(descriptor, sb, member.orgId);
  } catch {
    return NextResponse.json(
      { error: "تعذّر التحقق من السجلات الحالية. حاول مرة أخرى." },
      { status: 500 },
    );
  }
  const existingForMatch: ExistingRow[] = existing.map((e) => ({
    id: e.id,
    key: matchKeyOf(descriptor, e.row),
    label: (descriptor.matchKey ?? []).map((k) => String(e.row[k] ?? "")).join(" "),
  }));
  const seenKeys = seenKeysOf(descriptor, rows); // raw parseUpload() output, pre-validation

  // Match against dry.okRows (pre-ref-resolution), NOT resolved.rows: a matchKey column that is
  // also a `ref` column (e.g. lines' hawshaId) still holds its human CODE at this point, matching
  // existingForMatch's key (built from fromRow + reverseResolveRefs, also code-form). resolved.rows
  // would hold the resolved id there instead, which would never equal the existing row's code-based
  // key — silently turning every reconcile-update into a duplicate-insert attempt.
  const matchPlan = computeMatchPlan(descriptor, seenKeys, dry.okRows, existingForMatch);

  // A matchedId may key a source row that resolveRefs later dropped (an unrelated ref column on the
  // SAME row failed to resolve) — that row never reaches resolved.rows/commit, so exclude it from the
  // insert/update counts shown before commit.
  const resolvedSourceRows = new Set(resolved.rows.map((r, i) => getSourceRow(r, i + 1)));
  const matchedCount = [...matchPlan.matchedIds.keys()].filter((rn) => resolvedSourceRows.has(rn)).length;
  const toInsert = resolved.rows.length - matchedCount;

  if (mode !== "commit") {
    return NextResponse.json({
      okCount: resolved.rows.length,
      errorCount,
      errors,
      toInsert,
      toUpdate: matchedCount,
      toArchive: matchPlan.toArchive,
    });
  }

  // Archiving existing rows omitted from the file is destructive — require an explicit,
  // server-checked confirmation before any archive RPC runs (never inferred from the client alone).
  if (matchPlan.toArchive.length > 0 && String(form.get("confirmArchive") ?? "") !== "true") {
    return NextResponse.json(
      { error: "يوجد صفوف سيتم أرشفتها — يلزم تأكيد صريح.", toArchive: matchPlan.toArchive },
      { status: 409 },
    );
  }

  // commit: write valid + resolved rows through the gated RPC, one per row (partial success).
  const plan = planCommit(descriptor, resolved.rows, { matchedIds: matchPlan.matchedIds });
  const rpc = sb.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: { code?: string | null; message?: string } | null }>;

  const failures: { row: number; error: string }[] = [];
  let written = 0;
  for (const call of plan.calls) {
    // A THROW (network drop / abort / 5xx) must not lose the partial-write report: catch per row so the
    // response always tells the user which rows landed (else they can't tell what to retry → duplicates).
    try {
      const { error } = await rpc(call.rpc, call.args);
      if (error) failures.push({ row: call.sourceRow, error: toArabicError(error) });
      else written += 1;
    } catch {
      // A thrown call (network drop / abort / 5xx) is not a mapped DB error — report it generically so
      // the row is still accounted for in the response instead of aborting the whole commit.
      failures.push({ row: call.sourceRow, error: "تعذّر تنفيذ الاستيراد لهذا الصف. حاول مرة أخرى." });
    }
  }

  // Archive-by-omission: rows present in the DB but absent from the file, through the same gated
  // fn_archive_structure the single-record "remove" action uses (role/org checked in the DB).
  const archived: string[] = [];
  const archiveFailures: { label: string; error: string }[] = [];
  if (descriptor.archiveType) {
    for (const a of matchPlan.toArchive) {
      // Same per-row try/catch safety as the insert/update loop above: a thrown archive call must
      // not lose the "which rows archived" report.
      try {
        const { error } = await rpc("fn_archive_structure", {
          p_type: descriptor.archiveType,
          p_id: a.id,
          p_archived: true,
        });
        if (error) archiveFailures.push({ label: a.label, error: toArabicError(error) });
        else archived.push(a.label);
      } catch {
        archiveFailures.push({ label: a.label, error: "تعذّر تنفيذ الأرشفة لهذا الصف. حاول مرة أخرى." });
      }
    }
  }

  return NextResponse.json({
    written,
    failed: failures.length,
    skipped: plan.skipped,
    archived,
    archiveFailures,
    validationErrors: errors,
    failures,
  });
}
