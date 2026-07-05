"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { num } from "@/lib/money";
import { recordScaleDelivery, quickAddBuyer } from "@/app/(app)/record/actions";

// SPEC-0027 H-A — شاشة الميزان: gloves-on UI. Big counter for crates, one weight, live net,
// NAMED trader (season rule — no more anonymous «نقدي»), save → the بون screen with a huge serial
// + a WhatsApp share line. The delivery lands as a PENDING-price sale (posts nothing until priced).

const CROPS = ["برحي", "بنجر", "فسائل", "مانجو", "أخرى"];

export function ScaleWizard({
  buyers,
  centers,
}: {
  buyers: { id: string; name: string }[];
  centers: { id: string; nameAr: string }[];
}) {
  const [crop, setCrop] = useState("برحي");
  const [crates, setCrates] = useState(0);
  const [gross, setGross] = useState("");
  const [tare, setTare] = useState("2");
  const [buyerId, setBuyerId] = useState(buyers[0]?.id ?? "");
  const [buyerList, setBuyerList] = useState(buyers);
  const [newBuyer, setNewBuyer] = useState("");
  const [addingBuyer, setAddingBuyer] = useState(false);
  const [centerId, setCenterId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<{ noteNo: number; netKg: number } | null>(null);
  const { pending, submit } = useSubmit();

  const grossNum = Number(gross);
  const tareNum = Number(tare);
  const tareTotal = crates > 0 && tareNum >= 0 ? crates * tareNum : 0;
  const net = grossNum > 0 ? grossNum - tareTotal : 0;
  const valid = crop && crates > 0 && grossNum > 0 && tareNum >= 0 && net > 0 && buyerId;

  async function addBuyer() {
    setMsg(null);
    const r = await submit(() => quickAddBuyer(newBuyer));
    if (r.ok && r.id) {
      setBuyerList([...buyerList, { id: r.id, name: newBuyer.trim() }]);
      setBuyerId(r.id);
      setNewBuyer("");
      setAddingBuyer(false);
    } else setMsg(r.error ?? "تعذّر الإضافة");
  }

  async function onSave() {
    setMsg(null);
    const r = await submit(() =>
      recordScaleDelivery({
        crop,
        crates,
        grossKg: grossNum,
        tarePerCrate: tareNum,
        buyerId: buyerId || null,
        costCenterId: centerId || null,
        notes: null,
      }),
    );
    if (r.ok && r.noteNo != null) setDone({ noteNo: r.noteNo, netKg: r.netKg ?? net });
    else setMsg(r.error ?? "تعذّر التسجيل");
  }

  if (done) {
    const buyerName = buyerList.find((b) => b.id === buyerId)?.name ?? "";
    const share = encodeURIComponent(
      `بون تسليم مزارع عبيد رقم ${num(done.noteNo)}\n${crop} — صافي ${num(done.netKg)} كجم (${num(crates)} عبوة)\nالتاجر: ${buyerName}\nالسعر: يُحدد لاحقًا`,
    );
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 p-4 text-center">
          <div className="text-sm font-bold" style={{ color: "var(--ink-muted)" }}>بون تسليم رقم</div>
          <div className="text-6xl font-black tabular-nums" style={{ color: "var(--brand)" }}>
            {num(done.noteNo)}
          </div>
          <div className="text-lg font-bold" style={{ color: "var(--ink)" }}>
            {crop} — صافي {num(done.netKg)} كجم ({num(crates)} عبوة) — {buyerName}
          </div>
          <div className="text-sm" style={{ color: "var(--ink-muted)" }}>
            سُجّل بيعًا بسعر لاحق — لا يدخل الدفاتر حتى تحديد السعر.
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <a href={`https://wa.me/?text=${share}`} target="_blank" rel="noreferrer" className="inline-block">
              <Button>📲 أرسل البون واتساب</Button>
            </a>
            <Button variant="ghost" onClick={() => window.location.reload()}>+ حمولة أخرى</Button>
            <Link href="/finance/revenue-reports" className="inline-block">
              <Button variant="ghost">الأسعار المعلّقة</Button>
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>⚖️ الميزان — تسليم حمولة</h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          عدّ العبوات ← الوزن القائم ← البون يطلع بالصافي والرقم.
        </p>
      </header>
      {msg && <Alert tone="danger" title={msg} />}
      <Card>
        <div className="flex flex-col gap-4 p-1">
          <Field label="المحصول" id="sc-crop">
            <div className="flex flex-wrap gap-2">
              {CROPS.map((c) => (
                <Button key={c} size="sm" variant={crop === c ? undefined : "ghost"} onClick={() => setCrop(c)}>
                  {c}
                </Button>
              ))}
            </div>
          </Field>

          <Field label="عدد العبوات" id="sc-crates">
            <div className="flex items-center justify-center gap-4">
              <Button size="sm" variant="ghost" onClick={() => setCrates(Math.max(0, crates - 1))} aria-label="أنقص عبوة">−</Button>
              <span className="min-w-20 text-center text-4xl font-black tabular-nums" style={{ color: "var(--ink)" }}>
                {num(crates)}
              </span>
              <Button size="sm" onClick={() => setCrates(crates + 1)} aria-label="زد عبوة">+</Button>
              <Button size="sm" variant="ghost" onClick={() => setCrates(crates + 10)}>+١٠</Button>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="الوزن القائم (كجم)" id="sc-gross">
              <Input id="sc-gross" type="number" inputMode="decimal" min={0} step="0.5" value={gross} onChange={(e) => setGross(e.target.value)} />
            </Field>
            <Field label="وزن العبوة الفارغة (كجم)" id="sc-tare">
              <Input id="sc-tare" type="number" inputMode="decimal" min={0} step="0.1" value={tare} onChange={(e) => setTare(e.target.value)} />
            </Field>
          </div>

          <div className="rounded-md p-3 text-center" style={{ background: "var(--surface-sunken, #f4f7f5)" }}>
            <span className="text-sm" style={{ color: "var(--ink-muted)" }}>الصافي = {num(grossNum || 0)} − {num(tareTotal)} فوارغ = </span>
            <span className="text-3xl font-black tabular-nums" style={{ color: net > 0 ? "var(--brand)" : "var(--danger, #b23b3b)" }}>
              {num(Math.max(0, net))} كجم
            </span>
          </div>

          <Field label="التاجر (إلزامي — قاعدة الموسم: كل حمولة باسم)" id="sc-buyer">
            {!addingBuyer ? (
              <div className="flex gap-2">
                <select
                  id="sc-buyer"
                  className="w-full rounded-md px-3 py-2 text-sm"
                  style={{ border: "1px solid var(--line, rgba(0,0,0,0.15))", background: "var(--surface, #fff)" }}
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                >
                  <option value="">— اختر —</option>
                  {buyerList.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <Button size="sm" variant="ghost" onClick={() => setAddingBuyer(true)}>+ جديد</Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input id="sc-newbuyer" value={newBuyer} placeholder="اسم التاجر" onChange={(e) => setNewBuyer(e.target.value)} />
                <Button size="sm" onClick={addBuyer} disabled={pending || !newBuyer.trim()}>أضِف</Button>
                <Button size="sm" variant="ghost" onClick={() => setAddingBuyer(false)}>إلغاء</Button>
              </div>
            )}
          </Field>

          {centers.length > 0 && (
            <Field label="من أي أرض؟ (اختياري)" id="sc-cc">
              <select
                id="sc-cc"
                className="w-full rounded-md px-3 py-2 text-sm"
                style={{ border: "1px solid var(--line, rgba(0,0,0,0.15))", background: "var(--surface, #fff)" }}
                value={centerId}
                onChange={(e) => setCenterId(e.target.value)}
              >
                <option value="">— غير محدد —</option>
                {centers.map((c) => (
                  <option key={c.id} value={c.id}>{c.nameAr}</option>
                ))}
              </select>
            </Field>
          )}

          <Button onClick={onSave} disabled={!valid || pending}>
            {pending ? "جارٍ التسجيل…" : "سلّم واطبع البون ✓"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
