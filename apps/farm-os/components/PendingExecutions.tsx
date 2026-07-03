"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Alert } from "@/components/ui";
import { num } from "@/lib/money";
import { executeOperation } from "@/app/(app)/m/execute/[opId]/actions";
import {
  subscribeOutbox,
  getOutboxSnapshot,
  getServerOutboxSnapshot,
  removeFromOutbox,
  type OutboxEntry,
} from "@/lib/exec-outbox";

/**
 * F1 — the offline outbox surface on «الميدان». Lists execute submissions that failed to reach the
 * server (network drop) and were saved on THIS device, and lets the worker RE-SEND each with an
 * explicit tap once back online. Confirm-on-reconnect: nothing replays automatically.
 *
 * Semantics (see lib/exec-outbox.ts): the outbox only exists to bridge a NETWORK gap. On resend, once
 * the server RESPONDS — accept or reject — the entry is dropped (the server is authoritative;
 * fn_execute_operation is idempotent so a duplicate is safe). The entry is kept ONLY when the resend
 * itself hits another network failure. The queue is read via useSyncExternalStore, so it reflects
 * localStorage (this tab + others) without a hydration mismatch — an empty outbox renders nothing.
 */
export function PendingExecutions() {
  const router = useRouter();
  const entries = useSyncExternalStore(subscribeOutbox, getOutboxSnapshot, getServerOutboxSnapshot);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  if (entries.length === 0) return null;

  async function resend(entry: OutboxEntry) {
    setBusyId(entry.id);
    setNote(null);
    let responded = false;
    try {
      const res = await executeOperation(entry.opId, entry.payload);
      responded = true;
      setNote(
        res.ok
          ? { tone: "ok", text: `تم إرسال «${entry.opLabel}» بنجاح.` }
          : { tone: "danger", text: res.error ?? `تعذّر إرسال «${entry.opLabel}».` },
      );
    } catch {
      // Still offline — keep the entry queued for a later attempt.
      setNote({ tone: "danger", text: "لا يزال الاتصال متعذّرًا. أعد المحاولة عند عودة الشبكة." });
    } finally {
      setBusyId(null);
    }
    if (responded) {
      // Server processed the payload (accepted or refused) → it is no longer "pending send". Drop it;
      // the store notifies this component to re-render the shorter list.
      removeFromOutbox(entry.id);
      router.refresh();
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <Alert
          tone="warning"
          title={`${num(entries.length)} تسجيل محفوظ على هذا الجهاز`}
          description="عمليات لم يكتمل إرسالها بسبب انقطاع الاتصال. أعد إرسالها عند عودة الشبكة."
        />
        <ul className="flex flex-col gap-2">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3 rounded-md border p-2"
              style={{ borderColor: "var(--line,#e5e7eb)" }}
            >
              <span className="font-medium">{e.opLabel}</span>
              <Button variant="primary" loading={busyId === e.id} onClick={() => resend(e)}>
                إعادة الإرسال
              </Button>
            </li>
          ))}
        </ul>
        <div aria-live="assertive" aria-atomic="true">
          {note && <Alert tone={note.tone} title={note.text} />}
        </div>
      </div>
    </Card>
  );
}
