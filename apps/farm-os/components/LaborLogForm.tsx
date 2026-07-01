"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Select, Alert, type SelectOption } from "@/components/ui";
import { createLaborLog } from "@/app/(app)/people/actions";

export interface PersonOption {
  id: string;
  name: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Log a day's attendance for a person or an informal team (SPEC-0006 slice 2). Gated by the page to
 * `labor.write` roles (owner/farm_manager/supervisor); the server action re-enforces the same gate via
 * RLS. No plan-operation picker in this slice — `plan_op_id` stays null (see the PR description for
 * the scope reduction); the column is nullable so a future slice can wire it without a new migration.
 */
export function LaborLogForm({ people }: { people: PersonOption[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"person" | "team">("person");
  const [personId, setPersonId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [workDate, setWorkDate] = useState(todayIso());
  const [hours, setHours] = useState("8");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const personOptions: SelectOption[] = [
    { value: "", label: "اختر عضو فريق" },
    ...people.map((p) => ({ value: p.id, label: p.name })),
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const res = await createLaborLog({
      personId: mode === "person" ? personId || null : null,
      teamName: mode === "team" ? teamName || null : null,
      workDate,
      hours: Number(hours),
      note: note || null,
    });
    setPending(false);
    if (res.ok) {
      setMsg({ tone: "ok", text: "تم تسجيل الحضور" });
      setNote("");
      router.refresh();
    } else {
      setMsg({ tone: "danger", text: res.error ?? "تعذّر تسجيل الحضور" });
    }
  }

  return (
    <Card title="تسجيل حضور">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div aria-live="assertive" aria-atomic="true">
          {msg && <Alert tone={msg.tone} title={msg.text} />}
        </div>
        <Field label="من هو؟" id="labor-mode">
          <Select
            id="labor-mode"
            options={[
              { value: "person", label: "عضو فريق" },
              { value: "team", label: "فريق غير مسجّل (اسم حر)" },
            ]}
            value={mode}
            onChange={(e) => setMode(e.target.value as "person" | "team")}
          />
        </Field>
        {mode === "person" ? (
          <Field label="عضو الفريق *" id="labor-person">
            <Select
              id="labor-person"
              options={personOptions}
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
              required
            />
          </Field>
        ) : (
          <Field label="اسم الفريق *" id="labor-team">
            <Input
              id="labor-team"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              maxLength={120}
              required
            />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="التاريخ *" id="labor-date">
            <Input
              id="labor-date"
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              required
            />
          </Field>
          <Field label="عدد الساعات *" id="labor-hours">
            <Input
              id="labor-hours"
              type="number"
              min={0.5}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
            />
          </Field>
        </div>
        <Field label="ملاحظات" id="labor-note">
          <Input id="labor-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={pending}>
            حفظ
          </Button>
        </div>
      </form>
    </Card>
  );
}
