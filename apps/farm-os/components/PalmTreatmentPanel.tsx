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
  EmptyState,
  FileTimeline,
  type SelectOption,
  type TimelineEvent,
} from "@/components/ui";
import { logPalmTreatment } from "@/app/(app)/farm/palm/[id]/actions";
import { SUBTYPE_AR } from "@/lib/labels";

// The SET of subtypes relevant to a quick individual-palm rescue treatment. Reuses the existing
// operation-subtype vocabulary (fertilization/irrigation/inspection fit; spraying/pollination are
// block-program-shaped, not per-tree exceptions, so they're intentionally left off this SHORT list —
// they remain available via the full OperationBuilder). PR #543 (feat/operation-vocabulary, not yet
// merged at the time of writing) will introduce a fuller subtype vocabulary incl. a dedicated
// individual-treatment subtype; once merged, this SET should be revisited to offer it.
const TREATMENT_SUBTYPES: SelectOption[] = [
  { value: "fertilization", label: SUBTYPE_AR.fertilization },
  { value: "irrigation", label: SUBTYPE_AR.irrigation },
  { value: "inspection", label: SUBTYPE_AR.inspection },
];

export interface PalmTreatmentItem {
  id: string;
  name: string;
  unit: string | null;
}

export interface PalmTreatmentEvent {
  id: string;
  subtype: string | null;
  status: string;
  plannedAt: string | null;
  note: string | null;
}

function toTimelineEvents(treatments: PalmTreatmentEvent[]): TimelineEvent[] {
  return treatments.map((t) => ({
    id: t.id,
    kind: "operation",
    title: t.subtype ? SUBTYPE_AR[t.subtype] ?? "معالجة" : "معالجة",
    time: t.plannedAt ?? "—",
    description: t.note ?? "—",
  }));
}

/**
 * A LIGHTWEIGHT "log a treatment" affordance for one struggling palm — distinct from (and much
 * simpler than) the full plan/operation authoring wizard (OperationBuilder): one subtype, one date,
 * a free-text note, and AT MOST ONE material line (never a multi-material builder). Submits via
 * logPalmTreatment → the EXISTING fn_add_plan_operation_multi RPC with target_type='palm' (no new
 * operation-creation RPC — see migration 20260701340000's header). Also renders this palm's past
 * individual treatments (plan_operations where target_type='palm' AND target_id=this palm) as a
 * simple timeline, reusing the existing FileTimeline component (same pattern as the status-history
 * tab on this page). An empty history renders an honest EmptyState — never fabricated rows.
 */
export function PalmTreatmentPanel({
  assetId,
  items,
  canRecord,
  treatments,
}: {
  assetId: string;
  items: PalmTreatmentItem[];
  canRecord: boolean;
  treatments: PalmTreatmentEvent[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const today = new Date().toISOString().split("T")[0];
  const [subtype, setSubtype] = useState("inspection");
  const [plannedAt, setPlannedAt] = useState(today);
  const [note, setNote] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");

  const itemOptions: SelectOption[] = [
    { value: "", label: "بدون خامة" },
    ...items.map((i) => ({ value: i.id, label: i.name })),
  ];
  const unitOf = (id: string) => items.find((i) => i.id === id)?.unit ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setDone(false);
    try {
      const res = await logPalmTreatment(assetId, {
        subtype,
        planned_at: plannedAt,
        note,
        item_id: itemId || null,
        qty: itemId ? Number(qty || 0) : null,
        unit: itemId ? unitOf(itemId) : null,
      });
      if (res.ok) {
        setDone(true);
        setNote("");
        setItemId("");
        setQty("");
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error ?? "تعذّر تسجيل المعالجة");
      }
    } catch {
      // Field PWA is offline-tolerant (non-negotiable #2): a dropped connection rejects the
      // server-action fetch, so without this catch the spinner would hang forever.
      setError("تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card title="معالجة فردية للنخلة">
      <div className="flex flex-col gap-4">
        <div aria-live="assertive" aria-atomic="true">
          {error && <Alert tone="danger" title={error} />}
          {done && <Alert tone="ok" title="تم تسجيل المعالجة" />}
        </div>

        {canRecord &&
          (open ? (
            <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-[var(--color-border,#e5e7eb)] p-3">
              <FormRow id="treat-subtype" label="نوع المعالجة">
                <Select
                  options={TREATMENT_SUBTYPES}
                  value={subtype}
                  onChange={(e) => setSubtype(e.target.value)}
                />
              </FormRow>
              <FormRow id="treat-date" label="التاريخ">
                <Input type="date" value={plannedAt} onChange={(e) => setPlannedAt(e.target.value)} />
              </FormRow>
              <FormRow id="treat-note" label="ملاحظة">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  placeholder="مثال: نخلة ضعيفة - معالجة بمنشط جذور"
                />
              </FormRow>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <FormRow id="treat-item" label="الخامة المستخدمة (اختياري)">
                    <Select
                      options={itemOptions}
                      value={itemId}
                      onChange={(e) => {
                        setItemId(e.target.value);
                        if (!e.target.value) setQty("");
                      }}
                    />
                  </FormRow>
                </div>
                {itemId && (
                  <div className="w-28">
                    <FormRow id="treat-qty" label={`الكمية${unitOf(itemId) ? ` (${unitOf(itemId)})` : ""}`}>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                      />
                    </FormRow>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" loading={pending}>
                  حفظ المعالجة
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>
                  إلغاء
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="primary" onClick={() => setOpen(true)}>
              تسجيل معالجة فردية
            </Button>
          ))}

        {treatments.length === 0 ? (
          <EmptyState title="لا توجد معالجات فردية مسجّلة لهذه النخلة بعد" />
        ) : (
          <FileTimeline events={toTimelineEvents(treatments)} ariaLabel="سجل المعالجات الفردية" />
        )}
      </div>
    </Card>
  );
}
