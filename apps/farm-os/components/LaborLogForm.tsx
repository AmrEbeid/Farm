"use client";

// «تسجيل حضور» — mode-aware attendance capture (SPEC-0006 slice 2, extended for the slice-3 payroll
// kernel in migration 20260729090000_payroll_run_persistence.sql).
//
// WHAT CHANGED AND WHY. The form used to write hourly rows only, so a farm that pays per box or per
// tree had nowhere to record what it actually pays for, and its payroll close could never be priced.
// The wage mode is now chosen at entry time, and the piece fields appear only for `mode='piece'` —
// exactly the shape `labor_logs_piece_shape` enforces in Postgres.
//
// HOURS ARE NEVER OPTIONAL. `labor_logs.hours` is NOT NULL for every mode: hours are ATTENDANCE
// EVIDENCE, not a pricing input. The form says so in one line next to the mode picker, because
// "hours are required" and "hours don't set your pay" are both true and are easy to confuse.
//
// THE FREE-TEXT TEAM WARNING. A row with a free-text team name and no person cannot be priced, and
// `fn_close_payroll_run` aborts the ENTIRE period close when even one exists. That consequence is
// shown the moment «فريق غير مسجّل» is picked — not weeks later when the close refuses.
//
// DUPLICATE SUBMIT. `submittingRef` is a SYNCHRONOUS lock checked as the very first statement of the
// handler. React state (`pending`) updates asynchronously, so two clicks inside one render pass would
// both pass a `pending` check and post two attendance rows — and unlike the payroll close, this write
// is NOT idempotent: two rows for the same day are two rows, and for a daily-mode worker they would
// look like an editing mistake nobody can undo once the period is closed. The ref closes that window;
// `pending` is what the UI shows.
//
// The same pure validator the server action runs executes here first, so a bad row is explained
// instantly and never becomes a round trip.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Select, Alert, type SelectOption } from "@/components/ui";
import { createLaborLog } from "@/app/(app)/people/actions";
import {
  LABOR_HOURS_ALWAYS_AR,
  LABOR_HOURS_MAX,
  LABOR_MODES,
  LABOR_MODE_AR,
  LABOR_NOTE_MAX,
  LABOR_TEAM_NAME_MAX,
  LABOR_UNASSIGNED_TEAM_WARNING_AR,
  LABOR_UNITS,
  LABOR_UNIT_AR,
  parseLaborLogInput,
  type LaborMode,
} from "@/lib/labor-entry";

export interface PersonOption {
  id: string;
  name: string;
}

const CONNECTION_FAILED_AR = "تعذّر الاتصال بالخادم. لم يُسجَّل شيء؛ حاول مرة أخرى.";

const WHO_OPTIONS: SelectOption[] = [
  { value: "person", label: "عضو فريق" },
  { value: "team", label: "فريق غير مسجّل (اسم حر)" },
];

const MODE_OPTIONS: SelectOption[] = LABOR_MODES.map((mode) => ({
  value: mode,
  label: LABOR_MODE_AR[mode],
}));

const UNIT_OPTIONS: SelectOption[] = [
  { value: "", label: "اختر الوحدة" },
  ...LABOR_UNITS.map((unit) => ({ value: unit, label: LABOR_UNIT_AR[unit] })),
];

/** What each mode's hours/quantity actually mean, in one line, at the point of entry. */
const MODE_HINT_AR: Record<LaborMode, string> = {
  hourly: "يُحسب الأجر من مجموع الساعات المسجّلة في الفترة.",
  daily: "يُحسب الأجر بعدد أيام الحضور المختلفة، لا بعدد السجلات: سجلّان في اليوم نفسه = يوم واحد.",
  piece: "يُحسب الأجر من مجموع الكمية بالوحدة المحدَّدة أدناه.",
  seasonal: "يُصرف مبلغ العقد مرة واحدة، وفقط إذا طابقت فترة الإقفال تاريخَي العقد المحفوظين بالضبط.",
};

/**
 * Log a day's attendance for a person or an informal team. Gated by the page to `labor.write` roles
 * (owner/farm_manager/supervisor); the server action re-establishes the same gate from the session
 * before it reads a single field, and RLS re-enforces it in Postgres.
 *
 * `todayIso` is the CAIRO calendar day, resolved on the server (the browser clock could be anything)
 * and used as the date input's `max` — the pure validator rejects a future date regardless.
 * No plan-operation picker in this slice — `plan_op_id` stays null.
 */
