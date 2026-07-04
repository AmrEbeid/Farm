"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { OFFSHOOT_TYPE_AR, type OffshootMovementType } from "@/lib/offshoot-bank";
import { recordOffshootMovement, setOffshootValuation } from "@/app/(app)/farm/offshoots/actions";

export interface OffshootCostCenterOption {
  id: string;
  label: string;
  isLeaf: boolean;
  isSystem: boolean;
  active: boolean;
}

type Msg = { tone: "ok" | "danger"; text: string } | null;

const MOVEMENT_TYPES: OffshootMovementType[] = ["produce", "plant", "replant", "sell"];

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function OffshootMovementForm({ centers }: { centers: OffshootCostCenterOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const { pending, submit } = useSubmit();
  const [msg, setMsg] = useState<Msg>(null);
  const [movementType, setMovementType] = useState<OffshootMovementType>("produce");
  const [qty, setQty] = useState("");
  const [movementDate, setMovementDate] = useState("");
  const [sourceCostCenterId, setSourceCostCenterId] = useState("");
  const [destCostCenterId, setDestCostCenterId] = useState("");
  const [note, setNote] = useState("");
  const destinationRequired = movementType === "plant" || movementType === "replant";
  const sourceOptions = centers.filter((center) => center.active);
  const destinationOptions = centers.filter((center) => center.active && center.isLeaf && !center.isSystem);

  async function save() {
    const result = await submit(() =>
      recordOffshootMovement({
        movementType,
        qty: Number(qty),
        movementDate: movementDate || null,
        sourceCostCenterId: sourceCostCenterId || null,
        destCostCenterId: destinationRequired ? destCostCenterId || null : null,
        note: note || null,
      }),
    );
    if (result.ok) {
      setMsg({ tone: "ok", text: "تم تسجيل حركة الفسائل" });
      setQty("");
      setNote("");
      toast.ok("تم تسجيل حركة الفسائل");
      router.refresh();
    } else {
      setMsg({ tone: "danger", text: result.error ?? "تعذّر تسجيل الحركة" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {msg && <Alert tone={msg.tone} title={msg.text} />}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="نوع الحركة" id="offshoot-type">
          <Select
            id="offshoot-type"
            value={movementType}
            onChange={(e) => setMovementType(e.target.value as OffshootMovementType)}
            options={MOVEMENT_TYPES.map((type) => ({ value: type, label: OFFSHOOT_TYPE_AR[type] }))}
          />
        </Field>
        <Field label="الكمية" id="offshoot-qty">
          <Input
            id="offshoot-qty"
            type="number"
            inputMode="decimal"
            min={0}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </Field>
        <Field label="التاريخ" id="offshoot-date">
          <Input id="offshoot-date" type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} />
        </Field>
        <Field label="مركز المصدر" id="offshoot-source">
          <Select
            id="offshoot-source"
            value={sourceCostCenterId}
            onChange={(e) => setSourceCostCenterId(e.target.value)}
            options={[
              { value: "", label: "—" },
              ...sourceOptions.map((center) => ({ value: center.id, label: center.label })),
            ]}
          />
        </Field>
        <Field label="مركز الوجهة" id="offshoot-dest">
          <Select
            id="offshoot-dest"
            value={destCostCenterId}
            onChange={(e) => setDestCostCenterId(e.target.value)}
            disabled={!destinationRequired}
            options={[
              { value: "", label: "—" },
              ...destinationOptions.map((center) => ({ value: center.id, label: center.label })),
            ]}
          />
        </Field>
        <Field label="ملاحظة" id="offshoot-note">
          <Textarea id="offshoot-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} rows={3} />
        </Field>
      </div>
      <div>
        <Button disabled={pending || !qty || (destinationRequired && !destCostCenterId)} onClick={save}>
          {pending ? "جارٍ الحفظ…" : "تسجيل الحركة"}
        </Button>
      </div>
    </div>
  );
}

export function OffshootValuationForm({
  lowPerUnit,
  highPerUnit,
}: {
  lowPerUnit: number | null;
  highPerUnit: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const { pending, submit } = useSubmit();
  const [msg, setMsg] = useState<Msg>(null);
  const [low, setLow] = useState(lowPerUnit == null ? "" : String(lowPerUnit));
  const [high, setHigh] = useState(highPerUnit == null ? "" : String(highPerUnit));

  async function save() {
    const result = await submit(() =>
      setOffshootValuation({
        lowPerUnit: numberOrNull(low),
        highPerUnit: numberOrNull(high),
      }),
    );
    if (result.ok) {
      setMsg({ tone: "ok", text: "تم حفظ تقييم الفسائل" });
      toast.ok("تم حفظ تقييم الفسائل");
      router.refresh();
    } else {
      setMsg({ tone: "danger", text: result.error ?? "تعذّر حفظ التقييم" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {msg && <Alert tone={msg.tone} title={msg.text} />}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="حد أدنى للوحدة (ج.م)" id="offshoot-low">
          <Input id="offshoot-low" type="number" inputMode="decimal" min={0} value={low} onChange={(e) => setLow(e.target.value)} />
        </Field>
        <Field label="حد أعلى للوحدة (ج.م)" id="offshoot-high">
          <Input id="offshoot-high" type="number" inputMode="decimal" min={0} value={high} onChange={(e) => setHigh(e.target.value)} />
        </Field>
      </div>
      <div>
        <Button disabled={pending} onClick={save}>{pending ? "جارٍ الحفظ…" : "حفظ التقييم"}</Button>
      </div>
    </div>
  );
}
