"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, useToast } from "@/components/ui";
import { ExportButton } from "@/components/ExportButton";
import { saveMarketingRecord, archiveMarketingRecord } from "@/app/(app)/marketing/actions";
import type { MarketingRecordRow } from "@/components/marketing/MarketingRecordTable";

/**
 * SPEC-0032 — a "checklist" blueprint section: the legacy daily-campaign / platform-readiness /
 * Kuwait-followup checkbox list, persisted as `task` records tagged `payload.group`. `defaultTitles`
 * seeds the exact legacy items on first use (checking one creates its row instead of failing).
 */
export function WorkspaceChecklistPanel({
  title,
  description,
  group,
  defaultTitles,
  rows,
  orgId,
  canWrite,
  exportFilename,
}: {
  title: string;
  description?: string;
  group: string;
  defaultTitles: readonly string[];
  rows: MarketingRecordRow[];
  orgId: string;
  canWrite: boolean;
  exportFilename: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [newTitle, setNewTitle] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const byTitle = new Map(rows.map((row) => [row.title, row]));
  const items = [
    ...defaultTitles.map((t) => ({ title: t, row: byTitle.get(t) ?? null })),
    ...rows.filter((row) => !defaultTitles.includes(row.title)).map((row) => ({ title: row.title, row })),
  ];

  async function toggle(itemTitle: string, row: MarketingRecordRow | null) {
    setPending(itemTitle);
    const done = row?.status === "done";
    const r = await saveMarketingRecord({
      id: row?.id ?? null,
      orgId,
      recordType: "task",
      title: itemTitle,
      payload: { group },
      status: done ? "todo" : "done",
    });
    setPending(null);
    if (!r.ok) toast.danger(r.error ?? "تعذّر الحفظ");
    else router.refresh();
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    const t = newTitle.trim();
    if (!t) return;
    setPending(t);
    const r = await saveMarketingRecord({ orgId, recordType: "task", title: t, payload: { group }, status: "todo" });
    setPending(null);
    if (r.ok) {
      setNewTitle("");
      router.refresh();
    } else {
      toast.danger(r.error ?? "تعذّر الإضافة");
    }
  }

  async function removeCustomItem(row: MarketingRecordRow) {
    const r = await archiveMarketingRecord(row.id, true);
    if (r.ok) router.refresh();
    else toast.danger(r.error ?? "تعذّر الحذف");
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
            columns={[{ id: "title", header: "البند" }, { id: "status", header: "الحالة" }]}
            rows={items.map((it) => ({ title: it.title, status: it.row?.status === "done" ? "منتهٍ" : "لم يبدأ" }))}
          />
        </div>
      </header>
      <ul className="flex flex-col gap-2">
        {items.filter((it) => !it.row?.archived).map((it) => (
          <li key={it.title} className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-2">
              <input
                type="checkbox"
                checked={it.row?.status === "done"}
                disabled={!canWrite || pending === it.title}
                onChange={() => void toggle(it.title, it.row)}
              />
              <span>{it.title}</span>
            </label>
            {canWrite && it.row && !defaultTitles.includes(it.title) && (
              <Button variant="ghost" onClick={() => void removeCustomItem(it.row!)}>حذف</Button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <form onSubmit={addItem} className="no-print flex gap-2">
          <Input
            id={`${group}-new-item`}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="بند جديد"
            aria-label="بند جديد"
          />
          <Button type="submit">+ إضافة</Button>
        </form>
      )}
    </section>
  );
}
