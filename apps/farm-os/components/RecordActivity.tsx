"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  Button,
  Alert,
  FormRow,
  Input,
  Textarea,
  Select,
  StatusPill,
  EmptyState,
  type SelectOption,
} from "@/components/ui";
import { recordEvent, setEventStatus } from "@/app/(app)/farm/event-actions";

export interface ActivityItem {
  id: string;
  title: string;
  status: string;
  time: string;
}

const TYPE_OPTIONS: SelectOption[] = [
  { value: "operation", label: "عملية" },
  { value: "inspection", label: "تفتيش" },
  { value: "issue", label: "ملاحظة/مشكلة" },
  { value: "note", label: "مذكرة" },
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: "done", label: "منفّذة" },
  { value: "planned", label: "مخطّطة" },
  { value: "in_progress", label: "قيد التنفيذ" },
];

const STATUS_AR: Record<string, string> = {
  planned: "مخطّطة",
  in_progress: "قيد التنفيذ",
  done: "منفّذة",
  blocked: "محظورة",
  abandoned: "ملغاة",
  skipped: "متخطّاة",
};

function pill(s: string): "active" | "done" | "scheduled" {
  if (s === "done") return "done";
  if (s === "planned") return "scheduled";
  return "active";
}

/**
 * Record an activity (operation / inspection / issue / note) against a structure node and list the
 * node's recent activities with a "mark done" action — STAGE 3. Writes go through the op.execute-gated
 * RPCs (fn_record_event / fn_set_event_status); the DB is the gate, this only collects input.
 */
export function RecordActivity({
  locationType,
  locationId,
  canRecord,
  activities,
}: {
  locationType: "farm" | "sector" | "hawsha" | "line" | "palm";
  locationId: string;
  canRecord: boolean;
  activities: ActivityItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState("operation");
  const [subtype, setSubtype] = useState("");
  const [status, setStatus] = useState("done");
  const [note, setNote] = useState("");
  const [qtyValue, setQtyValue] = useState("");
  const [qtyLabel, setQtyLabel] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const qv = qtyValue.trim() === "" ? null : Number(qtyValue);
    if (qv != null && (!Number.isFinite(qv) || qv <= 0)) {
      setPending(false);
      setError("القيمة يجب أن تكون رقمًا أكبر من صفر");
      return;
    }
    const res = await recordEvent({
      locationType,
      locationId,
      type: type as "operation" | "inspection" | "issue" | "note",
      subtype: subtype.trim() || null,
      status,
      note: note.trim() || null,
      qtyValue: qv,
      qtyMeasure: qv != null ? "count" : null,
      qtyLabel: qtyLabel.trim() || null,
    });
    setPending(false);
    if (res.ok) {
      setSubtype("");
      setNote("");
      setQtyValue("");
      setQtyLabel("");
      setOpen(false);
      router.refresh();
    } else {
      setError(res.error ?? "تعذّر تسجيل النشاط");
    }
  }

  async function markDone(id: string) {
    setBusyId(id);
    setError(null);
    const res = await setEventStatus(id, "done");
    setBusyId(null);
    if (res.ok) router.refresh();
    else setError(res.error ?? "تعذّر تحديث الحالة");
  }

  return (
    <Card title="الأنشطة">
      <div className="flex flex-col gap-4">
        <div aria-live="assertive" aria-atomic="true">
          {error && <Alert tone="danger" title={error} />}
        </div>

        {canRecord &&
          (open ? (
            <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-[var(--color-border,#e5e7eb)] p-3">
              <FormRow id="ev-type" label="النوع">
                <Select options={TYPE_OPTIONS} value={type} onChange={(e) => setType(e.target.value)} />
              </FormRow>
              <FormRow id="ev-subtype" label="التفصيل (مثل: ري، رش)">
                <Input value={subtype} onChange={(e) => setSubtype(e.target.value)} maxLength={60} />
              </FormRow>
              <FormRow id="ev-status" label="الحالة">
                <Select options={STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value)} />
              </FormRow>
              <FormRow id="ev-note" label="ملاحظات">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </FormRow>
              <div className="grid grid-cols-2 gap-2">
                <FormRow id="ev-qty" label="قيمة (اختياري)">
                  <Input type="number" min={0} step="any" value={qtyValue} inputMode="decimal" onChange={(e) => setQtyValue(e.target.value)} />
                </FormRow>
                <FormRow id="ev-qtylabel" label="الوحدة">
                  <Input value={qtyLabel} onChange={(e) => setQtyLabel(e.target.value)} maxLength={40} />
                </FormRow>
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" loading={pending}>حفظ النشاط</Button>
                <Button type="button" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>إلغاء</Button>
              </div>
            </form>
          ) : (
            <Button variant="primary" onClick={() => setOpen(true)}>تسجيل نشاط</Button>
          ))}

        {activities.length === 0 ? (
          <EmptyState title="لا توجد أنشطة مسجّلة بعد" />
        ) : (
          <ul className="flex flex-col gap-2">
            {activities.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border,#e5e7eb)] p-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{a.title}</div>
                  <div className="text-xs opacity-70">{a.time}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={pill(a.status)}>{STATUS_AR[a.status] ?? "غير معروف"}</StatusPill>
                  {canRecord && a.status !== "done" && (
                    <Button variant="ghost" loading={busyId === a.id} onClick={() => markDone(a.id)}>
                      إنهاء
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
