"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { num } from "@/lib/money";
import { recordHarvestDay } from "@/app/(app)/record/actions";

// SPEC-0027 H-B — the field crate counter: giant +/− buttons per picking block, pick the حوش,
// optional crew count, save. Field truth vs scale truth = the shrinkage number (لوحة الموسم shows it).

export function HarvestDayCounter({
  centers,
  logged,
  todayTotal,
  todayLabel,
}: {
  centers: { id: string; nameAr: string }[];
  logged: { id: string; label: string }[];
  todayTotal: number;
  todayLabel: string;
}) {
  const [crates, setCrates] = useState(0);
  const [centerId, setCenterId] = useState("");
  const [crew, setCrew] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const { pending, submit } = useSubmit();

  async function onSave() {
    setMsg(null);
    const r = await submit(() =>
      recordHarvestDay({ crates, costCenterId: centerId || null, crewCount: crew ? Number(crew) : null, note: note || null }),
    );
    if (r.ok) window.location.reload();
    else setMsg(r.error ?? "تعذّر التسجيل");
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>🧺 يوم قطف — {todayLabel}</h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          مقطوف اليوم حتى الآن: <strong>{num(todayTotal)}</strong> عبوة — والميزان يحكي الباقي.
        </p>
      </header>
      {msg && <Alert tone="danger" title={msg} />}
      <Card>
        <div className="flex flex-col gap-4 p-1">
          <Field label="عبوات هذه الدفعة" id="hd-crates">
            <div className="flex items-center justify-center gap-4">
              <Button size="sm" variant="ghost" onClick={() => setCrates(Math.max(0, crates - 1))} aria-label="أنقص">−</Button>
              <span className="min-w-20 text-center text-5xl font-black tabular-nums" style={{ color: "var(--brand)" }}>{num(crates)}</span>
              <Button size="sm" onClick={() => setCrates(crates + 1)} aria-label="زد">+</Button>
              <Button size="sm" variant="ghost" onClick={() => setCrates(crates + 5)}>+٥</Button>
              <Button size="sm" variant="ghost" onClick={() => setCrates(crates + 20)}>+٢٠</Button>
            </div>
          </Field>
          <Field label="من أي حوش/مركز؟" id="hd-cc">
            <select id="hd-cc" className="w-full rounded-md px-3 py-2 text-sm"
              style={{ border: "1px solid var(--line, rgba(0,0,0,0.15))", background: "var(--surface, #fff)" }}
              value={centerId} onChange={(e) => setCenterId(e.target.value)}>
              <option value="">— غير محدد —</option>
              {centers.map((c) => (<option key={c.id} value={c.id}>{c.nameAr}</option>))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="عدد القطّافين (اختياري)" id="hd-crew">
              <Input id="hd-crew" type="number" inputMode="numeric" min={1} value={crew} onChange={(e) => setCrew(e.target.value)} />
            </Field>
            <Field label="ملاحظة (اختياري)" id="hd-note">
              <Input id="hd-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
            </Field>
          </div>
          <Button onClick={onSave} disabled={pending || crates <= 0}>{pending ? "جارٍ الحفظ…" : "سجّل الدفعة ✓"}</Button>
        </div>
      </Card>
      {logged.length > 0 && (
        <Card title="دفعات اليوم">
          <ul className="flex flex-col gap-1 p-1 text-sm" style={{ color: "var(--ink)" }}>
            {logged.map((l) => (<li key={l.id}>• {l.label}</li>))}
          </ul>
        </Card>
      )}
      <div className="text-sm">
        <Link href="/m" className="font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>→ رجوع إلى الميدان</Link>
      </div>
    </div>
  );
}
