"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea, Alert } from "@/components/ui";
import { stageMarketingSource, type SourceStagingResult } from "@/lib/marketing/source-staging";
import { importMarketingSource } from "@/app/(app)/marketing/actions";

/**
 * SPEC-0032 — preview-only staging tool for the legacy tracker manifest. Runs the pure
 * `stageMarketingSource` parser ENTIRELY IN THE BROWSER (no network round-trip, no DB write): paste a
 * manifest, see the inventory counts, the curated staged counts, and every unrelated key it would
 * reject, before any record is actually created via the add forms elsewhere in this module. Never
 * persists anything — actually creating contacts/records from a reviewed manifest still goes through
 * the normal gated add forms, one at a time (this keeps the module from ever bulk-writing an unreviewed
 * raw contact dump).
 */
export function SourceStagingPreview({ orgId, canWrite }: { orgId: string; canWrite: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [result, setResult] = useState<SourceStagingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<number | null>(null);

  function preview() {
    setError(null);
    try {
      const parsed = JSON.parse(text || "{}");
      setResult(stageMarketingSource(parsed));
    } catch {
      setResult(null);
      setError("النص المُدخل ليس JSON صالحًا.");
    }
  }

  async function selectFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) {
      setError("الملف أكبر من 2 ميجابايت.");
      return;
    }
    const next = await file.text();
    setText(next);
    setResult(null);
    setImported(null);
    setError(null);
  }

  async function importAccepted() {
    if (!result?.ok) return;
    setImporting(true);
    try {
      const response = await importMarketingSource(orgId, result.records);
      if (response.ok) {
        setImported(response.data?.imported ?? 0);
        setError(null);
        router.refresh();
      } else {
        setError(response.error);
      }
    } catch {
      setError("تعذّر الاتصال بالخادم. أعد المحاولة؛ إعادة الاستيراد لا تنشئ نسخًا مكررة.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
      <div>
        <h2 className="text-lg font-bold">استيراد ملف تسويق 2026</h2>
        <p style={{ color: "var(--ink-muted)" }}>
          اختر ملف JSON أو الصق محتواه. ستظهر البيانات المقبولة والمفاتيح المرفوضة قبل الحفظ.
        </p>
      </div>
      <input
        type="file"
        accept="application/json,.json"
        onChange={(event) => void selectFile(event.target.files?.[0])}
      />
      <Textarea
        id="marketing-source-manifest"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder='{"ep_prices":"[...]","ep_tasks":"[...]"}'
      />
      <div>
        <Button type="button" onClick={preview}>
          معاينة
        </Button>
      </div>
      {error && <Alert tone="danger" title={error} />}
      {imported !== null && <Alert tone="ok" title={`تم حفظ أو تحديث ${imported} سجلًا. إعادة الاستيراد لا تنشئ نسخًا مكررة.`} />}
      {result && (
        <div className="flex flex-col gap-2 text-sm">
          <Alert
            tone={result.ok ? "ok" : "warning"}
            title={result.ok
              ? `الملف صالح للاستيراد؛ سيتم تجاهل ${result.rejectedKeys.length} مفتاحًا من تطبيقات أخرى`
              : "الملف يحتوي على بيانات تسويق غير صالحة ولن يتم استيراده"}
          />
          <div>
            المخزون المصدري: مُصدّرون {result.inventory.exporters} · جهات اتصال {result.inventory.contacts} · موزّعو
            الكويت {result.inventory.kuwaitDistributors} · منصّات {result.inventory.platforms} · مراجع شحن{" "}
            {result.inventory.freightRefs}
          </div>
          <div>
            الحالة المجهّزة: أسعار {result.counts.prices} · حالات الكويت {result.counts.kuwaitStatuses} · جهات مختارة{" "}
            {result.counts.selectedContacts} · حصاد {result.counts.harvest} · مهام يومية {result.counts.campaignTasks} · مهام منصات{" "}
            {result.counts.platformTasks} · الهدف {result.counts.target}
          </div>
          <div>
            رابط المزرعة: {result.sourceMetadata.farmUrl ?? "—"} · رقم واتساب المالك موجود في المصدر ولا يُنشأ كجهة اتصال تسويقية.
          </div>
          {result.rejectedKeys.length > 0 && (
            <details>
              <summary>المفاتيح المرفوضة ({result.rejectedKeys.length})</summary>
              <ul className="list-inside list-disc">
                {result.rejectedKeys.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            </details>
          )}
          {canWrite && result.ok && result.records.length > 0 && (
            <div>
              <Button type="button" loading={importing} onClick={() => void importAccepted()}>
                استيراد {result.records.length} سجلًا مقبولًا
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
