"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { LineItemsEditor, type LineState } from "@/components/LineItemsEditor";
import { SUBTYPE_AR } from "@/lib/labels";
import { createPlan } from "@/app/(app)/plans/plans-actions";
import { addPlanOperationMulti } from "@/app/(app)/plans/[planId]/actions";

// SPEC-0025 U-7 — the plan wizard (Owner follow-up §2b.3): the farm manager builds a weekly/monthly plan
// for the WHOLE farm or one part (قطاع/حوش) as LINES — each line is an operation (تسميد، ري، رش…) with its
// details in the row, added/removed freely, then saved line-by-line through the LIVE atomic RPCs
// (fn_create_plan + fn_add_plan_operation_multi). Pure UI — no new backend.

interface OpLine extends LineState {
  subtype: string;
  from: string;
  to: string;
  itemId: string;
  qty: string;
  laborType: string;
  workers: string;
  days: string;
}

const emptyLine = (): OpLine => ({
  subtype: "fertilization",
  from: "",
  to: "",
  itemId: "",
  qty: "",
  laborType: "",
  workers: "",
  days: "1",
});

const sel = "w-full rounded-md px-2 py-1.5 text-sm";
const selStyle = { border: "1px solid var(--line, rgba(0,0,0,0.15))", background: "var(--surface, #fff)" } as const;

