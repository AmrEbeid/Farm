"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Textarea, Alert, useToast } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn } from "@/components/SimpleTable";
import { saveMarketingRecord, archiveMarketingRecord, type MarketingRecordInput } from "@/app/(app)/marketing/actions";
import type { Json, MarketingRecordType } from "@/lib/database.types.ext";

export type MarketingRecordFieldType = "text" | "number" | "date" | "textarea";

export interface MarketingRecordField {
  key: string;
  label: string;
  type?: MarketingRecordFieldType;
  required?: boolean;
}

export interface MarketingRecordRow {
  id: string;
  recordType: MarketingRecordType;
  title: string;
  payload: Record<string, Json>;
  contactId: string | null;
  amount: number | null;
  status: string | null;
  archived: boolean;
}

/**
 * SPEC-0032 — one generic add/edit/archive/search screen reused across all 16 marketing record
 * types. Type-specific shape lives entirely in `fields` (rendered payload columns + form inputs);
 * writes go through the page-shared server actions, which call the gated RPCs (role re-checked in
 * the DB — `canWrite` here only hides the affordance).
 */
export function MarketingRecordTable({
  recordType,
  orgId,
  title,
  description,
  fields,
  hasAmount,
  amountLabel = "القيمة",
  hasStatus,
  statusOptions,
  contacts,
  rows,
  canWrite,
  addLabel = "+ إضافة",
  empty = "لا توجد سجلات بعد",
}: {
  recordType: MarketingRecordType;
  orgId: string;
  title: string;
  description?: string;
  fields: MarketingRecordField[];
  hasAmount?: boolean;
  amountLabel?: string;
  hasStatus?: boolean;
  statusOptions?: { value: string; label: string }[];
  contacts?: { id: string; name: string }[];
  rows: MarketingRecordRow[];
  canWrite: boolean;
  addLabel?: string;
  empty?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  function startCreate() {
    setEditId(null);
    setForm({});
    setMsg(null);
    setOpen(true);
  }

  function startEdit(row: MarketingRecordRow) {
    const next: Record<string, string> = { title: row.title };
    for (const f of fields) {
      const v = row.payload[f.key];
      next[f.key] = v == null ? "" : String(v);
    }
    if (hasAmount) next.amount = row.amount != null ? String(row.amount) : "";
    if (hasStatus) next.status = row.status ?? "";
    next.contactId = row.contactId ?? "";
    setEditId(row.id);
    setForm(next);
    setMsg(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const payload: Record<string, Json> = {};
    for (const f of fields) {
      const raw = (form[f.key] ?? "").trim();
      if (raw === "") continue;
      payload[f.key] = f.type === "number" ? Number(raw) : raw;
    }
    const input: MarketingRecordInput = {
      id: editId,
      orgId,
      recordType,
      title: (form.title ?? "").trim(),
      payload,
      contactId: form.contactId ? form.contactId : null,
      amount: hasAmount && form.amount ? Number(form.amount) : null,
      status: hasStatus ? (form.status || null) : null,
    };
    let r: { ok: boolean; error?: string };
    try {
      r = await saveMarketingRecord(input);
    } catch {
      r = { ok: false, error: "تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى." };
    }
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
    const r = await archiveMarketingRecord(id, archived);
    if (r.ok) {
      toast.ok(archived ? "تمت الأرشفة" : "تمت الاستعادة");
      router.refresh();
    } else {
      toast.danger(r.error ?? "تعذّر تنفيذ العملية");
    }
  }

  async function copyTemplate(row: MarketingRecordRow) {
    const body = row.payload.body;
    if (typeof body !== "string" || !body) return;
    await navigator.clipboard.writeText(body);
    toast.ok("تم نسخ نص الرسالة");
  }

  const visibleRows = useMemo(() => rows.filter((r) => showArchived || !r.archived), [rows, showArchived]);

  const columns: SimpleColumn[] = [
    { id: "title", header: "العنوان" },
    ...fields.map((f): SimpleColumn => ({ id: f.key, header: f.label })),
    ...(hasAmount ? [{ id: "amount", header: amountLabel, numeric: true } satisfies SimpleColumn] : []),
    ...(hasStatus ? [{ id: "status", header: "الحالة" } satisfies SimpleColumn] : []),
    ...(canWrite
      ? [
          {
            id: "actions",
            header: "",
            render: (r) => {
              const row = visibleRows.find((v) => v.id === r.id);
              if (!row) return null;
              return (
                <div className="flex gap-1">
                  {recordType === "message_template" && typeof row.payload.body === "string" && (
                    <Button variant="ghost" onClick={() => void copyTemplate(row)}>
                      نسخ
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => startEdit(row)}>
                    تعديل
                  </Button>
                  <Button variant="ghost" onClick={() => toggleArchive(row.id, !row.archived)}>
                    {row.archived ? "استعادة" : "أرشفة"}
                  </Button>
                </div>
              );
            },
          } satisfies SimpleColumn,
        ]
      : []),
  ];

  const tableRows = visibleRows.map((row) => {
    const cells: { id: string; title: string; [key: string]: string } = { id: row.id, title: row.title };
    for (const f of fields) {
      const v = row.payload[f.key];
      cells[f.key] = v == null ? "—" : String(v);
    }
    if (hasAmount) cells.amount = row.amount != null ? String(row.amount) : "—";
    if (hasStatus) cells.status = statusOptions?.find((o) => o.value === row.status)?.label ?? row.status ?? "—";
    return cells;
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {description && <p style={{ color: "var(--ink-muted)" }}>{description}</p>}
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "إخفاء المؤرشف" : "إظهار المؤرشف"}
          </Button>
          {canWrite && !open && (
            <Button variant="ghost" onClick={startCreate}>
              {addLabel}
            </Button>
          )}
        </div>
      </header>

      {canWrite && open && (
        <form onSubmit={submit} className="no-print flex flex-col gap-3 rounded-lg border p-3" style={{ borderColor: "var(--line)" }}>
          <div role="alert" aria-live="assertive" aria-atomic="true">
            {msg && <Alert tone={msg.tone} title={msg.text} />}
          </div>
          <Field id={`${recordType}-title`} label="العنوان" required>
            <Input
              id={`${recordType}-title`}
              value={form.title ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
              maxLength={200}
            />
          </Field>
          {fields.map((f) => (
            <Field key={f.key} id={`${recordType}-${f.key}`} label={f.label} required={f.required}>
              {f.type === "textarea" ? (
                <Textarea
                  id={`${recordType}-${f.key}`}
                  value={form[f.key] ?? ""}
                  onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              ) : (
                <Input
                  id={`${recordType}-${f.key}`}
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  value={form[f.key] ?? ""}
                  onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </Field>
          ))}
          {contacts && contacts.length > 0 && (
            <Field id={`${recordType}-contact`} label="جهة الاتصال المرتبطة">
              <Select
                id={`${recordType}-contact`}
                value={form.contactId ?? ""}
                onChange={(e) => setForm((v) => ({ ...v, contactId: e.target.value }))}
                placeholder="بدون"
                options={contacts.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
          )}
          {hasAmount && (
            <Field id={`${recordType}-amount`} label={amountLabel}>
              <Input
                id={`${recordType}-amount`}
                type="number"
                step="0.01"
                value={form.amount ?? ""}
                onChange={(e) => setForm((v) => ({ ...v, amount: e.target.value }))}
              />
            </Field>
          )}
          {hasStatus && (
            <Field id={`${recordType}-status`} label="الحالة">
              <Select
                id={`${recordType}-status`}
                value={form.status ?? ""}
                onChange={(e) => setForm((v) => ({ ...v, status: e.target.value }))}
                placeholder="بدون"
                options={statusOptions ?? []}
              />
            </Field>
          )}
          <div className="flex gap-2">
            <Button type="submit" loading={pending}>
              {editId ? "حفظ التعديل" : "إضافة"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setEditId(null);
                setForm({});
              }}
            >
              إلغاء
            </Button>
          </div>
        </form>
      )}

      <FilterableTable
        columns={columns}
        rows={tableRows}
        searchColumns={["title", ...fields.map((f) => f.key)]}
        placeholder="بحث…"
        ariaLabel={title}
        empty={empty}
      />
    </div>
  );
}
