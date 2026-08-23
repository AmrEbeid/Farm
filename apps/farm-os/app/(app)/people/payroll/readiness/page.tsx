// «جاهزية الرواتب للتجربة» — the owner/accountant preparation sheet (SPEC-0006 · docs/PILOT-READINESS.md).
//
// WHAT IT IS. A printable, dateable checklist plus three VALIDATION-ONLY templates. It prepares a
// payroll pilot; it does not run one, does not import one, and does not certify one.
//
// WHAT IT REFUSES TO DO. It never claims completion and never shows a percentage. Every gate that
// matters here is a human signature the app cannot observe, and a progress bar over unobservable
// gates reads as reassurance the system has no basis for. The one automated line proves SHAPE only.
//
// ACCESS. owner/accountant only (`requireRole`), the same pair behind the wage table, the
// payroll close, and the three descriptors' own `allowedRoles` — which the API re-enforces
// server-side before it reads a template or parses an upload. The nav entry carries the same two
// roles, so the page never appears to a role it would redirect.
//
// NO READS AT ALL. This page queries nothing. It holds no roster, no rate and no hour, so there is
// no wage or labor read to gate and nothing on it that could leak. The only thing that ever touches
// real data is the person-name reference lookup inside a dry-run, which happens in the API route,
// RLS-scoped, and returns no names to the client.
//
// PRINTING. The checklist is a list of record blocks with a signature/date line left deliberately
// blank: the artifact that matters is the signed paper, and the page exists to produce it.
//
// MOBILE-FIRST, NO TABLE. R4b replaces the checklist's raw table with stacked record blocks — a table
// this wide cannot reflow into a small screen without a horizontal scrollbar, and the mobile-first
// convention the rest of the R4b/R4a surfaces share forbids one here too.

import type { ReactNode } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { num } from "@/lib/money";
import { PrintButton } from "@/components/print-button";
import { ImportPanel } from "@/components/import/ImportPanel";
import {
  PAYROLL_READINESS_ITEMS,
  READINESS_EVIDENCE_AR,
  READINESS_EVIDENCE_MEANING_AR,
  READINESS_NO_WRITE_AR,
  READINESS_OUT_OF_SCOPE_AR,
  READINESS_PURPOSE_AR,
  READINESS_SYNTHETIC_ONLY_AR,
  READINESS_UNSIGNED_AR,
  type ReadinessEvidence,
} from "@/lib/payroll-readiness";
// The three templates, already in the order the checklist walks them: who → what they earn → what
// they did. Taken from the descriptor module rather than re-listed here, so the page cannot fall out
// of sync with the set that is actually registered.
import { PAYROLL_READINESS_DESCRIPTORS } from "@/lib/import/descriptors/payroll-readiness";

export const dynamic = "force-dynamic";

const mutedStyle = { color: "var(--ink-muted)" } as const;
const boxStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;
const EVIDENCE_ORDER: ReadinessEvidence[] = ["automated", "human"];

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="fos-btn fos-btn--secondary fos-btn--md"
      style={{ minHeight: 44 }}
    >
      {children}
    </Link>
  );
}

export default async function PayrollReadinessPage() {
  const m = await requireRole(["owner", "accountant"]);
  // Attendance is a labor.write surface (owner/farm_manager/supervisor); an accountant would be
  // redirected, so only the owner is offered the link — same rule as the other payroll pages.
  const canOpenAttendance = m.role === "owner";

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-bold">جاهزية الرواتب للتجربة</h1>
        <span className="text-xs" style={mutedStyle}>
          {READINESS_PURPOSE_AR}
        </span>
        <div className="no-print ms-auto flex flex-wrap items-center gap-2">
          <PrintButton label="طباعة قائمة الجاهزية" />
          <HeaderLink href="/people/payroll/compensation">أجور الفريق</HeaderLink>
          {canOpenAttendance && <HeaderLink href="/people/attendance">تسجيل الحضور</HeaderLink>}
          <HeaderLink href="/people/payroll">إقفال الرواتب</HeaderLink>
        </div>
      </header>

      <p className="flex items-start gap-2 rounded-md p-3 text-xs" style={boxStyle}>
        <Lock aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
        <span>
          {READINESS_NO_WRITE_AR} {READINESS_SYNTHETIC_ONLY_AR} {READINESS_OUT_OF_SCOPE_AR}
        </span>
      </p>

      <section className="flex flex-col gap-2" aria-labelledby="readiness-checklist-heading">
        <h2 id="readiness-checklist-heading" className="text-base font-bold">
          قائمة التحضير
        </h2>
        <dl className="flex flex-col gap-1 text-xs" style={mutedStyle}>
          {EVIDENCE_ORDER.map((kind) => (
            <div key={kind} className="flex flex-wrap gap-x-2">
              <dt className="font-semibold">{READINESS_EVIDENCE_AR[kind]}:</dt>
              <dd>{READINESS_EVIDENCE_MEANING_AR[kind]}</dd>
            </div>
          ))}
        </dl>

        <ul>
          {PAYROLL_READINESS_ITEMS.map((item, index) => (
            <li
              key={item.id}
              className="border-b py-3 last:border-b-0"
              style={{ borderColor: "var(--line)" }}
            >
              <p className="text-sm font-semibold">
                {num(index + 1)}. {item.titleAr}
              </p>
              <p className="mt-0.5 text-xs" style={mutedStyle}>
                {item.detailAr}
              </p>
              <p className="mt-1 text-xs" style={mutedStyle}>
                {READINESS_EVIDENCE_AR[item.evidence]} · {READINESS_UNSIGNED_AR}
              </p>
              {/* Deliberately empty: the signature and its date are written by hand on the
                  printout. The app never records, infers or pre-fills either one. */}
              <p className="mt-1 text-xs" style={mutedStyle}>
                <span aria-hidden="true">التوقيع والتاريخ: ………………………… / ……… / ……… / ………</span>
                <span className="sr-only">فراغ للتوقيع والتاريخ</span>
              </p>
            </li>
          ))}
        </ul>
      </section>

      {PAYROLL_READINESS_DESCRIPTORS.map((descriptor) => (
        <section
          key={descriptor.key}
          className="no-print flex flex-col gap-2"
          aria-labelledby={`readiness-${descriptor.key}-heading`}
        >
          <h2 id={`readiness-${descriptor.key}-heading`} className="text-base font-bold">
            {descriptor.titleAr}
          </h2>
          <ImportPanel descriptorKey={descriptor.key} titleAr={descriptor.titleAr} validationOnly />
        </section>
      ))}

      <p className="text-xs" style={mutedStyle}>
        خطة التجربة الكاملة وقواعد مشاركة البيانات موجودة في مستند جاهزية التجربة{" "}
        <span dir="ltr">docs/PILOT-READINESS.md</span>، ومواصفة الرواتب في{" "}
        <span dir="ltr">docs/SPEC-0006-people-labor-payroll.md</span>. لشرح هذه الصفحة داخل النظام
        افتح «؟» من الشريط العلوي.
      </p>
    </div>
  );
}
