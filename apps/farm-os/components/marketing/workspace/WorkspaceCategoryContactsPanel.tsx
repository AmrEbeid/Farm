"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Textarea, Alert, useToast } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import type { SimpleColumn } from "@/components/SimpleTable";
import { saveMarketingContact, archiveMarketingContact, type MarketingContactInput } from "@/app/(app)/marketing/actions";
import type { MarketingContactRow } from "@/components/marketing/MarketingContactTable";
import {
  MARKETING_CONTACT_STATUS_OPTIONS,
  defaultMarketingContactStatus,
} from "@/lib/marketing/contact-status";

/**
 * SPEC-0032 — a fixed-category contact register (exporters / Kuwait distributors): small lists
 * (≤ ~75 rows) that don't need server pagination, unlike the 1,513-row directory tab (which reuses
 * `MarketingContactTable` + `fn_marketing_contacts_page` instead — see `WorkspaceArea.tsx`).
 */
export function WorkspaceCategoryContactsPanel({
  title,
  description,
  category,
  rows,
  orgId,
  canWrite,
  exportFilename,
}: {
  title: string;
  description?: string;
  category: string;
  rows: MarketingContactRow[];
  orgId: string;
  canWrite: boolean;
  exportFilename: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const visible = rows.filter((r) => showArchived || !r.archived);

  function startCreate() {
    setEditId(null);
    setForm({});
    setMsg(null);
    setOpen(true);
  }

  function startEdit(row: MarketingContactRow) {
    setEditId(row.id);
    setForm({ name: row.name, phone: row.phone ?? "", email: row.email ?? "", orgName: row.orgName ?? "", source: row.source ?? "", notes: row.notes ?? "", status: row.status ?? defaultMarketingContactStatus(category) });
    setMsg(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const input: MarketingContactInput = {
      id: editId,
      orgId,
      name: (form.name ?? "").trim(),
      phone: form.phone || null,
      email: form.email || null,
      orgName: form.orgName || null,
      category,
      source: form.source || null,
      notes: form.notes || null,
      status: form.status || defaultMarketingContactStatus(category),
    };
    const r = await saveMarketingContact(input);
    setPending(false);
    if (r.ok) {
      setOpen(false);
      setForm({});
      setEditId(null);
      toast.ok(editId ? "تم الحفظ" : "تمت الإضافة بنجاح");
      router.refresh();
    } else {
      setMsg({ tone: "danger", text: r.error ?? "تعذّر الحفظ" });
    }
  }

  async function toggleArchive(id: string, archived: boolean) {
    const r = await archiveMarketingContact(id, archived);
    if (r.ok) {
      toast.ok(archived ? "تمت الأرشفة" : "تمت الاستعادة");
      router.refresh();
    } else {
      toast.danger(r.error ?? "تعذّر تنفيذ العملية");
    }
  }

  const columns: SimpleColumn[] = [
    { id: "name", header: "الاسم" },
    { id: "org_name", header: "الجهة" },
    { id: "phone", header: "الهاتف", kind: "code" },
    { id: "email", header: "البريد" },
    { id: "status", header: "الحالة" },
    { id: "notes", header: "ملاحظات" },
    ...(canWrite
      ? [
          {
            id: "actions",
            header: "",
            render: (r: { id: string }) => {
              const row = visible.find((v) => v.id === r.id);
              if (!row) return null;
              return (
                <div className="flex gap-1">
                  <Button variant="ghost" onClick={() => startEdit(row)}>تعديل</Button>
                  <Button variant="ghost" onClick={() => toggleArchive(row.id, !row.archived)}>{row.archived ? "استعادة" : "أرشفة"}</Button>
                </div>
              );
            },
          } satisfies SimpleColumn,
        ]
      : []),
  ];

  const tableRows = visible.map((row) => ({
    id: row.id,
    name: row.name,
    org_name: row.orgName ?? "—",
    phone: row.phone ?? "—",
    email: row.email ?? "—",
    status: row.status ?? defaultMarketingContactStatus(category),
    notes: row.notes ?? "—",
  }));

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {description && <p style={{ color: "var(--ink-muted)" }}>{description}</p>}
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => setShowArchived((v) => !v)}>{showArchived ? "إخفاء المؤرشف" : "إظهار المؤرشف"}</Button>
          {canWrite && !open && <Button variant="ghost" onClick={startCreate}>+ إضافة</Button>}
        </div>
      </header>
      {canWrite && open && (
        <form onSubmit={submit} className="no-print flex flex-col gap-3 rounded-lg border p-3" style={{ borderColor: "var(--line)" }}>
          <div role="alert" aria-live="assertive" aria-atomic="true">{msg && <Alert tone={msg.tone} title={msg.text} />}</div>
          <Field id={`${category}-name`} label="الاسم" required>
            <Input id={`${category}-name`} value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required maxLength={160} />
          </Field>
          <Field id={`${category}-org`} label="الجهة">
            <Input id={`${category}-org`} value={form.orgName ?? ""} onChange={(e) => setForm((f) => ({ ...f, orgName: e.target.value }))} />
          </Field>
          <Field id={`${category}-phone`} label="الهاتف">
            <Input id={`${category}-phone`} value={form.phone ?? ""} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field id={`${category}-email`} label="البريد الإلكتروني">
            <Input id={`${category}-email`} type="email" value={form.email ?? ""} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field id={`${category}-source`} label="المصدر">
            <Input id={`${category}-source`} value={form.source ?? ""} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
          </Field>
          <Field id={`${category}-notes`} label="ملاحظات / حالة">
            <Textarea id={`${category}-notes`} value={form.notes ?? ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          <Field id={`${category}-status`} label="حالة التواصل">
            <Select
              id={`${category}-status`}
              value={form.status ?? defaultMarketingContactStatus(category)}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              options={MARKETING_CONTACT_STATUS_OPTIONS.map((value) => ({ value, label: value }))}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={pending}>{editId ? "حفظ التعديل" : "إضافة"}</Button>
            <Button type="button" variant="ghost" onClick={() => { setOpen(false); setEditId(null); setForm({}); }}>إلغاء</Button>
          </div>
        </form>
      )}
      <FilterableTable
        columns={columns}
        rows={tableRows}
        searchColumns={["name", "org_name", "phone", "email", "status", "notes"]}
        placeholder="بحث…"
        ariaLabel={title}
        empty="لا توجد جهات اتصال بعد"
        exportFilename={exportFilename}
      />
    </section>
  );
}
