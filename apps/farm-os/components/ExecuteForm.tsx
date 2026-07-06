"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, FormRow, Input, Textarea, Alert } from "@/components/ui";
import { executeOperation, type ExecuteInput } from "@/app/(app)/m/execute/[opId]/actions";
import { parseExecuteInput, parseMaterialActuals, parseLaborCount, FIELD_LABOR_INVALID } from "@/lib/execute-input";
import { addToOutbox, removeFromOutbox } from "@/lib/exec-outbox";

/** F1: honest offline banner — saved locally, NOT sent. Never claim the op was recorded. */
const OFFLINE_SAVED_MSG =
  "تعذّر الاتصال بالخادم. حُفظ التسجيل على هذا الجهاز — افتح «الميدان» وأعد إرساله عند عودة الاتصال.";
/** Shown when saving to the device ALSO failed (storage full/disabled) — must not claim it was
 *  saved, or the worker would look for it on «الميدان» where nothing is queued. */
const OFFLINE_UNSAVED_MSG =
  "تعذّر الاتصال بالخادم وتعذّر الحفظ على هذا الجهاز. أبقِ هذه الصفحة مفتوحة وأعد المحاولة عند عودة الاتصال.";

/**
 * One material on the operation, for the #520 per-material qty fields. `requirementId` (=
 * plan_material_requirements.id) is the row's own identity — an operation can carry two rows for the
 * SAME itemId (e.g. two applications of the same fertilizer on different sub-dates), so requirementId
 * (never itemId) is used as the React key and as the field the RPC payload is matched on.
 */
export interface ExecuteFormMaterial {
  requirementId: string;
  itemId: string;
  defaultQty: number | null;
  unit: string;
  name: string | null;
}

