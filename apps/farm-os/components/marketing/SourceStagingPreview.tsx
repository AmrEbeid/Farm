"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@/components/ui";
import { num } from "@/lib/money";

interface SourceSummary {
  contacts: number;
  selectedContacts: number;
  records: number;
  tabs: number;
  templates: number;
  mutableStateKeys: number;
  recordTypes: Record<string, number>;
  excluded: { source: string; destination: string; reason: string }[];
  emptyRegisters: string[];
}

interface SourceResponse {
  digest?: string;
  summary?: SourceSummary;
  result?: Record<string, unknown>;
  error?: string;
}

async function submitSource(mode: "preview" | "commit", html: File, state: File): Promise<SourceResponse> {
  const form = new FormData();
  form.set("html", html);
  form.set("state", state);
  const response = await fetch(`/api/marketing/source?mode=${mode}`, { method: "POST", body: form });
  const body = await response.json() as SourceResponse;
  if (!response.ok) throw new Error(body.error ?? "تعذّر فحص الملفين.");
  return body;
}

/** Reviewed two-file import for the complete 2026 Marketing archive. */
export function SourceStagingPreview({ canImport }: { canImport: boolean }) {
  const router = useRouter();
  const [html, setHtml] = useState<File | null>(null);
  const [state, setState] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ digest: string; summary: SourceSummary } | null>(null);
  const [pending, setPending] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function selectHtml(file: File | undefined) {
    setHtml(file ?? null);
    setPreview(null);
    setDone(false);
  }

  function selectState(file: File | undefined) {
    setState(file ?? null);
    setPreview(null);
    setDone(false);
  }

  async function run(mode: "preview" | "commit") {
    if (!html || !state) {
      setError("اختر ملف HTML وملف JSON معًا.");
      return;
    }
    setPending(mode);
    setError(null);
    try {
      const response = await submitSource(mode, html, state);
      if (!response.digest || !response.summary) throw new Error("استجابة الاستيراد غير مكتملة.");
      setPreview({ digest: response.digest, summary: response.summary });
      if (mode === "commit") {
        setDone(true);
        router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذّر فحص الملفين.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
      <header>
        <h2 className="text-lg font-bold">ملف تسويق ٢٠٢٦</h2>
        <p style={{ color: "var(--ink-muted)" }}>أرشيف HTML مع ملف الحالة JSON.</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-bold">
          ملف HTML
          <input type="file" accept="text/html,.html" onChange={(event) => selectHtml(event.target.files?.[0])} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          ملف JSON
          <input type="file" accept="application/json,.json" onChange={(event) => selectState(event.target.files?.[0])} />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={pending === "preview"} onClick={() => void run("preview")}>
          فحص البيانات
        </Button>
        {canImport && preview && (
          <Button type="button" loading={pending === "commit"} onClick={() => void run("commit")}>
            اعتماد الاستيراد
          </Button>
        )}
      </div>

      {!canImport && <p className="text-sm" style={{ color: "var(--ink-muted)" }}>المعاينة متاحة، واعتماد الأرشيف لمالك المزرعة فقط.</p>}

      {error && <Alert tone="danger" title={error} />}
      {done && <Alert tone="ok" title="تم اعتماد المصدر. إعادة نفس الملفين لا تنشئ نسخًا مكررة." />}

      {preview && (
        <div className="flex flex-col gap-3 text-sm">
          <Alert
            tone="ok"
            title={`تمت مطابقة ${num(preview.summary.tabs)} مساحة و${num(preview.summary.mutableStateKeys)} حالة قابلة للتعديل.`}
          />
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><dt style={{ color: "var(--ink-muted)" }}>جهات الاتصال</dt><dd className="text-lg font-bold">{num(preview.summary.contacts)}</dd></div>
            <div><dt style={{ color: "var(--ink-muted)" }}>المختارة</dt><dd className="text-lg font-bold">{num(preview.summary.selectedContacts)}</dd></div>
            <div><dt style={{ color: "var(--ink-muted)" }}>السجلات</dt><dd className="text-lg font-bold">{num(preview.summary.records)}</dd></div>
            <div><dt style={{ color: "var(--ink-muted)" }}>قوالب الرسائل</dt><dd className="text-lg font-bold">{num(preview.summary.templates)}</dd></div>
          </dl>
          <details>
            <summary className="cursor-pointer font-bold">تغطية المصدر</summary>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(preview.summary.recordTypes).map(([type, count]) => (
                <span key={type}>{type}: {num(count)}</span>
              ))}
            </div>
          </details>
          <div className="text-xs" style={{ color: "var(--ink-muted)" }}>مرجع الفحص: {preview.digest.slice(0, 12)}</div>
        </div>
      )}
    </section>
  );
}
