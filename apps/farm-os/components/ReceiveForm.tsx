"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, FormRow, Input, Alert } from "@/components/ui";
import { recordReceipt } from "@/app/(app)/purchase-requests/[prId]/actions";
import { num } from "@/lib/money";

/** One purchase-request line as the receive UI needs it. */
export interface ReceiveLine {
  /** inventory item id — the RPC's p_lines key (NOT the pr-item row id). */
  itemId: string;
  name: string;
  unit: string;
  /** ordered qty */
  qty: number;
  /** received-to-date balance */
  receivedQty: number;
}

/**
 * SPEC-0009 #155 — partial-receipt UI. Lets a storekeeper enter the actually-delivered qty per
 * still-open line (deliveries arrive partial), or one-click receive all remaining. Submits to
 * `recordReceipt`, which forwards the per-line map to fn_post_receipt's p_lines. Fully-received lines
 * are hidden. Over-receipt (RPC 23514) surfaces the Arabic error from toArabicError.
 */
export function ReceiveForm({ prId, lines }: { prId: string; lines: ReceiveLine[] }) {
  const router = useRouter();
  // Only lines with remaining-on-order are receivable; default each input to its full remaining.
  const openLines = lines.filter((l) => l.qty - l.receivedQty > 0);
  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(openLines.map((l) => [l.itemId, String(l.qty - l.receivedQty)])),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (openLines.length === 0) {
    return <p style={{ color: "var(--ink-muted)" }}>تم استلام جميع الأصناف.</p>;
  }

  async function submit(lineMap?: { item_id: string; qty: number }[]) {
    setPending(true);
    setError(null);
    try {
      const res = await recordReceipt(prId, lineMap);
      if (res.ok) router.refresh();
      else setError(res.error ?? "تعذّر تسجيل الاستلام");
    } catch {
      // Offline-tolerant (non-negotiable #2): a network reject must not strand the spinner on
      // the irreversible inventory path — surface a retryable Arabic message (mirrors ExecuteForm).
      setError("تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى.");
    } finally {
      setPending(false);
    }
  }

  function submitPartial() {
    // Send only lines with a positive qty; the RPC caps each at its remaining and rejects over-receipt.
    const lineMap = openLines
      .map((l) => ({ item_id: l.itemId, qty: Number(qtys[l.itemId] ?? "0") }))
      .filter((e) => Number.isFinite(e.qty) && e.qty > 0);
    // Guard: an all-blank/all-zero partial submit must NOT fall through to a full receipt. recordReceipt
    // treats "no lines" as receive-all-remaining (the ghost button), so an empty lineMap here would post
    // the WHOLE PR — the opposite of intent, on the irreversible inventory path. Require ≥1 positive qty.
    if (lineMap.length === 0) {
      setError("أدخل كمية مستلمة واحدة على الأقل.");
      return;
    }
    submit(lineMap);
  }

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="assertive" aria-atomic="true">
        {error && <Alert tone="danger" title={error} />}
      </div>
      <div className="flex flex-col gap-3">
        {openLines.map((l) => {
          const remaining = l.qty - l.receivedQty;
          return (
            <FormRow
              key={l.itemId}
              id={`recv-${l.itemId}`}
              label={`${l.name} — المتبقي ${num(remaining)} ${l.unit}`.trim()}
            >
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={remaining}
                value={qtys[l.itemId] ?? ""}
                onChange={(e) =>
                  setQtys((prev) => ({ ...prev, [l.itemId]: e.target.value }))
                }
              />
            </FormRow>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={pending} onClick={submitPartial}>
          تسجيل الكميات المستلمة
        </Button>
        <Button variant="ghost" loading={pending} onClick={() => submit()}>
          استلام كل المتبقي
        </Button>
      </div>
    </div>
  );
}
