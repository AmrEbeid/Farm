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
import {
  addPlanOperationMulti,
  setPlanOperationDependency,
  type HarvestStage,
} from "@/app/(app)/plans/[planId]/actions";
import { computeEffectiveDate, formatDependencyLabel } from "@/lib/relative-schedule";
import { HARVEST_STAGE_AR, SUBTYPE_AR } from "@/lib/labels";
import { TARGET_ZONE_AR, TIME_OF_DAY_AR } from "@/lib/spray-compliance";

type ItemOpt = { id: string; name: string; unit: string | null };
type PersonOpt = { id: string; name: string };
/** An existing operation in the same plan, offered as a "depends on" target. Never another plan's ops. */
type OpOpt = { id: string; label: string; plannedAt: string | null };
type MatRow = {
  key: number;
  itemId: string;
  qty: string;
  // Compliance fields (docs/CLAUDE.md #4) — only rendered/sent when subtype === "spraying".
  targetPest: string;
  apcRegistrationRef: string;
  reiHours: string;
  phiDays: string;
  targetZone: string; // "" = unset
  applicatorPersonId: string; // "" = unset
};
type LabRow = { key: number; team: string; count: string; days: string; personId: string };

// Rough seasonal/operational order (pruning → offshoots → pollen → pollination → bunch work →
// irrigation/fertilization → pest control → harvest → post-harvest → inspection), sourced from
// lib/labels.ts SUBTYPE_AR — the single place the Arabic vocabulary is defined (migration
// 20260701230000 constrains plan_operations.subtype to exactly this set).
const SUBTYPE_ORDER = [
  "pruning_dethorning",
  "offshoot_mgmt",
  "pollen_collection",
  "pollination",
  "bunch_limiting",
  "thinning",
  "bunch_tilting",
  "bagging",
  "irrigation",
  "fertilization",
  "pest_scouting",
  "spraying",
  "harvest",
  "post_harvest",
  "inspection",
] as const;

const SUBTYPES: SelectOption[] = SUBTYPE_ORDER.map((value) => ({ value, label: SUBTYPE_AR[value] }));

const HARVEST_STAGE_OPTIONS: SelectOption[] = (["khalal", "rutab", "tamar"] as const).map((value) => ({
  value,
  label: HARVEST_STAGE_AR[value],
}));

// Pesticide-application-specific fields only make sense for a spray-type op (task scope: "ONLY
// relevant when the parent operation's subtype is a pesticide/spray-type op").
const PESTICIDE_SUBTYPES = new Set(["spraying"]);

// A small closed vocabulary (mirrors the DB CHECK, migration 20260701320000) — real farm-report
// finding: spray instructions specify a SPECIFIC target zone ("drench the bunch-stalks and crown"),
// not just "the palm" generically.
const TARGET_ZONES: SelectOption[] = [
  { value: "", label: "— غير محدد —" },
  ...Object.entries(TARGET_ZONE_AR).map(([value, label]) => ({ value, label })),
];

// Planning-time scheduling preference — distinct from the actual execution timestamp (set at
// execute time). Real farm-report finding: "only spray at day's end once the heat breaks."
const TIME_OF_DAY_OPTIONS: SelectOption[] = [
  { value: "", label: "— غير محدد —" },
  ...Object.entries(TIME_OF_DAY_AR).map(([value, label]) => ({ value, label })),
];

const emptyMatCompliance = {
  targetPest: "",
  apcRegistrationRef: "",
  reiHours: "",
  phiDays: "",
  targetZone: "",
  applicatorPersonId: "",
};

/**
 * #398: author an operation with SEVERAL needs (N materials of any kind incl. fuel/gas + N labour lines),
 * a MULTI-DAY span (start + optional end), and ONE-OR-MORE employee assignees with a lead. Submits via
 * addPlanOperationMulti → fn_add_plan_operation_multi (one atomic transaction). RTL/Arabic throughout.
 */