export function ExecuteForm({
  opId,
  opLabel,
  materials,
  defaultLabor = null,
  defaultNote = "",
}: {
  opId: string;
  /** F1: Arabic op label carried into the offline outbox entry for the /m queue display. */
  opLabel: string;
  // #520: an operation can carry several materials (fn_add_plan_operation_multi). 0 or 1 materials
  // render the SAME single qty field as before #520 (the common case's look/feel is unchanged); only
  // >1 materials render one field per material.
  materials: ExecuteFormMaterial[];
  defaultLabor?: number | null;
  defaultNote?: string;
}) {
  const router = useRouter();
  const single = materials.length <= 1;
  const hasMaterials = materials.length > 0;
  const soleUnit = materials[0]?.unit ?? "كجم";

  const [qty, setQty] = useState(materials[0]?.defaultQty != null ? String(materials[0].defaultQty) : "");
  // Prefill each material field from its own plan_material_requirements.qty, same rationale as the
  // single-field prefill below: never a hardcoded magic default (non-negotiable #1).
  const [matQtys, setMatQtys] = useState<string[]>(
    materials.map((m) => (m.defaultQty != null ? String(m.defaultQty) : "")),
  );
  // Prefill from the op's planned labor (plan_labor_requirements.count) like qty — never a
  // hardcoded magic default, which would persist fabricated actual-labor data (non-negotiable #1).
  const [labor, setLabor] = useState(defaultLabor != null ? String(defaultLabor) : "");
  const [note, setNote] = useState(defaultNote);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // F7: field-keyed client-validation errors (parser output), threaded into each FormRow so the DS
  // marks the exact control aria-invalid instead of only showing the top banner. Keys: "qty"
  // (single), each material's requirementId (multi), "labor". Server stays authoritative.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Clear a field's error as soon as the user edits it (standard forgiving-validation UX).
  const clearFieldError = (key: string) =>
    setFieldErrors((prev) => (prev[key] ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)) : prev));

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="assertive" aria-atomic="true">
        {error && <Alert tone="danger" title={error} />}
      </div>
      {/* A 0-material op (e.g. a فحص inspection) has nothing to quantify — show no qty field at all rather than
          a meaningless required "الكمية المستخدمة" (SPEC-0030 flow audit A2). map([]) renders nothing. */}
      {single && hasMaterials ? (
        <FormRow id="qty" label={`الكمية المستخدمة (${soleUnit})`} required error={fieldErrors.qty}>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={qty}
            onChange={(e) => {
              setQty(e.target.value);
              clearFieldError("qty");
            }}
          />
        </FormRow>
      ) : (
        materials.map((m, i) => (
          <FormRow
            key={m.requirementId}
            id={`qty-${m.requirementId}`}
            label={`${m.name ?? "خامة"} (${m.unit})`}
            required
            error={fieldErrors[m.requirementId]}
          >
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={matQtys[i] ?? ""}
              onChange={(e) => {
                const next = e.target.value;
                setMatQtys((prev) => prev.map((v, idx) => (idx === i ? next : v)));
                clearFieldError(m.requirementId);
              }}
            />
          </FormRow>
        ))
      )}
      {/* Labor is optional (A2): a labor-less op leaves this blank (⇒ 0 crew), no fabricated number. */}
      <FormRow id="labor" label="عدد العمال (اتركه فارغًا إن لم توجد عمالة)" error={fieldErrors.labor}>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          step="any"
          value={labor}
          onChange={(e) => {
            setLabor(e.target.value);
            clearFieldError("labor");
          }}
        />
      </FormRow>
      <FormRow id="note" label="ملاحظة">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </FormRow>
      <Button
        variant="primary"
        loading={pending}
        onClick={async () => {
          setError(null);
          setFieldErrors({});
          // Client-side validation first — surface field-level errors and STOP before the server
          // round-trip if anything is invalid. The server (fn_execute_operation) remains the
          // authoritative gate; this is a UX layer, not the enforcement.
          // Build the exact ExecuteInput payload once, so the network-failure path can persist it to
          // the offline outbox verbatim (F1) — the resend replays this identical payload.
          let payload: ExecuteInput;
          if (single && hasMaterials) {
            const parsed = parseExecuteInput(qty, labor);
            if (!parsed.ok) {
              setFieldErrors(parsed.fieldErrors);
              return;
            }
            const { actualQty, laborCount } = parsed.value;
            payload = { actualQty, laborCount, note };
          } else if (single) {
            // 0-material op (e.g. inspection) — nothing to quantify; labor is optional (blank ⇒ 0 crew).
            const laborCount = parseLaborCount(labor);
            if (laborCount == null) {
              setFieldErrors({ labor: FIELD_LABOR_INVALID });
              return;
            }
            payload = { actualQty: 0, laborCount, note };
          } else {
            const parsed = parseMaterialActuals(
              materials.map((m, i) => ({
                requirementId: m.requirementId,
                itemId: m.itemId,
                qty: matQtys[i] ?? "",
              })),
              labor,
            );
            if (!parsed.ok) {
              setFieldErrors(parsed.fieldErrors);
              return;
            }
            const { materialActuals, laborCount } = parsed.value;
            payload = {
              // fn_execute_operation ignores this scalar whenever materialActuals is supplied
              // (a required legacy positional param — see the RPC's 5th-param contract); 0 is an
              // explicit, harmless placeholder.
              actualQty: 0,
              materialActuals,
              laborCount,
              note,
            };
          }
          setPending(true);
          try {
            const res = await executeOperation(opId, payload);
            // The server RESPONDED (accept or reject) → drop any stale queued copy for this op; the
            // outbox only exists to survive a network gap, and the server is authoritative.
            removeFromOutbox(opId);
            if (res.ok) {
              router.push("/m?done=1");
              return;
            }
            // A real server rejection (validation/authz) — show it; do NOT queue (nothing to retry
            // offline; the input itself was refused).
            setError(res.error ?? "تعذّر التنفيذ");
          } catch {
            // NETWORK failure: the server-action fetch rejected and the await threw (also prevents the
            // spinner stranding forever). F1 — persist the payload to the on-device outbox so it
            // survives an app-close, and tell the worker HONESTLY it was saved locally (not sent). They
            // resend it with an explicit tap from «الميدان» when back online (fn_execute_operation is
            // idempotent, so a duplicate resend is safe).
            const saved = addToOutbox({ id: opId, opId, opLabel, payload, queuedAt: new Date().toISOString() });
            // Only promise a resend if it was ACTUALLY persisted — otherwise tell the worker to keep
            // this page open (nothing will be queued on «الميدان»).
            setError(saved ? OFFLINE_SAVED_MSG : OFFLINE_UNSAVED_MSG);
          } finally {
            setPending(false);
          }
        }}
      >
        إنهاء العملية
      </Button>
    </div>
  );
}
