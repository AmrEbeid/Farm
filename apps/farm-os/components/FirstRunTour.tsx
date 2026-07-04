"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/ui";

// SPEC-0025 U-6 (final piece) — the first-run tour: three plain-Arabic cards, once per browser
// (localStorage), role-aware, dismissible forever. Not a modal maze — one small card at the top of the
// dashboard that walks: سجّل ← المعاملات ← التقارير (or the field trio for the FM/supervisor).

const KEY = "fos-tour-done-v1";

// SSR-safe, effect-free localStorage read: false on the server, the stored flag on the client.
const noopSubscribe = () => () => {};
function useTourDone(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => {
      try {
        return window.localStorage.getItem(KEY) != null;
      } catch {
        return true; // storage unavailable → skip the tour, never block the page
      }
    },
    () => true,
  );
}

interface Step {
  icon: string;
  title: string;
  body: string;
  href: string;
  cta: string;
}

const FINANCE_STEPS: Step[] = [
  { icon: "➕", title: "سجّل ما حدث", body: "مصروف، بيع، تحصيل، عهدة — احكِ ما حدث خطوة بخطوة والنظام يمسك الدفاتر.", href: "/record", cta: "جرّب «سجّل»" },
  { icon: "📜", title: "كل المعاملات في مكان واحد", body: "ابحث ورشّح وصدّر كل حركات الفلوس من جدول واحد.", href: "/transactions", cta: "افتح المعاملات" },
  { icon: "📈", title: "التقارير تحكي القصة", body: "كل تقرير يبدأ بجملة تشرح الوضع — ثم الرسم ثم التفاصيل.", href: "/reports", cta: "افتح التقارير" },
];

const FIELD_STEPS: Step[] = [
  { icon: "➕", title: "سجّل ما حدث", body: "خطة الأسبوع، استلام بضاعة، حضور العمالة — من مكان واحد.", href: "/record", cta: "جرّب «سجّل»" },
  { icon: "📱", title: "الميدان في جيبك", body: "مهامك اليومية وتنفيذ العمليات من الهاتف.", href: "/m", cta: "افتح الميدان" },
  { icon: "📈", title: "التقارير", body: "تقدّم الخطط والمخزون والفسائل — كل تقرير يبدأ بالخلاصة.", href: "/reports", cta: "افتح التقارير" },
];

export function FirstRunTour({ role }: { role: string }) {
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const alreadyDone = useTourDone();
  if (alreadyDone || dismissed) return null;

  const steps = role === "owner" || role === "accountant" ? FINANCE_STEPS : FIELD_STEPS;
  const s = steps[step];
  const done = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 p-1">
        <span className="text-2xl" aria-hidden>
          {s.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bold" style={{ color: "var(--ink)" }}>
            {s.title} <span className="text-xs font-normal" style={{ color: "var(--ink-muted)" }}>({step + 1} من {steps.length})</span>
          </div>
          <div className="text-sm" style={{ color: "var(--ink-muted)" }}>{s.body}</div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={s.href} className="inline-block" onClick={done}>
            <Button size="sm">{s.cta}</Button>
          </Link>
          {step < steps.length - 1 ? (
            <Button size="sm" variant="ghost" onClick={() => setStep(step + 1)}>التالي</Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={done} aria-label="إغلاق الجولة">تخطَّ ✕</Button>
        </div>
      </div>
    </Card>
  );
}
