"use client";

/**
 * Shared bulk-import UI (spec §4). Mount on any feature route with its descriptor key:
 *   <ImportPanel descriptorKey="sectors" titleAr="القطاعات" />
 * Flow: download template → pick file → "تحقّق" (dry-run, writes nothing) → fix errors →
 * "استيراد" (commit). Commit stays disabled until a clean dry-run (error-resolution-first).
 */
import { useState } from "react";
import { num } from "@/lib/money";

interface DryRunResult {
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

export function ImportPanel({ descriptorKey, titleAr }: { descriptorKey: string; titleAr: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [dry, setDry] = useState<DryRunResult | null>(null);
  const [done, setDone] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  async function send(mode: "dry-run" | "commit") {
    if (!file) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const fd = new FormData();
      fd.set("mode", mode);
      fd.set("descriptor", descriptorKey);
      fd.set("file", file);
      if (mode === "commit") fd.set("confirmArchive", String(confirmArchive));
      const res = await fetch("/api/import", { method: "POST", body: fd });
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
      <h3 className="font-semibold">استيراد: {titleAr}</h3>

      <a className="text-sm underline" href={`/api/import?descriptor=${descriptorKey}`}>
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
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {dry && (
        <div className="text-sm">
          <p>
            جديد: {num(dry.toInsert)} · تحديث: {num(dry.toUpdate)} · سيُؤرشف: {num(dry.toArchive.length)} ·
            أخطاء: {num(dry.errorCount)}
          </p>
          {dry.errors.length > 0 && (
            <ul className="mt-1 list-disc pe-5">
              {dry.errors.map((e) => (
                <li key={`${e.row}-${e.column}`}>
                  صف {num(e.row)} — {e.column}: {e.reason}
                </li>
              ))}
            </ul>
          )}
          {dry.toArchive.length > 0 && (
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

      {done && (
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
