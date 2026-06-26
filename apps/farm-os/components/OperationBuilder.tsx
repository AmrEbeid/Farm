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
import { addPlanOperation } from "@/app/(app)/plans/[planId]/actions";

export function OperationBuilder({
  planId,
  items,
}: {
  planId: string;
  items: { id: string; name: string; unit: string | null }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [subtype, setSubtype] = useState("fertilization");
  const [plannedAt, setPlannedAt] = useState("2025-07-08");
  const [estCost, setEstCost] = useState("42000");
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [qty, setQty] = useState("500");

  const subtypeOptions: SelectOption[] = [
    { value: "fertilization", label: "تسميد" },
    { value: "irrigation", label: "ري" },
    { value: "spraying", label: "رش" },
    { value: "pollination", label: "تلقيح" },
    { value: "inspection", label: "تفتيش" },
  ];
  const itemOptions: SelectOption[] = items.map((i) => ({ value: i.id, label: i.name }));
  const unit = items.find((i) => i.id === itemId)?.unit ?? "kg";

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await addPlanOperation(planId, {
        subtype,
        planned_at: plannedAt,
        est_cost: Number(estCost),
        item_id: itemId,
        material_qty: Number(qty),
        material_unit: unit,
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error ?? "تعذّر الحفظ");
      }
    } catch {
      // Offline-tolerant (non-negotiable #2): a network reject must not strand the spinner —
      // surface a retryable Arabic message (mirrors ExecuteForm).
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
            <Select
              options={subtypeOptions}
              value={subtype}
              onChange={(e) => setSubtype(e.target.value)}
            />
          </FormRow>
          <FormRow id="planned_at" label="التاريخ المخطّط">
            <Input type="date" value={plannedAt} onChange={(e) => setPlannedAt(e.target.value)} />
          </FormRow>
          <FormRow id="item" label="الصنف المطلوب">
            <Select
              options={itemOptions}
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
            />
          </FormRow>
          <FormRow id="qty" label={`الكمية (${unit})`}>
            <Input
              type="number"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </FormRow>
          <FormRow id="cost" label="التكلفة التقديرية (ج.م)">
            <Input
              type="number"
              inputMode="numeric"
              value={estCost}
              onChange={(e) => setEstCost(e.target.value)}
            />
          </FormRow>
        </div>
      </Drawer>
    </>
  );
}
