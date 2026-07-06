"use client";

// The stock-take count-sheet: one row per item showing the SYSTEM on-hand and an input for the PHYSICAL count,
// with a live signed variance. On save it reconciles each COUNTED item via the gated recordStockTake action
// (blank rows are skipped — "not counted", never assumed 0, #1). Honest result summary; on partial failure it
// keeps the entered counts so nothing is silently lost.

import { useState } from "react";
import { Alert, Button, Input } from "@/components/ui";
import { num } from "@/lib/money";
import { recordStockTake } from "@/app/(app)/inventory/stock-take/actions";

export interface StockTakeItem {
  id: string;
  name: string;
  unit: string;
  onHand: number;
}

export function StockTakeSheet({ items }: { items: StockTakeItem[] }) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; fail: number; errors: string[] } | null>(null);

  const entered = items.filter((it) => (counts[it.id] ?? "").trim() !== "");

  async function onSave() {
    setBusy(true);
    setResult(null);
    let ok = 0;
    let fail = 0;
    const errors: string[] = [];
    for (const it of entered) {
      const r = await recordStockTake(it.id, Number(counts[it.id]));
      if (r.ok) ok += 1;
      else {
        fail += 1;
        errors.push(`${it.name}: ${r.error ?? "خطأ"}`);
      }
    }
    setResult({ ok, fail, errors });
    if (fail === 0) setCounts({}); // clear only on full success
    setBusy(false);
  }

  if (items.length === 0) {
    return <Alert tone="info" title="لا أصناف في المخزون بعد." description="أضِف أصنافًا أو استلم بضاعة أولًا." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {result && (
        <Alert
          tone={result.fail === 0 ? "ok" : "danger"}
          title={result.fail === 0 ? `ضُبط ${num(result.ok)} صنف على الجرد ✓` : `ضُبط ${num(result.ok)} — تعذّر ${num(result.fail)}`}
          description={result.errors.length > 0 ? result.errors.join(" · ") : undefined}
        />
      )}

      <div className="flex flex-col gap-2">
        {items.map((it) => {
          const raw = counts[it.id] ?? "";
          const counted = raw.trim() === "" ? null : Number(raw);
          const variance = counted != null && Number.isFinite(counted) ? counted - it.onHand : null;
          return (
            <div
              key={it.id}
              className="flex flex-wrap items-center gap-3 border-b pb-2 last:border-0"
              style={{ borderColor: "var(--line)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="font-bold" style={{ color: "var(--ink)" }}>{it.name}</div>
                <div className="text-sm" style={{ color: "var(--ink-muted)" }}>
                  بالنظام: {num(it.onHand)} {it.unit}
                </div>
              </div>
              <div style={{ width: "8rem" }}>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  placeholder="المعدود"
                  value={raw}
                  onChange={(e) => setCounts((p) => ({ ...p, [it.id]: e.target.value }))}
                />
              </div>
              {variance != null && variance !== 0 && (
                <span
                  className="text-sm font-bold"
                  style={{ color: variance > 0 ? "var(--success, #15803d)" : "var(--danger, #b91c1c)" }}
                >
                  {variance > 0 ? "بونص +" : "عجز "}
                  {num(Math.abs(variance))} {it.unit}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <Button onClick={onSave} disabled={busy || entered.length === 0}>
        {busy ? "جارٍ الحفظ…" : `احفظ الجرد (${num(entered.length)} صنف)`}
      </Button>
    </div>
  );
}
