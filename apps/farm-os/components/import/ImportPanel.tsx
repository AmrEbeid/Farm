"use client";

/**
 * Shared bulk-import UI (spec §4). Mount on any feature route with its descriptor key:
 *   <ImportPanel descriptorKey="sectors" titleAr="القطاعات" />
 * Flow: download template → pick file → "تحقّق" (dry-run, writes nothing) → fix errors →
 * "استيراد" (commit). Commit stays disabled until a clean dry-run (error-resolution-first).
 */
import { useState } from "react";

interface DryRunResult {
  okCount: number;
  errorCount: number;
  errors: { row: number; column: string; reason: string }[];
}
interface CommitResult {
  written: number;
  failed: number;
  skipped: { row: number; reason: string }[];
  failures: { row: number; error: string }[];
}

const BTN = "rounded-md border px-3 py-1.5 text-sm disabled:opacity-50";

export function ImportPanel({ descriptorKey, titleAr }: { descriptorKey: string; titleAr: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [dry, setDry] = useState<DryRunResult | null>(null);
  const [done, setDone] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        }}
      />

      <div className="flex gap-2">
        <button type="button" className={BTN} disabled={!file || busy} onClick={() => send("dry-run")}>
          تحقّق
        </button>
        <button
          type="button"
          className={BTN}
          disabled={!file || busy || !dry || dry.errorCount > 0}
          onClick={() => send("commit")}
        >
          استيراد
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {dry && (
        <div className="text-sm">
          <p>
            صالح: {dry.okCount} · أخطاء: {dry.errorCount}
          </p>
          {dry.errors.length > 0 && (
            <ul className="mt-1 list-disc pe-5">
              {dry.errors.map((e) => (
                <li key={`${e.row}-${e.column}`}>
                  صف {e.row} — {e.column}: {e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {done && (
        <p className="text-sm">
          تم استيراد {done.written} · فشل {done.failed}
          {done.skipped.length > 0 ? ` · مكرر ${done.skipped.length}` : ""}
        </p>
      )}
    </section>
  );
}
