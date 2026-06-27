"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Alert, FormRow, Input, Textarea, Select, Card } from "@/components/ui";
import {
  saveSector,
  saveHawsha,
  saveLine,
  savePalm,
} from "@/app/(app)/farm/structure-actions";

export type StructureLevel = "sector" | "hawsha" | "line" | "palm";

const LEVEL_AR: Record<StructureLevel, string> = {
  sector: "القطاع",
  hawsha: "الحوشة",
  line: "الخط",
  palm: "النخلة",
};

export interface StructureContext {
  farmId?: string;
  sectorId?: string;
  hawshaId?: string;
  lineId?: string;
}

export interface StructureInitial {
  id?: string;
  name?: string | null;
  code?: string | null;
  crop?: string | null;
  areaFeddan?: number | null;
  areaQirat?: number | null;
  rowCount?: number | null;
  palmCountBarhi?: number | null;
  palmCountMale?: number | null;
  lineNo?: number | null;
  lineCode?: string | null;
  palmCount?: number | null;
  direction?: string | null;
  variety?: string | null;
  sex?: string | null;
  idTag?: string | null;
  plantingDate?: string | null;
  healthStatus?: string | null;
  notes?: string | null;
}

function numOrNull(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Create/edit form for any structure level (sub-farm/hawsha/line/palm). Rendered as a toggle button
 * that reveals an inline form — used both for "add a child" (mode=create with parent context) and
 * "edit this node" (mode=edit with initial values). On success it refreshes the server-rendered page.
 * The DB RPC is the gate; this only collects fields.
 */
export function StructureForm({
  level,
  mode,
  context = {},
  initial = {},
  triggerLabel,
  triggerVariant = "ghost",
}: {
  level: StructureLevel;
  mode: "create" | "edit";
  context?: StructureContext;
  initial?: StructureInitial;
  triggerLabel: string;
  triggerVariant?: "primary" | "ghost";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<StructureInitial>(initial);

  function set<K extends keyof StructureInitial>(key: K, value: StructureInitial[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    let res: { ok: boolean; error?: string };
    if (level === "sector") {
      res = await saveSector({
        id: mode === "edit" ? initial.id : null,
        farmId: context.farmId ?? null,
        name: (f.name ?? "").trim(),
        code: (f.code ?? "").trim(),
        crop: f.crop ?? null,
        areaFeddan: f.areaFeddan ?? null,
        plantingDate: f.plantingDate || null,
        notes: f.notes ?? null,
      });
    } else if (level === "hawsha") {
      res = await saveHawsha({
        id: mode === "edit" ? initial.id : null,
        sectorId: context.sectorId ?? null,
        name: (f.name ?? "").trim(),
        code: (f.code ?? "").trim(),
        areaQirat: f.areaQirat ?? null,
        rowCount: f.rowCount ?? null,
        palmCountBarhi: f.palmCountBarhi ?? null,
        palmCountMale: f.palmCountMale ?? null,
        plantingDate: f.plantingDate || null,
        notes: f.notes ?? null,
      });
    } else if (level === "line") {
      res = await saveLine({
        id: mode === "edit" ? initial.id : null,
        hawshaId: context.hawshaId ?? null,
        lineNo: f.lineNo ?? 0,
        lineCode: f.lineCode ?? null,
        palmCount: f.palmCount ?? null,
        direction: f.direction ?? null,
        notes: f.notes ?? null,
      });
    } else {
      res = await savePalm({
        id: mode === "edit" ? initial.id : null,
        hawshaId: context.hawshaId ?? null,
        lineId: context.lineId ?? null,
        name: f.name ?? null,
        variety: f.variety ?? null,
        sex: f.sex || null,
        idTag: f.idTag ?? null,
        plantingDate: f.plantingDate || null,
        healthStatus: f.healthStatus ?? null,
      });
    }
    setPending(false);
    if (res.ok) {
      if (mode === "create") setF({});
      setOpen(false);
      router.refresh();
    } else {
      setError(res.error ?? "تعذّر الحفظ");
    }
  }

  if (!open) {
    return (
      <Button variant={triggerVariant} onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
    );
  }

  const title =
    mode === "create" ? `إضافة ${LEVEL_AR[level]}` : `تعديل ${LEVEL_AR[level]}`;

  return (
    <Card title={title}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div aria-live="assertive" aria-atomic="true">
          {error && <Alert tone="danger" title={error} />}
        </div>

        {level !== "line" && level !== "palm" && (
          <>
            <FormRow id="sf-name" label="الاسم">
              <Input value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} maxLength={120} required />
            </FormRow>
            <FormRow id="sf-code" label="الرمز">
              <Input value={f.code ?? ""} onChange={(e) => set("code", e.target.value)} maxLength={40} required />
            </FormRow>
          </>
        )}

        {level === "sector" && (
          <>
            <FormRow id="sf-crop" label="المحصول">
              <Input value={f.crop ?? ""} onChange={(e) => set("crop", e.target.value)} maxLength={60} />
            </FormRow>
            <FormRow id="sf-area" label="المساحة (فدان)">
              <Input value={f.areaFeddan ?? ""} inputMode="decimal"
                onChange={(e) => set("areaFeddan", numOrNull(e.target.value))} />
            </FormRow>
          </>
        )}

        {level === "hawsha" && (
          <>
            <FormRow id="sf-areaq" label="المساحة (قيراط)">
              <Input value={f.areaQirat ?? ""} inputMode="decimal"
                onChange={(e) => set("areaQirat", numOrNull(e.target.value))} />
            </FormRow>
            <FormRow id="sf-rows" label="عدد الصفوف">
              <Input value={f.rowCount ?? ""} inputMode="numeric"
                onChange={(e) => set("rowCount", numOrNull(e.target.value))} />
            </FormRow>
            <FormRow id="sf-barhi" label="نخيل برحي">
              <Input value={f.palmCountBarhi ?? ""} inputMode="numeric"
                onChange={(e) => set("palmCountBarhi", numOrNull(e.target.value))} />
            </FormRow>
            <FormRow id="sf-male" label="ذكور">
              <Input value={f.palmCountMale ?? ""} inputMode="numeric"
                onChange={(e) => set("palmCountMale", numOrNull(e.target.value))} />
            </FormRow>
          </>
        )}

        {level === "line" && (
          <>
            <FormRow id="sf-lineno" label="رقم الخط">
              <Input value={f.lineNo ?? ""} inputMode="numeric" required
                onChange={(e) => set("lineNo", numOrNull(e.target.value))} />
            </FormRow>
            <FormRow id="sf-linecode" label="رمز الخط">
              <Input value={f.lineCode ?? ""} onChange={(e) => set("lineCode", e.target.value)} maxLength={40} />
            </FormRow>
            <FormRow id="sf-palmcount" label="عدد النخيل">
              <Input value={f.palmCount ?? ""} inputMode="numeric"
                onChange={(e) => set("palmCount", numOrNull(e.target.value))} />
            </FormRow>
            <FormRow id="sf-direction" label="الاتجاه">
              <Input value={f.direction ?? ""} onChange={(e) => set("direction", e.target.value)} maxLength={40} />
            </FormRow>
          </>
        )}

        {level === "palm" && (
          <>
            <FormRow id="sf-pname" label="الاسم">
              <Input value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} maxLength={120} />
            </FormRow>
            <FormRow id="sf-tag" label="الرمز (Tag)">
              <Input value={f.idTag ?? ""} onChange={(e) => set("idTag", e.target.value)} maxLength={60} />
            </FormRow>
            <FormRow id="sf-variety" label="الصنف">
              <Input value={f.variety ?? ""} onChange={(e) => set("variety", e.target.value)} maxLength={60} />
            </FormRow>
            <FormRow id="sf-sex" label="النوع">
              <Select
                value={f.sex ?? ""}
                onChange={(e) => set("sex", e.target.value)}
                options={[
                  { value: "", label: "—" },
                  { value: "female", label: "أنثى" },
                  { value: "male", label: "ذكر" },
                ]}
              />
            </FormRow>
            <FormRow id="sf-health" label="الحالة الصحية">
              <Input value={f.healthStatus ?? ""} onChange={(e) => set("healthStatus", e.target.value)} maxLength={60} />
            </FormRow>
          </>
        )}

        {level !== "palm" && (
          <FormRow id="sf-planting" label="تاريخ الزراعة">
            <Input type="date" value={f.plantingDate ?? ""} onChange={(e) => set("plantingDate", e.target.value)} />
          </FormRow>
        )}
        {level === "palm" && (
          <FormRow id="sf-pplanting" label="تاريخ الزراعة">
            <Input type="date" value={f.plantingDate ?? ""} onChange={(e) => set("plantingDate", e.target.value)} />
          </FormRow>
        )}

        {level !== "palm" && (
          <FormRow id="sf-notes" label="ملاحظات">
            <Textarea value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={500} />
          </FormRow>
        )}

        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={pending}>حفظ</Button>
          <Button type="button" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>إلغاء</Button>
        </div>
      </form>
    </Card>
  );
}
