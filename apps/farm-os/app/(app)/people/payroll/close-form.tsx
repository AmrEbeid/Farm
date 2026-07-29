"use client";

// The close form. Two-step by design: the first button only REVEALS an Arabic confirmation strip
// that states, in words, that the snapshot is immutable and that the period's attendance is frozen
// afterwards. Nothing is sent until «تأكيد الإقفال». No native browser dialog is used — it could not
// carry this RTL copy and is not on the same keyboard/AT path as the rest of the page.
//
// DUPLICATE SUBMIT. One `pending` flag disables both the confirm and the cancel controls and is the
// first thing `submit` checks, so a double click, an Enter-key repeat and a re-render all collapse
// into a single in-flight call. The server is idempotent for an exact replay anyway — this keeps the
// UI from *looking* like it closed twice.
//
// The same pure validator the server action uses runs here first, so a bad period is explained
// instantly and never becomes a round-trip.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input } from "@/components/ui";
import { num } from "@/lib/money";
import { PAYROLL_MAX_PERIOD_DAYS, parsePayrollPeriod } from "@/lib/payroll-close";
import { closePayrollRun, type PayrollCloseResult } from "./actions";

const CONNECTION_FAILED_AR = "تعذّر الاتصال بالخادم. لم يُقفل شيء؛ حاول مرة أخرى.";

export const PAYROLL_FREEZE_WARNING_AR =
  "الإقفال نهائي: تُجمَّد أجور هذه الفترة كما هي الآن ولا يمكن تعديلها أو حذفها لاحقًا، ويُمنع بعدها تسجيل أو تعديل أو حذف أي ساعات عمل داخل نفس الفترة. لا يُدفع بهذا الإقفال أي مبلغ ولا يُنشأ أي قيد محاسبي.";

export function PayrollCloseForm({ todayIso }: { todayIso: string }) {
  const router = useRouter();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const submittingRef = useRef(false);

  function review() {
    setMsg(null);
    const period = parsePayrollPeriod(start, end);
    if (!period.ok) {
      setConfirming(false);
      setMsg({ tone: "danger", text: period.error });
      return;
    }
    setConfirming(true);
  }

  async function submit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setMsg(null);
    let result: PayrollCloseResult;
    try {
      result = await closePayrollRun({ periodStart: start, periodEnd: end, confirmImmutable: true });
    } catch {
      result = { ok: false, error: CONNECTION_FAILED_AR };
    }
    submittingRef.current = false;
    setPending(false);
    if (!result.ok) {
      setMsg({ tone: "danger", text: result.error });
      return;
    }
    setConfirming(false);
    setMsg({ tone: "ok", text: "تم إقفال الفترة وتجميد لقطة الأجور." });
    if (result.runId) {
      router.push(`/people/payroll/${result.runId}`);
      return;
    }
    router.refresh();
  }

  return (
    <section
      className="no-print flex flex-col gap-3 rounded-md p-4"
      style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
      aria-labelledby="payroll-close-heading"
    >
      <h2 id="payroll-close-heading" className="text-base font-bold">
        إقفال فترة جديدة
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="من تاريخ" id="payroll-period-start" required>
          <Input
            id="payroll-period-start"
            type="date"
            max={todayIso}
            value={start}
            disabled={pending}
            onChange={(event) => {
              setStart(event.target.value);
              setConfirming(false);
            }}
          />
        </Field>
        <Field label="إلى تاريخ" id="payroll-period-end" required>
          <Input
            id="payroll-period-end"
            type="date"
            max={todayIso}
            value={end}
            disabled={pending}
            onChange={(event) => {
              setEnd(event.target.value);
              setConfirming(false);
            }}
          />
        </Field>
      </div>

      <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
        فترة واحدة متصلة، بحد أقصى {num(PAYROLL_MAX_PERIOD_DAYS)} يومًا، ولا تمتد إلى تاريخ مستقبلي.
      </p>

      {!confirming && (
        <div>
          <Button type="button" onClick={review} disabled={pending}>
            مراجعة الإقفال
          </Button>
        </div>
      )}

      {confirming && (
        <div className="flex flex-col gap-2 rounded-md px-3 py-2" style={{ background: "var(--surface-raised)" }}>
          <p className="text-xs" style={{ color: "var(--ink)" }}>
            {PAYROLL_FREEZE_WARNING_AR}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" onClick={submit} loading={pending} disabled={pending}>
              تأكيد الإقفال
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
              إلغاء
            </Button>
          </div>
        </div>
      )}

      <div role="alert" aria-live="assertive" aria-atomic="true">
        {msg && <Alert tone={msg.tone} title={msg.text} />}
      </div>
    </section>
  );
}