export function PlanWizard({
  sectors,
  hawshat,
  items,
  initialPlanId = null,
}: {
  sectors: { id: string; name: string }[];
  hawshat: { id: string; name: string; sectorId: string }[];
  items: { id: string; name: string; unit: string }[];
  /** SPEC-0026 P-1: open directly on step 2 to add operation LINES to an EXISTING plan. */
  initialPlanId?: string | null;
}) {
  const [step, setStep] = useState(initialPlanId ? 2 : 1);
  const [type, setType] = useState<"weekly" | "monthly">("weekly");
  const [scopeType, setScopeType] = useState<"farm" | "sector" | "hawsha">("farm");
  const [scopeId, setScopeId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [planId, setPlanId] = useState<string | null>(initialPlanId);
  const [lines, setLines] = useState<OpLine[]>([emptyLine()]);
  const [msg, setMsg] = useState<string | null>(null);
  const { pending, submit } = useSubmit();

  const scopeOptions = scopeType === "sector" ? sectors : scopeType === "hawsha" ? hawshat : [];

  async function onCreatePlan() {
    setMsg(null);
    const r = await submit(() =>
      createPlan({
        type,
        periodStart: start || null,
        periodEnd: end || null,
        scopeType,
        scopeId: scopeType === "farm" ? null : scopeId || null,
      }),
    );
    if (r.ok && r.data) {
      setPlanId(r.data);
      setStep(2);
    } else setMsg(("error" in r && r.error) || "تعذّر إنشاء الخطة");
  }

  function setLine(i: number, patch: Partial<OpLine>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function saveLine(i: number) {
    if (!planId) return;
    const l = lines[i];
    const item = items.find((it) => it.id === l.itemId);
    const materials = item && Number(l.qty) > 0 ? [{ item_id: item.id, qty: Number(l.qty), unit: item.unit }] : [];
    const labor =
      l.laborType.trim() && Number(l.workers) > 0
        ? [{ person_or_team: l.laborType.trim(), count: Number(l.workers), days: Math.max(1, Number(l.days) || 1) }]
        : [];
    if (!l.from) return setLine(i, { error: "حدّد تاريخ البدء" });
    if (materials.length === 0 && labor.length === 0)
      return setLine(i, { error: "أضِف على الأقل مادة (صنف + كمية) أو عمالة (نوع + عدد)" });
    setLine(i, { error: null });
    const r = await submit(() =>
      addPlanOperationMulti(planId, {
        subtype: l.subtype,
        planned_at: l.from,
        ends_on: l.to || null,
        est_cost: 0,
        materials,
        labor,
        assignee_ids: [],
        lead_id: null,
      }),
    );
    if (r.ok) setLine(i, { saved: true, error: null });
    else setLine(i, { error: r.error ?? "تعذّر حفظ السطر" });
  }

  if (step === 1) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <header>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>خطة جديدة</h1>
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>الخطوة 1 من 2 — لأي فترة وأي جزء من المزرعة؟</p>
        </header>
        {msg && <Alert tone="danger" title={msg} />}
        <Card>
          <div className="flex flex-col gap-3 p-1">
            <Field label="نوع الخطة" id="p-type">
              <select id="p-type" className={sel} style={selStyle} value={type} onChange={(e) => setType(e.target.value as "weekly" | "monthly")}>
                <option value="weekly">أسبوعية</option>
                <option value="monthly">شهرية</option>
              </select>
            </Field>
            <Field label="نطاق الخطة" id="p-scope">
              <select id="p-scope" className={sel} style={selStyle} value={scopeType}
                onChange={(e) => { setScopeType(e.target.value as "farm" | "sector" | "hawsha"); setScopeId(""); }}>
                <option value="farm">المزرعة كلها</option>
                <option value="sector">قطاع محدد</option>
                <option value="hawsha">حوش محدد</option>
              </select>
            </Field>
            {scopeType !== "farm" && (
              <Field label={scopeType === "sector" ? "اختر القطاع" : "اختر الحوش"} id="p-scope-id">
                <select id="p-scope-id" className={sel} style={selStyle} value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
                  <option value="">— اختر —</option>
                  {scopeOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="من" id="p-start"><Input id="p-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label="إلى" id="p-end"><Input id="p-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
            </div>
            <div>
              <Button onClick={onCreatePlan} disabled={pending || (scopeType !== "farm" && !scopeId)}>
                {pending ? "جارٍ الإنشاء…" : "أنشئ الخطة وأضِف العمليات ←"}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const savedCount = lines.filter((l) => l.saved).length;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>عمليات الخطة</h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          الخطوة 2 من 2 — أضِف سطرًا لكل عملية (تسميد، ري، رش…) بتفاصيله، بعدد ما تريد. حُفظ {savedCount} من {lines.length}.
        </p>
      </header>
      <LineItemsEditor<OpLine>
        lines={lines}
        pending={pending}
        onAdd={() => setLines((ls) => [...ls, emptyLine()])}
        onRemove={(i) => setLines((ls) => ls.filter((_, j) => j !== i))}
        onSaveLine={saveLine}
        addLabel="+ سطر عملية آخر"
        renderLine={(l, i) => (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="العملية" id={`l-${i}-sub`}>
                <select id={`l-${i}-sub`} className={sel} style={selStyle} value={l.subtype} disabled={l.saved}
                  onChange={(e) => setLine(i, { subtype: e.target.value })}>
                  {Object.entries(SUBTYPE_AR).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="من" id={`l-${i}-from`}>
                <Input id={`l-${i}-from`} type="date" value={l.from} disabled={l.saved} onChange={(e) => setLine(i, { from: e.target.value })} />
              </Field>
              <Field label="إلى (اختياري)" id={`l-${i}-to`}>
                <Input id={`l-${i}-to`} type="date" value={l.to} disabled={l.saved} onChange={(e) => setLine(i, { to: e.target.value })} />
              </Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="الصنف (اختياري)" id={`l-${i}-item`}>
                <select id={`l-${i}-item`} className={sel} style={selStyle} value={l.itemId} disabled={l.saved}
                  onChange={(e) => setLine(i, { itemId: e.target.value })}>
                  <option value="">— بدون مواد —</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>{it.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="الكمية" id={`l-${i}-qty`}>
                <Input id={`l-${i}-qty`} type="number" min={0} value={l.qty} disabled={l.saved} onChange={(e) => setLine(i, { qty: e.target.value })} />
              </Field>
              <Field label="العمالة (مثال: رشّاشون)" id={`l-${i}-lab`}>
                <Input id={`l-${i}-lab`} value={l.laborType} disabled={l.saved} onChange={(e) => setLine(i, { laborType: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="عدد" id={`l-${i}-w`}>
                  <Input id={`l-${i}-w`} type="number" min={0} value={l.workers} disabled={l.saved} onChange={(e) => setLine(i, { workers: e.target.value })} />
                </Field>
                <Field label="أيام" id={`l-${i}-d`}>
                  <Input id={`l-${i}-d`} type="number" min={1} value={l.days} disabled={l.saved} onChange={(e) => setLine(i, { days: e.target.value })} />
                </Field>
              </div>
            </div>
          </>
        )}
      />
      <div className="flex flex-wrap gap-2">
        {planId && (
          <Link href={`/plans/${planId}`} className="inline-block">
            <Button>إنهاء وفتح الخطة ←</Button>
          </Link>
        )}
      </div>
    </div>
  );
}
