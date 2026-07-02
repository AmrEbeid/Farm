"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, FormRow, Input, Textarea, Alert } from "@/components/ui";
import { executeOperation } from "@/app/(app)/m/execute/[opId]/actions";
import { parseExecuteInput, parseMaterialActuals } from "@/lib/execute-input";

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
  materials,
  defaultLabor = null,
  defaultNote = "",
}: {
  opId: string;
  // #520: an operation can carry several materials (fn_add_plan_operation_multi). 0 or 1 materials
  // render the SAME single qty field as before #520 (the common case's look/feel is unchanged); only
  // >1 materials render one field per material.
  materials: ExecuteFormMaterial[];
  defaultLabor?: number | null;
  defaultNote?: string;
}) {
  const router = useRouter();
  const single = materials.length <= 1;
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

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="assertive" aria-atomic="true">
        {error && <Alert tone="danger" title={error} />}
      </div>
      {single ? (
        <FormRow id="qty" label={`الكمية المستخدمة (${soleUnit})`}>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </FormRow>
      ) : (
        materials.map((m, i) => (
          <FormRow key={m.requirementId} id={`qty-${m.requirementId}`} label={`${m.name ?? "خامة"} (${m.unit})`}>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={matQtys[i] ?? ""}
              onChange={(e) => {
                const next = e.target.value;
                setMatQtys((prev) => prev.map((v, idx) => (idx === i ? next : v)));
              }}
            />
          </FormRow>
        ))
      )}
      <FormRow id="labor" label="عدد العمال">
        <Input type="number" inputMode="numeric" min={0} step="any" value={labor} onChange={(e) => setLabor(e.target.value)} />
      </FormRow>
      <FormRow id="note" label="ملاحظة">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </FormRow>
      <Button
        variant="primary"
        loading={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const res = single
              ? await (async () => {
                  const parsed = parseExecuteInput(qty, labor);
                  if (!parsed.ok) return { ok: false as const, error: parsed.error };
                  return executeOperation(opId, {
                    actualQty: parsed.value.actualQty,
                    laborCount: parsed.value.laborCount,
                    note,
                  });
                })()
              : await (async () => {
                  const parsed = parseMaterialActuals(
                    materials.map((m, i) => ({
                      requirementId: m.requirementId,
                      itemId: m.itemId,
                      qty: matQtys[i] ?? "",
                    })),
                    labor,
                  );
                  if (!parsed.ok) return { ok: false as const, error: parsed.error };
                  return executeOperation(opId, {
                    // fn_execute_operation ignores this scalar whenever materialActuals is supplied
                    // (a required legacy positional param — see the RPC's 5th-param contract); 0 is an
                    // explicit, harmless placeholder.
                    actualQty: 0,
                    materialActuals: parsed.value.materialActuals,
                    laborCount: parsed.value.laborCount,
                    note,
                  });
                })();
            if (res.ok) {
              router.push("/m?done=1");
              return;
            }
            setError(res.error ?? "تعذّر التنفيذ");
          } catch {
            // A network failure rejects the server-action fetch and the await throws. Without
            // this catch the button would stay stuck on its spinner forever (setPending never
            // resets, event-handler throws aren't caught by an error boundary). Surface a clear,
            // retryable Arabic message instead. NOTE: this is a retry message, not offline
            // support — there's no service worker / IndexedDB outbox / queued replay yet, so a
            // submission made while offline is NOT queued; the field worker must retry once back
            // online. True offline queueing is a planned future release, not current behaviour.
            setError("تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى.");
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
