"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { egp } from "@/lib/money";
import { recordCustodyMovement } from "@/app/(app)/custody/actions";

// SPEC-0025 U-2 — cash IN: «استلمت عهدة من المالك». One question, one confirmation; the gated RPC
// posts the funding journal itself. Plain Arabic — no internal vocabulary.

export function CustodyInWizard({ accounts }: { accounts: { id: string; label: string }[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { pending, submit } = useSubmit();
  const amountNum = Number(amount);
  const label = accounts.find((a) => a.id === accountId)?.label;

  async function onSave() {
    setMsg(null);
    const r = await submit(() =>
      recordCustodyMovement({
        accountId,
        movementType: "استلام عهدة من المالك",
        amountIn: amountNum,
        amountOut: 0,
        note: note || null,
      }),
    );
    if (r.ok) setDone(true);
    else setMsg(r.error ?? "تعذّر التسجيل");
  }

  if (done) {
    return (
      <Card>
        <div className="flex flex-col gap-3 p-2">
          <h2 className="text-lg font-bold" style={{ color: "var(--ink)" }}>✅ تم — دخلت النقدية العهدة وقُيّدت في الدفاتر.</h2>
          <div className="flex gap-2">
            <Button onClick={() => window.location.reload()}>+ استلام آخر</Button>
            <Link href="/record" className="inline-block"><Button variant="ghost">رجوع إلى «سجّل»</Button></Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>استلمت عهدة من المالك</h1>
      </header>
      {msg && <Alert tone="danger" title={msg} />}
      {accounts.length === 0 ? (
        <Alert tone="warning" title="لا توجد حسابات عهدة نشطة — أنشئ واحدًا من صفحة العهدة أولًا." />
      ) : (
        <Card>
          <div className="flex flex-col gap-3 p-1">
            <Field label="أي عهدة استلمت المبلغ؟" id="ci-acct">
              <select
                id="ci-acct"
                className="w-full rounded-md px-3 py-2 text-sm"
                style={{ border: "1px solid var(--line, rgba(0,0,0,0.15))", background: "var(--surface, #fff)" }}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </Field>
            <Field label="المبلغ (ج.م)" id="ci-amt">
              <Input id="ci-amt" type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
            <Field label="ملاحظة (اختياري)" id="ci-note">
              <Input id="ci-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            </Field>
            {Number.isFinite(amountNum) && amountNum > 0 && label && (
              <div className="rounded-md p-3 text-sm" style={{ background: "var(--surface-sunken, #f4f7f5)", color: "var(--ink)" }}>
                <strong>سيُسجَّل:</strong> استلام {egp(amountNum)} في عهدة «{label}» — صحيح؟
              </div>
            )}
            <div>
              <Button onClick={onSave} disabled={pending || !(amountNum > 0) || !accountId}>
                {pending ? "جارٍ الحفظ…" : "احفظ ✓"}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
