"use client";

// The compensation editor form. Compact by design: one form that both CREATES a rate and EDITS an
// existing one, because a wage table with a separate "new" and "edit" flow invites the exact mistake
// the partial unique indexes exist to stop — adding a SECOND rate for a (person, mode[, unit]) that
// already has one.
//
// MODE DRIVES THE SHAPE. `unit` appears only for piece; the contract bounds appear only for seasonal.
// Leaving a mode CLEARS the fields it owned, because `people_compensation_piece_shape` and
// `people_compensation_seasonal_shape` require them to be NULL for every other mode — a stale value
// carried across a mode change would be a 23514 the user cannot interpret.
//
// SEASONAL IS STATED IN WORDS. The close matches a seasonal rate ONLY when the close period equals
// these bounds exactly — no overlap, no containment. That is impossible to guess from a date field,
// so the rule is printed next to it.
//
// DUPLICATE SUBMIT. `submittingRef` is a SYNCHRONOUS lock, checked as the first statement of the
// handler. React state updates asynchronously, so two clicks in one render pass would both pass a
// `pending` check — and a double CREATE here either duplicates a wage row or loses a 23505 race that
// the user then has to interpret. The ref closes that window; `pending` is only what the UI shows.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select, type SelectOption } from "@/components/ui";
import { egp, num } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import {
  COMPENSATION_CONFIDENTIAL_AR,
  COMPENSATION_MODES,
  COMPENSATION_MODE_AR,
  COMPENSATION_RATE_MAX,
  COMPENSATION_SEASONAL_EXACT_AR,
  COMPENSATION_UNITS,
  COMPENSATION_UNIT_AR,
  compensationBasisLabel,
  parseCompensationInput,
  type CompensationMode,
} from "@/lib/compensation";
import { WAGE_MODE_BASIS_AR } from "@/lib/wage-modes";
import type { CompensationPerson, CompensationRowView } from "@/lib/compensation-read";
import { saveCompensation } from "./actions";

const CONNECTION_FAILED_AR = "تعذّر الاتصال بالخادم. لم يُحفظ شيء؛ حاول مرة أخرى.";
const CREATED_AR = "تم حفظ الأجر.";
const UPDATED_AR = "تم تحديث الأجر.";

const MODE_OPTIONS: SelectOption[] = COMPENSATION_MODES.map((mode) => ({
  value: mode,
  label: COMPENSATION_MODE_AR[mode],
}));

const UNIT_OPTIONS: SelectOption[] = [
  { value: "", label: "اختر الوحدة" },
  ...COMPENSATION_UNITS.map((unit) => ({ value: unit, label: COMPENSATION_UNIT_AR[unit] })),
];

const boxStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;
const cellStyle = { borderBottom: "1px solid var(--line)" } as const;
const mutedStyle = { color: "var(--ink-muted)" } as const;

interface FormState {
  rowId: string;
  personId: string;
  mode: CompensationMode;
  rate: string;
  unit: string;
  start: string;
  end: string;
}

const EMPTY: FormState = {
  rowId: "",
  personId: "",
  mode: "hourly",
  rate: "",
  unit: "",
  start: "",
  end: "",
};

