"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Drawer,
  FormRow,
  Input,
  Select,
  type SelectOption,
} from "@/components/ui";
import { addPlanOperationMulti } from "@/app/(app)/plans/[planId]/actions";

type ItemOpt = { id: string; name: string; unit: string | null };
type PersonOpt = { id: string; name: string };
type MatRow = { key: number; itemId: string; qty: string };
type LabRow = { key: number; team: string; count: string; days: string };

const SUBTYPES: SelectOption[] = [
  { value: "fertilization", label: "تسميد" },
  { value: "irrigation", label: "ري" },
  { value: "spraying", label: "رش" },
  { value: "pollination", label: "تلقيح" },
  { value: "inspection", label: "تفتيش" },
];

/**
 * #398: author an operation with SEVERAL needs (N materials of any kind incl. fuel/gas + N labour lines),
 * a MULTI-DAY span (start + optional end), and ONE-OR-MORE employee assignees with a lead. Submits via
 * addPlanOperationMulti → fn_add_plan_operation_multi (one atomic transaction). RTL/Arabic throughout.
 */
export function OperationBuilder({
  planId,
  items,
  people = [],
}: {
  planId: string;
  items: ItemOpt[];
  people?: PersonOpt[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().split("T")[0];
  const [subtype, setSubtype] = useState("fertilization");
  const [plannedAt, setPlannedAt] = useState(today);
  const [endsOn, setEndsOn] = useState(""); // empty = single-day
  const [estCost, setEstCost] = useState("0");
  const [seq, setSeq] = useState(2);
  const [materials, setMaterials] = useState<MatRow[]>([
    { key: 0, itemId: items[0]?.id ?? "", qty: "" },
  ]);
  const [labor, setLabor] = useState<LabRow[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [leadId, setLeadId] = useState("");

  const itemOptions: SelectOption[] = items.map((i) => ({ value: i.id, label: i.name }));
  const unitOf = (id: string) => items.find((i) => i.id === id)?.unit ?? "kg";
  const nextKey = () => {
    const k = seq;
    setSeq(seq + 1);
    return k;
  };

  function toggleAssignee(id: string) {
    setAssignees((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      if (!next.includes(leadId)) setLeadId(next[0] ?? "");
      return next;
    });
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await addPlanOperationMulti(planId, {
        subtype,
        planned_at: plannedAt,
        ends_on: endsOn || null,
        est_cost: Number(estCost),
        materials: materials
          .filter((m) => m.itemId)
          .map((m) => ({ item_id: m.itemId, qty: Number(m.qty || 0), unit: unitOf(m.itemId) })),
        labor: labor.map((l) => ({
          person_or_team: l.team,
          count: Number(l.count || 0),
          days: Number(l.days || 0),
        })),
        assignee_ids: assignees,
        lead_id: leadId || null,
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error ?? "تعذّر الحفظ");
      }
    } catch {
      // Network-failure handling (non-negotiable #2): a network reject must not strand the
      // spinner. This surfaces a retryable message; the operation is not queued for replay if
      // the device is actually offline.
      setError("تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        إضافة عملية
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        side="end"
        title="إضافة عملية مخطّطة"
        closeLabel="إغلاق"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button variant="primary" loading={pending} onClick={submit}>
              حفظ العملية
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div role="alert" aria-live="assertive" aria-atomic="true">
            {error && <p style={{ color: "var(--danger,#b91c1c)" }}>{error}</p>}
          </div>

          <FormRow id="subtype" label="نوع العملية">
            <Select options={SUBTYPES} value={subtype} onChange={(e) => setSubtype(e.target.value)} />
          </FormRow>

          {/* Multi-day: start + optional end. */}
          <div className="grid grid-cols-2 gap-3">
            <FormRow id="planned_at" label="تاريخ البدء">
              <Input type="date" value={plannedAt} onChange={(e) => setPlannedAt(e.target.value)} />
            </FormRow>
            <FormRow id="ends_on" label="تاريخ الانتهاء (اختياري)">
              <Input
                type="date"
                value={endsOn}
                min={plannedAt}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            </FormRow>
          </div>

          {/* Several material needs — fertilizers, fuel/gas, any item. */}
          <fieldset className="flex flex-col gap-2 rounded-md border p-3" style={{ borderColor: "var(--line,#e5e7eb)" }}>
            <legend className="px-1 text-sm font-semibold">الاحتياجات من الخامات</legend>
            {materials.map((m, idx) => (
              <div key={m.key} className="flex items-end gap-2">
                <div className="flex-1">
                  <FormRow id={`mat-item-${m.key}`} label="الصنف">
                    <Select
                      options={itemOptions}
                      value={m.itemId}
                      onChange={(e) =>
                        setMaterials((p) =>
                          p.map((x) => (x.key === m.key ? { ...x, itemId: e.target.value } : x)),
                        )
                      }
                    />
                  </FormRow>
                </div>
                <div className="w-28">
                  <FormRow id={`mat-qty-${m.key}`} label={`الكمية (${unitOf(m.itemId)})`}>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step="any"
                      value={m.qty}
                      onChange={(e) =>
                        setMaterials((p) =>
                          p.map((x) => (x.key === m.key ? { ...x, qty: e.target.value } : x)),
                        )
                      }
                    />
                  </FormRow>
                </div>
                <Button
                  variant="ghost"
                  aria-label="حذف الخامة"
                  onClick={() => setMaterials((p) => (p.length > 1 ? p.filter((x) => x.key !== m.key) : p))}
                  disabled={materials.length === 1 && idx === 0}
                >
                  ✕
                </Button>
              </div>
            ))}
            <div>
              <Button
                variant="ghost"
                onClick={() => setMaterials((p) => [...p, { key: nextKey(), itemId: items[0]?.id ?? "", qty: "" }])}
              >
                + إضافة خامة
              </Button>
            </div>
          </fieldset>

          {/* Labour needs. */}
          <fieldset className="flex flex-col gap-2 rounded-md border p-3" style={{ borderColor: "var(--line,#e5e7eb)" }}>
            <legend className="px-1 text-sm font-semibold">الاحتياجات من العمالة</legend>
            {labor.map((l) => (
              <div key={l.key} className="flex items-end gap-2">
                <div className="flex-1">
                  <FormRow id={`lab-team-${l.key}`} label="الفريق / العامل">
                    <Input
                      value={l.team}
                      onChange={(e) =>
                        setLabor((p) => p.map((x) => (x.key === l.key ? { ...x, team: e.target.value } : x)))
                      }
                    />
                  </FormRow>
                </div>
                <div className="w-20">
                  <FormRow id={`lab-count-${l.key}`} label="العدد">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={l.count}
                      onChange={(e) =>
                        setLabor((p) => p.map((x) => (x.key === l.key ? { ...x, count: e.target.value } : x)))
                      }
                    />
                  </FormRow>
                </div>
                <div className="w-20">
                  <FormRow id={`lab-days-${l.key}`} label="الأيام">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step="any"
                      value={l.days}
                      onChange={(e) =>
                        setLabor((p) => p.map((x) => (x.key === l.key ? { ...x, days: e.target.value } : x)))
                      }
                    />
                  </FormRow>
                </div>
                <Button variant="ghost" aria-label="حذف العمالة" onClick={() => setLabor((p) => p.filter((x) => x.key !== l.key))}>
                  ✕
                </Button>
              </div>
            ))}
            <div>
              <Button
                variant="ghost"
                onClick={() => setLabor((p) => [...p, { key: nextKey(), team: "", count: "", days: "" }])}
              >
                + إضافة عمالة
              </Button>
            </div>
          </fieldset>

          {/* Assignees: one or more employees, with a lead. */}
          {people.length > 0 && (
            <fieldset className="flex flex-col gap-2 rounded-md border p-3" style={{ borderColor: "var(--line,#e5e7eb)" }}>
              <legend className="px-1 text-sm font-semibold">المكلّفون</legend>
              <div className="flex flex-col gap-1">
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={assignees.includes(p.id)}
                      onChange={() => toggleAssignee(p.id)}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
              {assignees.length > 0 && (
                <FormRow id="lead" label="المسؤول الرئيسي">
                  <Select
                    options={people
                      .filter((p) => assignees.includes(p.id))
                      .map((p) => ({ value: p.id, label: p.name }))}
                    value={leadId}
                    onChange={(e) => setLeadId(e.target.value)}
                  />
                </FormRow>
              )}
            </fieldset>
          )}

          <FormRow id="cost" label="التكلفة التقديرية (ج.م)">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={estCost}
              onChange={(e) => setEstCost(e.target.value)}
            />
          </FormRow>
        </div>
      </Drawer>
    </>
  );
}
