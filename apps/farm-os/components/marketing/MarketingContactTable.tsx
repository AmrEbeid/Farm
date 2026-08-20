"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Textarea, Alert, Drawer, useToast } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn } from "@/components/SimpleTable";
import { fmtDate } from "@/lib/dates";
import {
  saveMarketingContact,
  archiveMarketingContact,
  logMarketingContactActivity,
  type MarketingContactInput,
} from "@/app/(app)/marketing/actions";

const CATEGORY_AR: Record<string, string> = {
  exporter: "مُصدّر",
  buyer_lead: "عميل محتمل",
  kuwait_distributor: "موزّع الكويت",
  platform: "منصّة",
  freight: "شحن",
  other: "أخرى",
};

const ACTIVITY_KIND_AR: Record<string, string> = {
  call: "مكالمة",
  email: "بريد إلكتروني",
  meeting: "اجتماع",
  note: "ملاحظة",
  followup: "متابعة",
};

export interface MarketingContactRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  orgName: string | null;
  category: string;
  source: string | null;
  notes: string | null;
  selected: boolean;
  archived: boolean;
}

export interface MarketingContactActivityRow {
  id: string;
  contactId: string;
  kind: string;
  notes: string | null;
  occurredAt: string;
  followUpAt: string | null;
}

/** SPEC-0032 — the marketing contact master: add/edit/archive/search + per-contact call/follow-up history. */
export function MarketingContactTable({
  orgId,
  rows,
  activity,
  canWrite,
}: {
  orgId: string;
  rows: MarketingContactRow[];
  activity: MarketingContactActivityRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [activityContactId, setActivityContactId] = useState<string | null>(null);
  const [activityForm, setActivityForm] = useState<{ kind: string; notes: string; followUpAt: string }>({
    kind: "call",
    notes: "",
    followUpAt: "",
  });
  const [activityPending, setActivityPending] = useState(false);

  const visibleRows = useMemo(() => rows.filter((r) => showArchived || !r.archived), [rows, showArchived]);

  function startCreate() {
    setEditId(null);
    setForm({});
    setMsg(null);
    setOpen(true);
  }

  function startEdit(row: MarketingContactRow) {
    setEditId(row.id);
    setForm({
      name: row.name,
      phone: row.phone ?? "",
      email: row.email ?? "",
      orgName: row.orgName ?? "",
      category: row.category,
      source: row.source ?? "",
      notes: row.notes ?? "",
      selected: row.selected ? "true" : "",
    });
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
      category: form.category || "other",
      source: form.source || null,
      notes: form.notes || null,
      selected: form.selected === "true",
    };
    let r: { ok: boolean; error?: string };
    try {
      r = await saveMarketingContact(input);
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
    const r = await archiveMarketingContact(id, archived);
    if (r.ok) {
      toast.ok(archived ? "تمت الأرشفة" : "تمت الاستعادة");
      router.refresh();
    } else {
      toast.danger(r.error ?? "تعذّر تنفيذ العملية");
    }
  }

  async function submitActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!activityContactId) return;
    setActivityPending(true);
    const r = await logMarketingContactActivity({
      contactId: activityContactId,
      kind: activityForm.kind,
      notes: activityForm.notes || null,
      followUpAt: activityForm.followUpAt || null,
    });
    setActivityPending(false);
    if (r.ok) {
      toast.ok("تم تسجيل النشاط");
      setActivityForm({ kind: "call", notes: "", followUpAt: "" });
      router.refresh();
    } else {
      toast.danger(r.error ?? "تعذّر تسجيل النشاط");
    }
  }

  const columns: SimpleColumn[] = [
    { id: "name", header: "الاسم" },
    { id: "category", header: "الفئة" },
    { id: "org_name", header: "الجهة" },
    { id: "phone", header: "الهاتف", kind: "code" },
    {
      id: "actions",
      header: "",
      render: (r) => {
        const row = visibleRows.find((v) => v.id === r.id);
        if (!row) return null;
        return (
          <div className="flex gap-1">
            <Button variant="ghost" onClick={() => setActivityContactId(row.id)}>
              النشاط
            </Button>
            {canWrite && (
              <>
                <Button variant="ghost" onClick={() => startEdit(row)}>
                  تعديل
                </Button>
                <Button variant="ghost" onClick={() => toggleArchive(row.id, !row.archived)}>
                  {row.archived ? "استعادة" : "أرشفة"}
                </Button>
              </>
            )}
          </div>
        );
      },
    },
  ];

  const tableRows = visibleRows.map((row) => ({
    id: row.id,
    name: row.selected ? `★ ${row.name}` : row.name,
    category: CATEGORY_AR[row.category] ?? row.category,
    org_name: row.orgName ?? "—",
    phone: row.phone ?? "—",
  }));

  const activeContact = visibleRows.find((r) => r.id === activityContactId) ?? null;
  const contactActivity = activity
    .filter((a) => a.contactId === activityContactId)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">جهات الاتصال التسويقية</h2>
          <p style={{ color: "var(--ink-muted)" }}>
            دليل تسويقي منفصل عن سجل العملاء المحاسبي — بلا رقم حساب أو ربط مالي.
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "إخفاء المؤرشف" : "إظهار المؤرشف"}
          </Button>
          {canWrite && !open && (
            <Button variant="ghost" onClick={startCreate}>
              + إضافة جهة اتصال
            </Button>
          )}
        </div>
      </header>

      {canWrite && open && (
        <form onSubmit={submit} className="no-print flex flex-col gap-3 rounded-lg border p-3" style={{ borderColor: "var(--line)" }}>
          <div role="alert" aria-live="assertive" aria-atomic="true">
            {msg && <Alert tone={msg.tone} title={msg.text} />}
          </div>
          <Field id="mc-name" label="الاسم" required>
            <Input id="mc-name" value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required maxLength={160} />
          </Field>
          <Field id="mc-category" label="الفئة" required>
            <Select
              id="mc-category"
              value={form.category ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="اختر الفئة"
              options={Object.entries(CATEGORY_AR).map(([value, label]) => ({ value, label }))}
              required
            />
          </Field>
          <Field id="mc-org" label="الجهة">
            <Input id="mc-org" value={form.orgName ?? ""} onChange={(e) => setForm((f) => ({ ...f, orgName: e.target.value }))} />
          </Field>
          <Field id="mc-phone" label="الهاتف">
            <Input id="mc-phone" value={form.phone ?? ""} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field id="mc-email" label="البريد الإلكتروني">
            <Input id="mc-email" type="email" value={form.email ?? ""} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field id="mc-source" label="المصدر">
            <Input id="mc-source" value={form.source ?? ""} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
          </Field>
          <Field id="mc-notes" label="ملاحظات">
            <Textarea id="mc-notes" value={form.notes ?? ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.selected === "true"}
              onChange={(e) => setForm((f) => ({ ...f, selected: e.target.checked ? "true" : "" }))}
            />
            جهة مختارة (شورت-ليست)
          </label>
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
        searchColumns={["name", "category", "org_name", "phone"]}
        placeholder="ابحث عن جهة اتصال…"
        ariaLabel="جهات الاتصال التسويقية"
        empty="لا توجد جهات اتصال بعد"
      />

      <Drawer
        open={activityContactId != null}
        onClose={() => setActivityContactId(null)}
        title={activeContact ? `نشاط: ${activeContact.name}` : "النشاط"}
        closeLabel="إغلاق"
      >
        <div className="flex flex-col gap-4 p-4">
          {canWrite && (
            <form onSubmit={submitActivity} className="flex flex-col gap-2">
              <Field id="act-kind" label="نوع النشاط">
                <Select
                  id="act-kind"
                  value={activityForm.kind}
                  onChange={(e) => setActivityForm((f) => ({ ...f, kind: e.target.value }))}
                  options={Object.entries(ACTIVITY_KIND_AR).map(([value, label]) => ({ value, label }))}
                />
              </Field>
              <Field id="act-notes" label="ملاحظات">
                <Textarea id="act-notes" value={activityForm.notes} onChange={(e) => setActivityForm((f) => ({ ...f, notes: e.target.value }))} />
              </Field>
              <Field id="act-followup" label="تاريخ المتابعة القادم">
                <Input
                  id="act-followup"
                  type="date"
                  value={activityForm.followUpAt}
                  onChange={(e) => setActivityForm((f) => ({ ...f, followUpAt: e.target.value }))}
                />
              </Field>
              <Button type="submit" loading={activityPending}>
                تسجيل النشاط
              </Button>
            </form>
          )}
          <ul className="flex flex-col gap-2">
            {contactActivity.length === 0 && <li style={{ color: "var(--ink-muted)" }}>لا يوجد نشاط مسجّل بعد</li>}
            {contactActivity.map((a) => (
              <li key={a.id} className="rounded-md border p-2 text-sm" style={{ borderColor: "var(--line)" }}>
                <div className="font-bold">{ACTIVITY_KIND_AR[a.kind] ?? a.kind} — {fmtDate(a.occurredAt)}</div>
                {a.notes && <div>{a.notes}</div>}
                {a.followUpAt && <div style={{ color: "var(--ink-muted)" }}>متابعة في: {fmtDate(a.followUpAt)}</div>}
              </li>
            ))}
          </ul>
        </div>
      </Drawer>
    </div>
  );
}
