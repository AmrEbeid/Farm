"use client";

/**
 * Shared bulk-import UI (spec §4). Mount on any feature route with its descriptor key:
 *   <ImportPanel descriptorKey="sectors" titleAr="القطاعات" />
 * Flow: download template → pick file → "تحقّق" (dry-run, writes nothing) → fix errors →
 * "استيراد" (commit). Commit stays disabled until a clean dry-run (error-resolution-first).
 *
 * VALIDATION-ONLY MODE (`validationOnly`). For a descriptor that has no commit path at all
 * (SPEC-0006 payroll readiness), the panel offers the template and «تحقّق» and NOTHING else: no
 * commit button, no archive warning, no "تم استيراد N" line — a user who saw any of those would
 * reasonably conclude the data had landed. Which controls exist is decided once, in the pure
 * `importPanelControls`, so the rule is testable rather than scattered through the JSX.
 *
 * THE PANEL IS NOT THE CONTROL. `app/api/import` refuses a commit for such a descriptor before it
 * parses the upload at all, and `planCommit` throws if one reaches it. This prop is honesty in the
 * UI; the enforcement is on the server.
 *
 * REQUEST SHAPE. `descriptor` and `mode` go in the query string; the body carries only the file and
 * `confirmArchive`. That is what lets the server gate the request before parsing the multipart body
 * — see the route header and lib/import/access.ts.
 */
import { useState } from "react";
import { num } from "@/lib/money";
import type { ImportMode } from "@/lib/import/access";
import { importPanelControls } from "@/lib/import/panel-mode";

interface DryRunResult {
  /** Rows that coerced and resolved cleanly. The only count a validation-only panel reports. */
  okCount: number;
  errorCount: number;
  errors: { row: number; column: string; reason: string }[];
  toInsert: number;
  toUpdate: number;
  toArchive: { id: string; label: string }[];
}
interface CommitResult {
  written: number;
  failed: number;
  skipped: { row: number; reason: string }[];
  failures: { row: number; error: string }[];
  archived: string[];
  archiveFailures: { label: string; error: string }[];
}

const BTN = "rounded-md border px-3 py-1.5 text-sm disabled:opacity-50";