export function LaborLogForm({
  people,
  todayIso,
}: {
  people: PersonOption[];
  todayIso: string;
}) {
  const router = useRouter();
  const [who, setWho] = useState<"person" | "team">("person");
  const [personId, setPersonId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [mode, setMode] = useState<LaborMode>("hourly");
  const [workDate, setWorkDate] = useState(todayIso);
  const [hours, setHours] = useState("8");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const submittingRef = useRef(false);

  const personOptions: SelectOption[] = [
    { value: "", label: "اختر عضو فريق" },
    ...people.map((p) => ({ value: p.id, label: p.name })),
  ];

  function draft() {
    return {
      personId: who === "person" ? personId || null : null,
      teamName: who === "team" ? teamName || null : null,
      mode,
      workDate,
      hours,
      quantity: mode === "piece" ? quantity : null,
      unit: mode === "piece" ? unit || null : null,
      note: note || null,
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // SYNCHRONOUS duplicate-submit lock — the first statement, before any await or setState.
    if (submittingRef.current) return;

    const payload = draft();
    const parsed = parseLaborLogInput(payload);
    if (!parsed.ok) {
      setMsg({ tone: "danger", text: parsed.error });
      return;
    }

    submittingRef.current = true;
    setPending(true);
    setMsg(null);
    let res: { ok: boolean; error?: string };
    try {
      res = await createLaborLog(payload);
    } catch {
      res = { ok: false, error: CONNECTION_FAILED_AR };
    }
    submittingRef.current = false;
    setPending(false);

    if (res.ok) {
      setMsg({ tone: "ok", text: "تم تسجيل الحضور" });
      setQuantity("");
      setNote("");
      router.refresh();
    } else {
      setMsg({ tone: "danger", text: res.error ?? "تعذّر تسجيل الحضور" });
    }
  }

  return (
    <Card title="تسجيل حضور">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div aria-live="assertive" aria-atomic="true" role="alert">
          {msg && <Alert tone={msg.tone} title={msg.text} />}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="من هو؟" id="labor-who">
            <Select
              id="labor-who"
              options={WHO_OPTIONS}
              value={who}
              disabled={pending}
              onChange={(e) => setWho(e.target.value as "person" | "team")}
            />
          </Field>
          {who === "person" ? (
            <Field label="عضو الفريق" id="labor-person" required>
              <Select
                id="labor-person"
                options={personOptions}
                value={personId}
                disabled={pending}
                onChange={(e) => setPersonId(e.target.value)}
              />
            </Field>
          ) : (
            <Field label="اسم الفريق" id="labor-team" required>
              <Input
                id="labor-team"
                value={teamName}
                disabled={pending}
                onChange={(e) => setTeamName(e.target.value)}
                maxLength={LABOR_TEAM_NAME_MAX}
              />
            </Field>
          )}
        </div>

        {who === "team" && <Alert tone="warning" title={LABOR_UNASSIGNED_TEAM_WARNING_AR} />}

        <Field label="طريقة الأجر" id="labor-mode" required>
          <Select
            id="labor-mode"
            options={MODE_OPTIONS}
            value={mode}
            disabled={pending}
            onChange={(e) => {
              const next = e.target.value as LaborMode;
              setMode(next);
              // Leaving piece mode clears the piece fields: the validator (and the CHECK) require
              // them to be NULL for every other mode, so a stale value must never be carried over.
              if (next !== "piece") {
                setQuantity("");
                setUnit("");
              }
            }}
          />
        </Field>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {MODE_HINT_AR[mode]} {LABOR_HOURS_ALWAYS_AR}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <Field label="التاريخ" id="labor-date" required>
            <Input
              id="labor-date"
              type="date"
              max={todayIso}
              value={workDate}
              disabled={pending}
              onChange={(e) => setWorkDate(e.target.value)}
            />
          </Field>
          <Field label="عدد الساعات" id="labor-hours" required>
            <Input
              id="labor-hours"
              type="number"
              inputMode="decimal"
              min={0.5}
              max={LABOR_HOURS_MAX}
              step={0.5}
              value={hours}
              disabled={pending}
              onChange={(e) => setHours(e.target.value)}
            />
          </Field>
        </div>

        {mode === "piece" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="الكمية" id="labor-quantity" required>
              <Input
                id="labor-quantity"
                type="number"
                inputMode="decimal"
                min={0.01}
                step={0.01}
                value={quantity}
                disabled={pending}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label="وحدة القطعة" id="labor-unit" required>
              <Select
                id="labor-unit"
                options={UNIT_OPTIONS}
                value={unit}
                disabled={pending}
                onChange={(e) => setUnit(e.target.value)}
              />
            </Field>
          </div>
        )}

        <Field label="ملاحظات" id="labor-note">
          <Input
            id="labor-note"
            value={note}
            disabled={pending}
            onChange={(e) => setNote(e.target.value)}
            maxLength={LABOR_NOTE_MAX}
          />
        </Field>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={pending} disabled={pending}>
            حفظ
          </Button>
        </div>
      </form>
    </Card>
  );
}