export function CompensationEditor({
  people,
  rows,
}: {
  people: CompensationPerson[];
  rows: CompensationRowView[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const submittingRef = useRef(false);

  const personOptions: SelectOption[] = [
    { value: "", label: "اختر عضو فريق" },
    ...people.map((person) => ({ value: person.id, label: person.name })),
  ];

  function set(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function changeMode(next: CompensationMode) {
    // Clear the fields the previous mode owned — the CHECK constraints require them NULL elsewhere.
    set({
      mode: next,
      unit: next === "piece" ? form.unit : "",
      start: next === "seasonal" ? form.start : "",
      end: next === "seasonal" ? form.end : "",
    });
  }

  function edit(row: CompensationRowView) {
    setMsg(null);
    setForm({
      rowId: row.id,
      personId: row.personId,
      mode: (row.mode as CompensationMode) ?? "hourly",
      rate: row.rate === null ? "" : String(row.rate),
      unit: row.unit ?? "",
      start: row.contractPeriodStart ?? "",
      end: row.contractPeriodEnd ?? "",
    });
  }

  function reset() {
    setMsg(null);
    setForm(EMPTY);
  }

  function draft() {
    return {
      rowId: form.rowId || null,
      personId: form.personId || null,
      mode: form.mode,
      rate: form.rate,
      unit: form.mode === "piece" ? form.unit || null : null,
      contractPeriodStart: form.mode === "seasonal" ? form.start || null : null,
      contractPeriodEnd: form.mode === "seasonal" ? form.end || null : null,
    };
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    // SYNCHRONOUS duplicate-submit lock — first statement, before any await or setState.
    if (submittingRef.current) return;

    const payload = draft();
    const parsed = parseCompensationInput(payload);
    if (!parsed.ok) {
      setMsg({ tone: "danger", text: parsed.error });
      return;
    }

    submittingRef.current = true;
    setPending(true);
    setMsg(null);
    let result: Awaited<ReturnType<typeof saveCompensation>>;
    try {
      result = await saveCompensation(payload);
    } catch {
      result = { ok: false, error: CONNECTION_FAILED_AR };
    }
    submittingRef.current = false;
    setPending(false);

    if (!result.ok) {
      setMsg({ tone: "danger", text: result.error });
      return;
    }
    setMsg({ tone: "ok", text: result.mode === "updated" ? UPDATED_AR : CREATED_AR });
    setForm(EMPTY);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md p-3 text-xs" style={boxStyle}>
        {COMPENSATION_CONFIDENTIAL_AR}
      </p>

      <section
        className="no-print flex flex-col gap-3 rounded-md p-4"
        style={boxStyle}
        aria-labelledby="compensation-form-heading"
      >
        <h2 id="compensation-form-heading" className="text-base font-bold">
          {form.rowId ? "تعديل أجر محفوظ" : "أجر جديد"}
        </h2>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div role="alert" aria-live="assertive" aria-atomic="true">
            {msg && <Alert tone={msg.tone} title={msg.text} />}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="عضو الفريق" id="comp-person" required>
              <Select
                id="comp-person"
                options={personOptions}
                value={form.personId}
                // The person a saved row belongs to is part of its identity: changing it would be a
                // different rate, not an edit of this one. Create a new row instead.
                disabled={pending || Boolean(form.rowId)}
                onChange={(event) => set({ personId: event.target.value })}
              />
            </Field>
            <Field label="طريقة الأجر" id="comp-mode" required>
              <Select
                id="comp-mode"
                options={MODE_OPTIONS}
                value={form.mode}
                disabled={pending}
                onChange={(event) => changeMode(event.target.value as CompensationMode)}
              />
            </Field>
          </div>

          <p className="text-xs" style={mutedStyle}>
            {WAGE_MODE_BASIS_AR[form.mode]}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="قيمة الأجر (ج.م)" id="comp-rate" required>
              <Input
                id="comp-rate"
                type="number"
                inputMode="decimal"
                min={0.01}
                max={COMPENSATION_RATE_MAX}
                step={0.01}
                value={form.rate}
                disabled={pending}
                onChange={(event) => set({ rate: event.target.value })}
              />
            </Field>
            {form.mode === "piece" && (
              <Field label="وحدة القطعة" id="comp-unit" required>
                <Select
                  id="comp-unit"
                  options={UNIT_OPTIONS}
                  value={form.unit}
                  disabled={pending}
                  onChange={(event) => set({ unit: event.target.value })}
                />
              </Field>
            )}
          </div>

          {form.mode === "seasonal" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="بداية العقد" id="comp-start" required>
                  <Input
                    id="comp-start"
                    type="date"
                    value={form.start}
                    disabled={pending}
                    onChange={(event) => set({ start: event.target.value })}
                  />
                </Field>
                <Field label="نهاية العقد" id="comp-end" required>
                  <Input
                    id="comp-end"
                    type="date"
                    value={form.end}
                    disabled={pending}
                    onChange={(event) => set({ end: event.target.value })}
                  />
                </Field>
              </div>
              <p className="text-xs" style={mutedStyle}>
                {COMPENSATION_SEASONAL_EXACT_AR}
              </p>
            </>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={pending} disabled={pending}>
              {form.rowId ? "حفظ التعديل" : "حفظ الأجر"}
            </Button>
            {form.rowId && (
              <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
                إلغاء التعديل
              </Button>
            )}
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="compensation-rows-heading">
        <h2 id="compensation-rows-heading" className="text-base font-bold">
          الأجور المحفوظة
          <span className="ms-2 text-xs font-normal" style={mutedStyle}>
            {num(rows.length)}
          </span>
        </h2>

        {rows.length === 0 ? (
          <p className="rounded-md p-3 text-sm" style={boxStyle}>
            لا توجد أجور محفوظة بعد. أضف أجرًا لكل عامل قبل محاولة إقفال الرواتب — أي عامل بلا أجر
            يمنع إقفال الفترة بالكامل.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-sm" style={boxStyle}>
              <caption className="sr-only">الأجور المحفوظة لأعضاء الفريق</caption>
              <thead>
                <tr>
                  {["العامل", "طريقة الأجر", "قيمة الأجر", "لكل", "فترة العقد", "تعديل"].map(
                    (header, index) => (
                      <th
                        key={header}
                        scope="col"
                        className="p-2 text-start font-semibold"
                        style={cellStyle}
                      >
                        {index === 5 ? <span className="sr-only">{header}</span> : header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" className="p-2 text-start font-normal" style={cellStyle}>
                      {row.personName}
                    </th>
                    <td className="p-2" style={cellStyle}>
                      {COMPENSATION_MODE_AR[row.mode as CompensationMode] ?? "غير معروف"}
                    </td>
                    <td className="p-2 tabular-nums" style={cellStyle}>
                      {egp(row.rate)}
                    </td>
                    <td className="p-2" style={cellStyle}>
                      {compensationBasisLabel(row.mode, row.unit)}
                    </td>
                    <td className="p-2" style={cellStyle}>
                      {row.contractPeriodStart && row.contractPeriodEnd
                        ? `${fmtDate(row.contractPeriodStart)} — ${fmtDate(row.contractPeriodEnd)}`
                        : "—"}
                    </td>
                    <td className="no-print p-2" style={cellStyle}>
                      <Button type="button" variant="ghost" onClick={() => edit(row)} disabled={pending}>
                        تعديل
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