export function ImportPanel({
  descriptorKey,
  titleAr,
  validationOnly,
}: {
  descriptorKey: string;
  titleAr: string;
  /** True for a descriptor with no commit path: template + dry-run only. */
  validationOnly?: boolean;
}) {
  const controls = importPanelControls(validationOnly);
  // Encoded rather than interpolated: the descriptor key is the route's routing input, so it is
  // built the same way here as in `send` below.
  const templateHref = `/api/import?${new URLSearchParams({ descriptor: descriptorKey })}`;
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [dry, setDry] = useState<DryRunResult | null>(null);
  const [done, setDone] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // `ImportMode` is the route's own spelling of the two modes (lib/import/access.ts). Restating the
  // literals here would let the panel drift from the gate the day a third mode is added.
  async function send(mode: ImportMode) {
    if (!file) return;
    // Belt and braces: a commit request is never even formed when this panel has no commit control.
    // The server refuses it regardless — this only keeps the client from asking.
    if (mode === "commit" && !controls.showCommit) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (mode === "commit") fd.set("confirmArchive", String(confirmArchive));
      // `descriptor` and `mode` ride in the QUERY STRING, never the body. The route has to resolve
      // the descriptor and refuse a forbidden role or a no-commit-path commit BEFORE it parses this
      // multipart upload — a body field could not be read that early without defeating the point.
      // URLSearchParams encodes both.
      const query = new URLSearchParams({ descriptor: descriptorKey, mode });
      const res = await fetch(`/api/import?${query}`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "تعذّر الاستيراد");
        return;
      }
      if (mode === "dry-run") setDry(json as DryRunResult);
      else setDone(json as CommitResult);
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section dir="rtl" className="space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">
        {controls.showCommit ? "استيراد" : "تحقّق"}: {titleAr}
      </h3>

      {controls.notice && (
        <p className="rounded-md border p-2 text-xs" style={{ borderColor: "var(--line)" }}>
          {controls.notice}
        </p>
      )}

      <a className="text-sm underline" href={templateHref}>
        تنزيل القالب
      </a>

      <input
        type="file"
        accept=".xlsx"
        className="block text-sm"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setDry(null);
          setDone(null);
          setError(null);
          setConfirmArchive(false);
        }}
      />

      <div className="flex gap-2">
        <button type="button" className={BTN} disabled={!file || busy} onClick={() => send("dry-run")}>
          تحقّق
        </button>
        {controls.showCommit && (
          <button
            type="button"
            className={BTN}
            disabled={
              !file || busy || !dry || dry.errorCount > 0 || (dry.toArchive.length > 0 && !confirmArchive)
            }
            onClick={() => send("commit")}
          >
            استيراد
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {dry && (
        <div className="text-sm">
          {/* «جديد / تحديث / سيُؤرشف» describes a WRITE that would follow. A validation-only panel
              must not print it: there is no write to describe, only a count of clean rows. */}
          {controls.showCommit ? (
            <p>
              جديد: {num(dry.toInsert)} · تحديث: {num(dry.toUpdate)} · سيُؤرشف: {num(dry.toArchive.length)} ·
              أخطاء: {num(dry.errorCount)}
            </p>
          ) : (
            <p>
              صفوف سليمة الشكل: {num(dry.okCount)} · صفوف بها أخطاء: {num(dry.errorCount)} — لم يُحفظ أي
              صف.
            </p>
          )}
          {dry.errors.length > 0 && (
            <ul className="mt-1 list-disc pe-5">
              {dry.errors.map((e) => (
                <li key={`${e.row}-${e.column}`}>
                  صف {num(e.row)} — {e.column}: {e.reason}
                </li>
              ))}
            </ul>
          )}
          {controls.showArchive && dry.toArchive.length > 0 && (
            <div className="mt-2 rounded border border-amber-400 bg-amber-50 p-2">
              <p className="font-medium">سيتم أرشفة هذه العناصر لأنها غير موجودة في الملف:</p>
              <ul className="mt-1 list-disc pe-5">
                {dry.toArchive.map((a) => (
                  <li key={a.id}>{a.label}</li>
                ))}
              </ul>
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={confirmArchive}
                  onChange={(e) => setConfirmArchive(e.target.checked)}
                />
                أفهم أن العناصر أعلاه سيتم أرشفتها
              </label>
            </div>
          )}
        </div>
      )}

      {controls.showCommitResult && done && (
        <div className="text-sm">
          <p>
            تم استيراد {num(done.written)} · فشل {num(done.failed)}
            {done.skipped.length > 0 ? ` · مكرر ${num(done.skipped.length)}` : ""}
          </p>
          {/* Surface the per-row failure reasons the API already returns (previously dropped — the user
              saw only "فشل N" with no cause). Mirrors the dry-run error list for commit parity. */}
          {done.failures.length > 0 && (
            <ul className="mt-1 list-disc pe-5 text-red-600">
              {done.failures.map((f) => (
                <li key={`fail-${f.row}`}>
                  صف {num(f.row)} — {f.error}
                </li>
              ))}
            </ul>
          )}
          {done.skipped.length > 0 && (
            <ul className="mt-1 list-disc pe-5 text-gray-600">
              {done.skipped.map((s) => (
                <li key={`skip-${s.row}`}>
                  صف {num(s.row)} — {s.reason}
                </li>
              ))}
            </ul>
          )}
          {done.archived.length > 0 && (
            <p className="mt-1 text-gray-600">تمت أرشفة: {done.archived.join("، ")}</p>
          )}
          {done.archiveFailures.length > 0 && (
            <ul className="mt-1 list-disc pe-5 text-red-600">
              {done.archiveFailures.map((f) => (
                <li key={`archive-fail-${f.label}`}>
                  {f.label} — {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