export function OperationBuilder({
  planId,
  items,
  people = [],
  existingOps = [],
}: {
  planId: string;
  items: ItemOpt[];
  people?: PersonOpt[];
  /** Other operations already in this plan — offered as "depends on another operation" targets. */
  existingOps?: OpOpt[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().split("T")[0];
  const [subtype, setSubtype] = useState("fertilization");
  const [harvestStage, setHarvestStage] = useState<HarvestStage>("khalal");
  const [plannedAt, setPlannedAt] = useState(today);
  const [endsOn, setEndsOn] = useState(""); // empty = single-day
  const [estCost, setEstCost] = useState("0");
  const [seq, setSeq] = useState(2);
  const [materials, setMaterials] = useState<MatRow[]>([
    { key: 0, itemId: items[0]?.id ?? "", qty: "", ...emptyMatCompliance },
  ]);
  const [labor, setLabor] = useState<LabRow[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [leadId, setLeadId] = useState("");
  // Optional "depends on another operation" (relative scheduling, 2026-07-01). "" = no dependency.
  const [dependsOnOpId, setDependsOnOpId] = useState("");
  const [offsetDays, setOffsetDays] = useState("0");
  const [preferredTimeOfDay, setPreferredTimeOfDay] = useState("");

  const isPesticideOp = PESTICIDE_SUBTYPES.has(subtype);

  const itemOptions: SelectOption[] = items.map((i) => ({ value: i.id, label: i.name }));
  const unitOf = (id: string) => items.find((i) => i.id === id)?.unit ?? "kg";
  const dependencyOptions: SelectOption[] = [
    { value: "", label: "بدون اعتماد" },
    ...existingOps.map((o) => ({ value: o.id, label: o.label })),
  ];
  const selectedDependency = existingOps.find((o) => o.id === dependsOnOpId) ?? null;
  const parsedOffset = Number(offsetDays || 0);
  const effectiveDate =
    selectedDependency && Number.isFinite(parsedOffset)
      ? computeEffectiveDate(selectedDependency.plannedAt, parsedOffset)
      : null;
  const dependencyDisplay =
    selectedDependency && Number.isFinite(parsedOffset)
      ? formatDependencyLabel(selectedDependency.label, parsedOffset)
      : null;
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
      if (people.length > 0 && assignees.length === 0) {
        setError("اختر مكلّفًا واحدًا على الأقل للعملية.");
        return;
      }
      const res = await addPlanOperationMulti(planId, {
        subtype,
        planned_at: plannedAt,
        ends_on: endsOn || null,
        est_cost: Number(estCost),
        preferred_time_of_day: preferredTimeOfDay || null,
        materials: materials
          .filter((m) => m.itemId)
          .map((m) => ({
            item_id: m.itemId,
            qty: Number(m.qty || 0),
            unit: unitOf(m.itemId),
            // Compliance fields (#4) — only meaningful/sent for a pesticide-application op; a
            // non-spray op never carries these (they stay unset server-side, per column defaults).
            ...(isPesticideOp
              ? {
                  target_pest: m.targetPest || null,
                  apc_registration_ref: m.apcRegistrationRef || null,
                  rei_hours: m.reiHours ? Number(m.reiHours) : null,
                  phi_days: m.phiDays ? Number(m.phiDays) : null,
                  target_zone: m.targetZone || null,
                  applicator_person_id: m.applicatorPersonId || null,
                }
              : {}),
          })),
        labor: labor.map((l) => ({
          person_or_team: l.team,
          count: Number(l.count || 0),
          days: Number(l.days || 0),
          // Optional cost-basis link (labor cost rollup): only set when the planner picked a real
          // person from the org's people list; "" (no selection) stays a free-text-only line.
          person_id: l.personId || null,
        })),
        assignee_ids: assignees,
        lead_id: leadId || null,
        harvest_stage: subtype === "harvest" ? harvestStage : null,
      });
      // `res.ok` alone doesn't narrow (addPlanOperationMulti's return type isn't a discriminated
      // literal union), so check operationId's presence directly — the real success signal.
      if (!res.ok || !res.operationId) {
        setError(res.error ?? "تعذّر الحفظ");
        return;
      }
      const operationId = res.operationId;

      // Optional "depends on another operation" (relative scheduling): a separate, additive
      // follow-up write on the newly created op — planned_at itself is untouched. A failure here
      // must not be silently swallowed: the operation IS created, but its dependency note failed to
      // save, so surface that distinctly rather than pretending everything saved.
      if (dependsOnOpId) {
        const depRes = await setPlanOperationDependency(
          planId,
          operationId,
          dependsOnOpId,
          Number.isFinite(parsedOffset) ? parsedOffset : 0,
        );
        if (!depRes.ok) {
          setError(`تم إنشاء العملية، لكن تعذّر حفظ الاعتماد على العملية الأخرى: ${depRes.error}`);
          router.refresh();
          return;
        }
      }

      setOpen(false);
      router.refresh();
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

          {/* Harvest stage (خلال/رطب/تمر) — only meaningful for a harvest operation. */}
          {subtype === "harvest" && (
            <FormRow id="harvest_stage" label="مرحلة النضج">
              <Select
                options={HARVEST_STAGE_OPTIONS}
                value={harvestStage}
                onChange={(e) => setHarvestStage(e.target.value as HarvestStage)}
              />
            </FormRow>
          )}

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

          {/* Optional: schedule this operation RELATIVE TO another operation in the same plan
              ("spray after tilting completes") instead of (or alongside) an absolute date. planned_at
              above stays the stored/authoritative date; this is a display-only note + a computed
              effective date, never a silent rewrite. */}
          {existingOps.length > 0 && (
            <fieldset className="flex flex-col gap-2 rounded-md border p-3" style={{ borderColor: "var(--line,#e5e7eb)" }}>
              <legend className="px-1 text-sm font-semibold">يعتمد على عملية أخرى (اختياري)</legend>
              <FormRow id="depends-on" label="العملية">
                <Select
                  options={dependencyOptions}
                  value={dependsOnOpId}
                  onChange={(e) => setDependsOnOpId(e.target.value)}
                />
              </FormRow>
              {dependsOnOpId && (
                <>
                  <FormRow id="offset-days" label="الفارق بالأيام (سالب = قبل، موجب = بعد)">
                    <Input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      value={offsetDays}
                      onChange={(e) => setOffsetDays(e.target.value)}
                    />
                  </FormRow>
                  {dependencyDisplay && (
                    <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
                      {dependencyDisplay}
                      {effectiveDate ? ` — التاريخ الفعلي المتوقع: ${effectiveDate}` : ""}
                    </p>
                  )}
                </>
              )}
            </fieldset>
          )}

          {/* Planning-time scheduling preference — e.g. "only spray once the heat breaks" — distinct
              from the actual execution timestamp (set later, at execute time). Only meaningful for a
              pesticide-application op; shown for spraying only. */}
          {isPesticideOp && (
            <FormRow id="preferred_time_of_day" label="التوقيت المفضّل للرش">
              <Select
                options={TIME_OF_DAY_OPTIONS}
                value={preferredTimeOfDay}
                onChange={(e) => setPreferredTimeOfDay(e.target.value)}
              />
            </FormRow>
          )}

          {/* Several material needs — fertilizers, fuel/gas, any item. */}
          <fieldset className="flex flex-col gap-2 rounded-md border p-3" style={{ borderColor: "var(--line,#e5e7eb)" }}>
            <legend className="px-1 text-sm font-semibold">الاحتياجات من الخامات</legend>
            {materials.map((m, idx) => (
              <div key={m.key} className="flex flex-col gap-2">
                <div className="flex items-end gap-2">
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

                {/* Pesticide-application compliance fields (docs/CLAUDE.md #4) — only shown for a
                    spray-type subtype; a plain fertilization/irrigation op never sees these. */}
                {isPesticideOp && (
                  <div
                    className="mr-8 grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-3"
                    style={{ borderColor: "var(--line,#e5e7eb)" }}
                  >
                    <FormRow id={`mat-pest-${m.key}`} label="الآفة المستهدفة">
                      <Input
                        value={m.targetPest}
                        onChange={(e) =>
                          setMaterials((p) =>
                            p.map((x) => (x.key === m.key ? { ...x, targetPest: e.target.value } : x)),
                          )
                        }
                      />
                    </FormRow>
                    <FormRow id={`mat-apc-${m.key}`} label="رقم تسجيل المبيد (لجنة المبيدات)">
                      <Input
                        value={m.apcRegistrationRef}
                        onChange={(e) =>
                          setMaterials((p) =>
                            p.map((x) =>
                              x.key === m.key ? { ...x, apcRegistrationRef: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </FormRow>
                    <FormRow id={`mat-zone-${m.key}`} label="منطقة الاستهداف على النخلة">
                      <Select
                        options={TARGET_ZONES}
                        value={m.targetZone}
                        onChange={(e) =>
                          setMaterials((p) =>
                            p.map((x) => (x.key === m.key ? { ...x, targetZone: e.target.value } : x)),
                          )
                        }
                      />
                    </FormRow>
                    <FormRow id={`mat-rei-${m.key}`} label="فترة إعادة الدخول (ساعة)">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step="any"
                        value={m.reiHours}
                        onChange={(e) =>
                          setMaterials((p) =>
                            p.map((x) => (x.key === m.key ? { ...x, reiHours: e.target.value } : x)),
                          )
                        }
                      />
                    </FormRow>
                    <FormRow id={`mat-phi-${m.key}`} label="فترة ما قبل الحصاد (يوم)">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step="any"
                        value={m.phiDays}
                        onChange={(e) =>
                          setMaterials((p) =>
                            p.map((x) => (x.key === m.key ? { ...x, phiDays: e.target.value } : x)),
                          )
                        }
                      />
                    </FormRow>
                    {people.length > 0 && (
                      <FormRow id={`mat-applicator-${m.key}`} label="القائم بالرش">
                        <Select
                          options={[{ value: "", label: "— غير محدد —" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
                          value={m.applicatorPersonId}
                          onChange={(e) =>
                            setMaterials((p) =>
                              p.map((x) =>
                                x.key === m.key ? { ...x, applicatorPersonId: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </FormRow>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div>
              <Button
                variant="ghost"
                onClick={() =>
                  setMaterials((p) => [
                    ...p,
                    { key: nextKey(), itemId: items[0]?.id ?? "", qty: "", ...emptyMatCompliance },
                  ])
                }
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
                {people.length > 0 && (
                  <div className="flex-1">
                    {/* Optional cost-basis link (SPEC-0006): pick a real person to price this line off
                        people_compensation later; leave unset for an informal/day-labor crew — the
                        free-text "الفريق / العامل" field above still describes the line either way. */}
                    <FormRow id={`lab-person-${l.key}`} label="ربط بشخص (اختياري، للتكلفة)">
                      <Select
                        options={[{ value: "", label: "بدون ربط" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
                        value={l.personId}
                        onChange={(e) =>
                          setLabor((p) => p.map((x) => (x.key === l.key ? { ...x, personId: e.target.value } : x)))
                        }
                      />
                    </FormRow>
                  </div>
                )}
                <Button variant="ghost" aria-label="حذف العمالة" onClick={() => setLabor((p) => p.filter((x) => x.key !== l.key))}>
                  ✕
                </Button>
              </div>
            ))}
            <div>
              <Button
                variant="ghost"
                onClick={() => setLabor((p) => [...p, { key: nextKey(), team: "", count: "", days: "", personId: "" }])}
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
