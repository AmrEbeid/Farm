"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea, useToast } from "@/components/ui";
import { ExportButton } from "@/components/ExportButton";
import { saveMarketingRecord } from "@/app/(app)/marketing/actions";
import type { MarketingRecordRow } from "@/components/marketing/MarketingRecordTable";
import type { MarketingTemplateSpec } from "@/lib/marketing/fidelity-manifest";
import { containsDisputedClaim } from "@/lib/marketing/workspace/disputed-claims";

/**
 * SPEC-0032 — a "templates" blueprint section: the legacy `<textarea id="...">` bodies, editable and
 * persisted as `message_template` records (`payload.templateId` keeps the exact legacy DOM id).
 * Copy-to-clipboard / print / CSV export only — no send affordance anywhere in this component.
 */
export function WorkspaceTemplatesPanel({
  title,
  description,
  templates,
  defaults,
  savedRows,
  orgId,
  canWrite,
  exportFilename,
}: {
  title: string;
  description?: string;
  templates: readonly MarketingTemplateSpec[];
  defaults: Record<string, string>;
  savedRows: MarketingRecordRow[];
  orgId: string;
  canWrite: boolean;
  exportFilename: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const savedByTemplateId = new Map(savedRows.map((row) => [String(row.payload.templateId ?? ""), row]));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);

  function bodyOf(id: string): string {
    if (drafts[id] !== undefined) return drafts[id];
    const saved = savedByTemplateId.get(id);
    return typeof saved?.payload.body === "string" ? saved.payload.body : (defaults[id] ?? "");
  }

  async function save(spec: MarketingTemplateSpec) {
    setPending(spec.id);
    const saved = savedByTemplateId.get(spec.id);
    const r = await saveMarketingRecord({
      id: saved?.id ?? null,
      orgId,
      recordType: "message_template",
      title: spec.label,
      payload: { templateId: spec.id, body: bodyOf(spec.id), channel: spec.channel, language: spec.language, area: spec.area },
    });
    setPending(null);
    if (r.ok) {
      toast.ok("تم حفظ القالب");
      router.refresh();
    } else {
      toast.danger(r.error ?? "تعذّر الحفظ");
    }
  }

  async function copy(spec: MarketingTemplateSpec) {
    await navigator.clipboard.writeText(bodyOf(spec.id));
    toast.ok("تم نسخ النص");
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {description && <p style={{ color: "var(--ink-muted)" }}>{description}</p>}
        </div>
        <div className="no-print">
          <ExportButton
            filename={exportFilename}
            columns={[{ id: "label", header: "القالب" }, { id: "body", header: "النص" }]}
            rows={templates.map((t) => ({ label: t.label, body: bodyOf(t.id) }))}
          />
        </div>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {templates.map((spec) => (
          <div key={spec.id} className="flex flex-col gap-2 rounded-md border p-3" style={{ borderColor: "var(--line)" }}>
            <div>
              <div className="font-bold">{spec.label}</div>
              <div className="text-xs" style={{ color: "var(--ink-muted)" }}>{spec.purpose}</div>
            </div>
            <Textarea
              id={spec.id}
              dir={spec.language === "en" ? "ltr" : "rtl"}
              rows={6}
              value={bodyOf(spec.id)}
              onChange={(e) => setDrafts((d) => ({ ...d, [spec.id]: e.target.value }))}
              readOnly={!canWrite}
            />
            {containsDisputedClaim(bodyOf(spec.id)) && (
              <p className="text-xs" style={{ color: "var(--danger, #a44732)" }} data-disputed-claim-warning={spec.id}>
                ⚠ يذكر هذا النص عدد نخيل تقريبي (~5,000) متنازع عليه (docs/CLAUDE.md بند ٥) — راجعه أو
                احذف الرقم قبل إرساله فعليًا لمشترٍ.
              </p>
            )}
            <div className="no-print flex gap-2">
              <Button variant="ghost" onClick={() => void copy(spec)}>نسخ</Button>
              {canWrite && (
                <Button variant="ghost" loading={pending === spec.id} onClick={() => void save(spec)}>
                  حفظ
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
