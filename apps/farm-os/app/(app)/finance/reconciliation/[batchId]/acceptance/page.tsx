// Reconciliation ACCEPTANCE report — the printable, read-only artifact an accountant and the owner
// sign against one staged batch (SPEC-0004; the "dual-run / accountant acceptance" resume point).
//
// A SEPARATE route on purpose: the batch review page stays as fast as it is (it only gains a link),
// and the whole-batch read that this report needs — every row, with its evidence — happens only when
// someone actually opens the report.
//
// READ-ONLY AND FAIL-CLOSED. Owner/accountant only, narrowed to the ACTIVE org, bounded to
// ACCEPTANCE_MAX_ROWS — all three enforced in the database by the single-snapshot read RPC, not only
// here. If the batch is larger than the bound, if the read fails, if the rows do not match the batch's
// own row count, or if the batch's stored row count disagrees with what the staging tool recorded on
// it, the page renders an Arabic refusal and NO figures — a partial acceptance report is worse than
// none, because it would be signed.
//
// TRUTHFUL TENSE. Every "will be recorded" phrase on this page comes from ACCEPTANCE_PHASE_COPY, keyed
// on the batch's own status: an executed batch reads "was recorded", a rolled-back one "was recorded
// then reversed", and an interrupted or unrecognised one claims neither.
//
// CONTENT BINDING. This page and the separately requested CSV each compute a SHA-256 digest from
// their complete read. Matching digests prove matching captured content; a later CSV is visibly not
// the annex of this signed page when its digest differs.
//
// CONTROL TOTALS PREPARE A DUAL RUN; THEY DO NOT PERFORM ONE. The period/sheet breakdowns re-group
// the rows this same read already returned — no extra query, no stored figure. A calendar month is
// not a fiscal period and these are not the workbook's own totals: the report says so unconditionally
// (ACCEPTANCE_CONTROL_TOTALS_CAVEAT_AR), and mapping the buckets onto accounting periods — like
// choosing what to run the comparison against — stays the accountant's decision.

import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Tag } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { requireRole } from "@/lib/auth";
import { fmtDate } from "@/lib/dates";
import { egpDecimalSummary } from "@/lib/decimal";
import { num } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import {
  ACCEPTANCE_ASSERTION_FIELDS,
  ACCEPTANCE_ASSERTION_PROHIBITION_AR,
  ACCEPTANCE_CONTROL_TOTALS_CAVEAT_AR,
  ACCEPTANCE_CORRECTION_CAVEAT_AR,
  ACCEPTANCE_DIGEST_ALGORITHM,
  ACCEPTANCE_DIGEST_NOTE_AR,
  ACCEPTANCE_MAX_ROWS,
  ACCEPTANCE_NO_DUAL_RUN_AR,
  ACCEPTANCE_SIGNATORIES_AR,
  ACCEPTANCE_SIGNATURE_LINES_AR,
  acceptanceCsvHref,
  buildAcceptancePackage,
  type AcceptanceAssertionField,
  type AcceptanceControlTotal,
  type AcceptanceTotal,
} from "@/lib/reconciliation acceptance";
import { loadAcceptanceBatch } from "@/lib/reconciliation acceptance data";
import { BATCH_STATUS_AR, isUuid, type BatchStatus, type Tone } from "@/lib/reconciliation review";

export const dynamic = "force-dynamic";

const mutedStyle = { color: "var(--ink-muted)" } as const;
const boxStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;
const cellStyle = { borderBottom: "1px solid var(--line)" } as const;
const linkStyle = { border: "1px solid var(--line)", color: "var(--ink)" } as const;
const NOT_RECORDED_AR = "غير مُسجَّل";

/** `mono` renders an identifier (uuid/hash) left-to-right so it stays readable inside the RTL page. */
function Figure({
  label,
  value,
  mono,
  className = "",
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={`rounded-md px-2 py-1.5 ${className}`.trim()} style={boxStyle}>
      <div className="text-[11px]" style={mutedStyle}>
        {label}
      </div>
      {mono ? (
        <div className="break-all font-mono text-[11px]" dir="ltr">
          {value}
        </div>
      ) : (
        <div className="text-sm font-semibold tabular-nums">{value}</div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-bold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Totals table: row count, how many of those actually carry a source amount, and their exact sum.
 * The last row is the batch-wide total, so a reader can see the groups add up to the whole batch.
 */
function TotalsTable({
  caption,
  totals,
  footer,
}: {
  caption: string;
  totals: AcceptanceTotal[];
  footer?: AcceptanceTotal;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-xs" style={boxStyle}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {["البند", "عدد الصفوف", "صفوف بمبلغ مصدر", "إجمالي مبلغ المصدر"].map((header) => (
              <th key={header} className="p-1.5 text-start font-semibold" style={cellStyle}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {totals.map((total) => (
            <tr key={total.key}>
              <td className="p-1.5" style={cellStyle}>
                {total.label}
              </td>
              <td className="p-1.5 tabular-nums" style={cellStyle}>
                {num(total.rowCount)}
              </td>
              <td className="p-1.5 tabular-nums" style={cellStyle}>
                {num(total.withSourceAmount)}
              </td>
              <td className="p-1.5 tabular-nums" style={cellStyle}>
                {egpDecimalSummary(total.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="font-semibold">
              <td className="p-1.5">{footer.label}</td>
              <td className="p-1.5 tabular-nums">{num(footer.rowCount)}</td>
              <td className="p-1.5 tabular-nums">{num(footer.withSourceAmount)}</td>
              <td className="p-1.5 tabular-nums">{egpDecimalSummary(footer.amount)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/**
 * One control-total section: a run of groups, optionally closed by its own subtotal row. `ltrLabels`
 * is for the ISO period keys (`2024-01`), which must not be re-ordered by the RTL paragraph
 * direction; sheet names are ordinary Arabic text and stay in the page direction.
 */
interface ControlSection {
  key: string;
  totals: AcceptanceControlTotal[];
  subtotal?: AcceptanceControlTotal;
  ltrLabels?: boolean;
}

/**
 * Control totals: the same five figures per group — rows, rows carrying a source amount, rows with
 * none, the exact source total, and the part of it whose reported destination is a posting. The
 * footer is the whole batch, so the groups are visibly an exact partition of it.
 */
function ControlTotalsTable({
  caption,
  postingHeader,
  sections,
  footer,
}: {
  caption: string;
  postingHeader: string;
  sections: ControlSection[];
  footer: AcceptanceControlTotal;
}) {
  const cells = (total: AcceptanceControlTotal) => [
    num(total.rowCount),
    num(total.withSourceAmount),
    num(total.unknownCount),
    egpDecimalSummary(total.amount),
    egpDecimalSummary(total.postingAmount),
  ];
  return (
    // `print-fit-table` (globals.css) is what keeps all six columns ON the portrait page: on paper the
    // wrapper stops scrolling and the table drops `min-w` for fixed, wrapping columns. Without it a
    // horizontal scrollbar prints as a silently clipped column of a signed control total.
    <div className="print-fit-table overflow-x-auto">
      <table className="w-full min-w-[44rem] text-xs" style={boxStyle}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {["المجموعة", "عدد الصفوف", "صفوف بمبلغ مصدر", "صفوف بلا مبلغ مسجَّل", "إجمالي مبلغ المصدر", postingHeader].map(
              (header) => (
                <th key={header} className="p-1.5 text-start font-semibold" style={cellStyle}>
                  {header}
                </th>
              ),
            )}
          </tr>
        </thead>
        {sections.map((section) => (
          <tbody key={section.key}>
            {section.totals.map((total) => (
              <tr key={total.key}>
                <td className="p-1.5" style={cellStyle}>
                  {section.ltrLabels ? (
                    <span className="tabular-nums" dir="ltr">
                      {total.label}
                    </span>
                  ) : (
                    total.label
                  )}
                </td>
                {cells(total).map((value, index) => (
                  <td key={index} className="p-1.5 tabular-nums" style={cellStyle}>
                    {value}
                  </td>
                ))}
              </tr>
            ))}
            {section.subtotal && (
              <tr className="font-semibold">
                <td className="p-1.5" style={cellStyle}>
                  {section.subtotal.label}
                </td>
                {cells(section.subtotal).map((value, index) => (
                  <td key={index} className="p-1.5 tabular-nums" style={cellStyle}>
                    {value}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        ))}
        <tfoot>
          <tr className="font-semibold">
            <td className="p-1.5">{footer.label}</td>
            {cells(footer).map((value, index) => (
              <td key={index} className="p-1.5 tabular-nums">
                {value}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Blank, print-only ruled lines — filled in by hand on the printed copy. */
function SignatureBlock({ role }: { role: string }) {
  return (
    <div className="rounded-md p-2" style={boxStyle}>
      <div className="text-xs font-semibold">{role}</div>
      {ACCEPTANCE_SIGNATURE_LINES_AR.map((field) => (
        <div key={field} className="mt-4 flex items-end gap-2 text-[11px]" style={mutedStyle}>
          <span>{field}</span>
          <span className="grow" style={{ borderBottom: "1px solid var(--line)" }} />
        </div>
      ))}
    </div>
  );
}

/**
 * One blank assertion field: its label, the instruction for filling it, and the rule the signer writes
 * on. The system stores none of these — the paper is the record — so nothing here is pre-filled.
 */
function AssertionField({ field }: { field: AcceptanceAssertionField }) {
  return (
    <div className="mt-2">
      <div className="text-[11px] font-semibold">{field.label}</div>
      <div className="text-[10px]" style={mutedStyle}>
        {field.hint}
      </div>
      <div className="mt-4" style={{ borderBottom: "1px solid var(--line)" }} />
    </div>
  );
}

export default async function ReconciliationAcceptancePage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { batchId } = await params;

  // Fail closed on a malformed id — never send it to PostgREST.
  if (!isUuid(batchId)) notFound();

  const load = await loadAcceptanceBatch(sb, batchId, m.orgId);
  const backHref = `/finance/reconciliation/${encodeURIComponent(batchId)}`;

  // Missing or cross-org (RLS) → 404, exactly like the batch page.
  if (!load.ok && load.kind === "not_found") notFound();

  if (!load.ok) {
    // Refusal, not a partial report: no counts, no totals, nothing signable on the page.
    return (
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-lg font-bold">تقرير قبول التسوية</h1>
          <Link href={backHref} className="ms-auto rounded-md px-3 py-1 text-sm" style={linkStyle}>
            رجوع إلى الدفعة
          </Link>
        </header>
        <Alert tone="danger" title="لم يصدر تقرير قبول" description={load.error} />
      </div>
    );
  }

  const { batch, rows } = load;
  // This request produces one internally consistent package. The separate CSV must match its digest.
  const { report, hashes, staged, outcome, digest } = buildAcceptancePackage(batch, rows);
  // `malformed` never reaches here (the loader refuses it), so a non-recorded state means the
  // execution/rollback verdict legitimately replaced the staging record.
  const stagedCounts = staged.kind === "recorded" ? staged.counts : null;
  const statusMeta: { label: string; tone: Tone } = BATCH_STATUS_AR[batch.status as BatchStatus] ?? {
    label: batch.status,
    tone: "neutral" as const,
  };
  const sourceLabel =
    batch.source_label?.trim() ||
    (batch.source_workbook_sha256 ? `دفتر ${batch.source_workbook_sha256.slice(0, 8)}` : "دفعة تسوية");
  const issuedOn = fmtDate(new Date());
  // Both breakdowns partition the SAME batch, so both close on the same batch-wide total row.
  const batchTotalRow: AcceptanceTotal = {
    key: "all",
    label: "الإجمالي — كل صفوف الدفعة",
    rowCount: report.rowCount,
    withSourceAmount: report.sourceTotal.knownCount,
    amount: report.sourceTotal,
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-sm sm:p-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="min-w-0 break-words text-lg font-bold">
          تقرير قبول التسوية — {sourceLabel}
        </h1>
        <Tag tone={statusMeta.tone}>{statusMeta.label}</Tag>
        <span className="text-xs" style={mutedStyle}>
          تقرير للقراءة فقط: لا يراجع ولا يُجمِّد ولا يعتمد ولا ينفّذ أي صف.
        </span>
        <div className="no-print ms-auto flex flex-wrap items-center gap-2">
          <a
            href={acceptanceCsvHref(batchId)}
            className="rounded-md px-3 py-1 text-sm"
            style={linkStyle}
            download
          >
            تنزيل سجل الصفوف (CSV)
          </a>
          <PrintButton label="طباعة تقرير القبول" />
          <Link href={backHref} className="rounded-md px-3 py-1 text-sm" style={linkStyle}>
            رجوع إلى الدفعة
          </Link>
        </div>
      </header>

      <Alert tone="warning" title="ما لم يُسجَّل بعد" description={ACCEPTANCE_NO_DUAL_RUN_AR} />

      {/* The digest binds this printed page to the CSV annex. It is deliberately the first figure on
          the page and repeats on the signature sheet, so it is on paper wherever a signature is. */}
      <section className="rounded-md p-3" style={boxStyle}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="text-sm font-bold">بصمة حزمة القبول ({ACCEPTANCE_DIGEST_ALGORITHM})</h2>
          <span className="text-[11px]" style={mutedStyle}>
            قارنها بالبصمة المكتوبة في كل سطر من ملف CSV قبل التوقيع.
          </span>
        </div>
        <div className="mt-1 break-all font-mono text-sm font-semibold" dir="ltr">
          {digest}
        </div>
        <p className="mt-1 text-xs" style={mutedStyle}>
          {ACCEPTANCE_DIGEST_NOTE_AR}
        </p>
      </section>

      <Section title="بيانات الدفعة ومصدرها">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Figure label="مُعرّف الدفعة" value={batch.id} mono />
          <Figure label="الحالة" value={statusMeta.label} />
          <Figure label="تاريخ الإنشاء" value={fmtDate(batch.created_at)} />
          <Figure
            label="مُعرّف منشئ الدفعة"
            value={batch.created_by ?? NOT_RECORDED_AR}
            mono={batch.created_by !== null}
          />
          <Figure
            label="تاريخ اعتماد المالك"
            value={batch.approved_at ? fmtDate(batch.approved_at) : NOT_RECORDED_AR}
          />
          <Figure
            label="مُعرّف معتمد الدفعة"
            value={batch.approved_by ?? NOT_RECORDED_AR}
            mono={batch.approved_by !== null}
          />
          {/* A recorded hash renders as an LTR digest; an unrecorded one reads as ordinary Arabic
              text, exactly like every other «غير مُسجَّل» figure on this page. */}
          {hashes.map((hash) => (
            <Figure
              key={hash.key}
              label={hash.label}
              value={hash.value ?? NOT_RECORDED_AR}
              mono={hash.value !== null}
              className="sm:col-span-2"
            />
          ))}
        </div>
        <p className="text-xs" style={mutedStyle}>
          تُسجَّل بصمات الأداة عند التجهيز، ويستبدلها التنفيذ أو التراجع بنتيجته؛ لذلك تظهر «
          {NOT_RECORDED_AR}» بعد التنفيذ بدل إعادة تكوينها.
        </p>
      </Section>

      {/* The batch's OWN lifecycle record. The digest binds this record in full — every nested field,
          displayed or not — so a re-execution with a different verdict cannot share this signature.
          Row-level fields (§2.7 redaction) are counted, never printed. */}
      <Section title="ما سجّلته الدفعة عن نفسها">
        {outcome.empty ? (
          <p className="text-xs" style={mutedStyle}>
            لا تحمل هذه الدفعة أي سجل نتيجة ({NOT_RECORDED_AR}). يحدث ذلك أثناء التنفيذ أو التراجع
            قبل كتابة النتيجة النهائية — وهي حالة لا يُوقَّع فيها قبول.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {outcome.lines.map((line) => (
              <Figure key={line.key} label={line.label} value={line.value} />
            ))}
          </div>
        )}
        <p className="text-xs" style={mutedStyle}>
          هذه هي حصيلة الدفعة كما كتبها النظام في سجلها، لا كما يستنتجها هذا التقرير.
          {outcome.withheldCount > 0 &&
            ` ولا يُعرض ${num(outcome.withheldCount)} حقلًا أو مجموعة بيانات أخرى لأنها غير مدرجة في قائمة العرض الآمنة؛ وقد تشمل بيانات أداة مجمّعة أو مُعرِّفات حساسة على مستوى الصف.`}{" "}
          وتدخل هذه الحقول كلها — المعروض منها وغير المعروض — في حساب بصمة الحزمة أعلاه، فأي تغيّر فيها
          يغيّر البصمة.
        </p>
      </Section>

      <Section title="اكتمال القراءة">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Figure label="صفوف قُرئت في هذا التقرير" value={num(report.rowCount)} />
          <Figure
            label="عدد صفوف الدفعة عند التجهيز"
            value={stagedCounts ? num(stagedCounts.batchRowCount) : NOT_RECORDED_AR}
          />
          <Figure
            label="عدد الأدلة عند التجهيز"
            value={stagedCounts ? num(stagedCounts.evidenceItemCount) : NOT_RECORDED_AR}
          />
          <Figure label="الحد الأقصى للتحميل الكامل" value={`${num(ACCEPTANCE_MAX_ROWS)} صف`} />
        </div>
        <p className="text-xs" style={mutedStyle}>
          قُرئت الدفعة كاملة في لقطة واحدة من قاعدة البيانات: صفوفها وأدلتها وأسماء أبعادها في استعلام
          واحد. ولا يصدر هذا التقرير أصلًا إلا إذا طابق عدد الصفوف المقروءة عدد صفوف الدفعة المخزَّن،
          وطابق ما سجّلته أداة التجهيز — وإلا فالنتيجة رفض بلا أرقام. يستبدل التنفيذ أو التراجع بيان
          التجهيز بنتيجة نهائية معروفة عند التنفيذ أو الفشل أو التراجع، فتظهر عندئذٍ «
          {NOT_RECORDED_AR}» بدل أعداد التجهيز، ويسقط معها هذا التطابق. ولا تُقبل أعداد غائبة في حالة
          التجهيز أو المراجعة أو الاعتماد، ولا في حالة تنفيذ لم تكتمل.
        </p>
        {/* Defence in depth: the loader refuses this batch, so this can never render. It stays so a
            future regression that lets a mismatch through still says "do not sign" instead of
            producing a clean-looking page. */}
        {stagedCounts && stagedCounts.batchRowCount !== report.rowCount && (
          <Alert
            tone="danger"
            title="عدد الصفوف لا يطابق ما سُجِّل عند التجهيز"
            description="لا توقّع هذا التقرير: عدد الصفوف المقروءة يختلف عمّا سجّلته الأداة عند تجهيز الدفعة."
          />
        )}
      </Section>

      <Section title="قرارات الصفوف على مستوى الدفعة كاملة">
        <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Figure label="إجمالي الصفوف" value={num(report.counts.total)} />
          <Figure label="بدون قرار" value={num(report.counts.unreviewed)} />
          <Figure label="تُضمَّن" value={num(report.counts.included)} />
          <Figure label="مُعلَّقة" value={num(report.counts.held)} />
          <Figure label="مرفوضة" value={num(report.counts.rejected)} />
          <Figure label="مُجمَّدة" value={num(report.counts.frozen)} />
          <Figure label="نُفِّذت ماليًا" value={num(report.counts.executed)} />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Figure
            label="جاهزية التجميد (كل صف له قرار)"
            value={report.readiness.allDecided ? "مكتملة" : `ناقصة — ${num(report.readiness.undecided)} صف بلا قرار`}
          />
          <Figure
            label="صفوف غير مُجمَّدة"
            value={num(report.readiness.notFrozen)}
          />
          <Figure label="صفوف لم تُنفَّذ ماليًا" value={num(report.readiness.notExecuted)} />
        </div>
      </Section>

      <Section title="إجماليات مبالغ المصدر حسب التصنيف">
        <TotalsTable
          caption="إجماليات مبالغ المصدر حسب التصنيف"
          totals={report.byClassification}
          footer={batchTotalRow}
        />
      </Section>

      <Section title="مآل الصفوف وإجمالياتها">
        <div className="grid gap-2 sm:grid-cols-3">
          <Figure label={report.copy.postingRowsLabel} value={num(report.plannedPostingRowCount)} />
          <Figure
            label={report.copy.postingTotalLabel}
            value={egpDecimalSummary(report.plannedPostingTotal)}
            className="sm:col-span-2"
          />
        </div>
        <TotalsTable
          caption="إجماليات مبالغ المصدر حسب مآل الصف"
          totals={report.byDestination}
          footer={batchTotalRow}
        />
        <p className="text-xs" style={mutedStyle}>
          {report.copy.postingNote} كل صف يقع في مجموعة واحدة فقط، ومجموع الصفوف أعلاه يساوي إجمالي
          صفوف الدفعة. المُعلَّق والمرفوض وبلا قرار لا يُسجَّل منها شيء، فلا تدخل مبالغها في هذا
          الإجمالي. ويساوي الإجمالي مبالغ المصدر لصفوف الإضافة المُضمَّنة لأن التنفيذ يسجّل مبلغ
          المصدر نفسه؛ أمّا صفوف تصحيح المبلغ فمُستبعدة من هذا الإجمالي ولها إجماليها المنفصل أدناه.
          تُجمع المبالغ من الأدلة التي سجّلت مبلغًا فقط، والصف بلا مبلغ مسجَّل لا يُحسب صفرًا بل يظهر
          في «+ غير معروف». هذه إجماليات أدلة، وليست قائمة مالية ولا رصيدًا مُرحّلًا.
        </p>
      </Section>

      {/* Amount corrections, ALWAYS printed — including at zero rows. A correction posts a replacement
          AND reverses the record it names, so its amount belongs in neither an ordinary posting total
          nor a "posts nothing" group. The caveat is unconditional because the fact that this report
          never computes the net ledger effect (new − old) is what a signer needs before signing. */}
      <Section title="صفوف تصحيح المبلغ — مبالغ الاستبدال">
        <div className="grid gap-2 sm:grid-cols-3">
          <Figure label={report.copy.correctionRowsLabel} value={num(report.correctionRowCount)} />
          <Figure
            label={report.copy.correctionTotalLabel}
            value={egpDecimalSummary(report.correctionReplacementTotal)}
            className="sm:col-span-2"
          />
        </div>
        <p className="text-xs" style={mutedStyle}>
          {report.copy.correctionNote} {ACCEPTANCE_CORRECTION_CAVEAT_AR}
        </p>
      </Section>

      {/* Dual-run PREPARATION, not a dual run: the same rows this read already returned, re-grouped
          so the accountant can pick a comparison unit. No row is decided, no period is assigned, and
          nothing here is stored. */}
      <Section title="إجماليات الرقابة للمصدر — حسب الفترة التقويمية">
        <p className="text-xs" style={mutedStyle}>
          {ACCEPTANCE_CONTROL_TOTALS_CAVEAT_AR}
        </p>
        <ControlTotalsTable
          caption="إجماليات مبالغ المصدر حسب الفترة التقويمية، مع مجاميع كل سنة والمجموعات بلا فترة"
          postingHeader={report.copy.postingTotalLabel}
          sections={[
            ...report.controlTotals.years.map((year) => ({
              key: year.key,
              totals: year.periods,
              subtotal: year.subtotal,
              ltrLabels: true,
            })),
            { key: "undated", totals: report.controlTotals.undated },
          ]}
          footer={report.controlTotals.total}
        />
      </Section>

      <Section title="إجماليات الرقابة للمصدر — حسب ورقة الدفتر">
        <ControlTotalsTable
          caption="إجماليات مبالغ المصدر حسب ورقة الدفتر المصدر"
          postingHeader={report.copy.postingTotalLabel}
          sections={[{ key: "sheets", totals: report.controlTotals.sheets }]}
          footer={report.controlTotals.total}
        />
        <p className="text-xs" style={mutedStyle}>
          كل صف من صفوف الدفعة يقع في مجموعة فترة واحدة وفي مجموعة ورقة واحدة، فيغلق الجدولان كلاهما
          على إجمالي مبالغ مصدر الدفعة نفسه المعروض في السطر الأخير. أسماء الأوراق كما سجّلها الدليل
          حرفيًا، وما لا يحمل اسم ورقة يظهر في مجموعة ثابتة ولا يسقط من الإجمالي. عمود «
          {report.copy.postingTotalLabel}» هو مبالغ صفوف الإضافة التي مآلها تسجيل حسب جدول «مآل
          الصفوف» أعلاه فقط، ولا تدخل فيه صفوف تصحيح المبلغ — لها إجماليها المنفصل في قسم «صفوف تصحيح
          المبلغ». والصف بلا مبلغ مسجَّل لا يُحسب صفرًا: يظهر في عمود «صفوف بلا مبلغ مسجَّل» وفي «+
          غير معروف».
        </p>
      </Section>

      <Section title="مؤشرات الجودة والاستثناءات">
        <div className="grid gap-2 sm:grid-cols-4">
          <Figure label="بدون قرار" value={num(report.quality.unresolved)} />
          <Figure label="مُعلَّقة" value={num(report.quality.held)} />
          <Figure label="مرفوضة" value={num(report.quality.rejected)} />
          <Figure label="تواريخ مصدر غير صالحة" value={num(report.quality.invalidDate)} />
          <Figure label="صفوف تصحيح مبلغ" value={num(report.quality.correctionCandidates)} />
          <Figure label="صفوف تصحيح بلا سجل مُصحَّح" value={num(report.quality.correctionUnlinked)} />
          <Figure label="صفوف مرتبطة بسجل مُصحَّح" value={num(report.quality.correctionLinked)} />
          <Figure label="صفوف بلا مبلغ مصدر مسجَّل" value={num(report.quality.missingSourceAmount)} />
          <Figure
            label="صفوف مُجمَّدة بلا بصمة حمولة"
            value={num(report.quality.frozenWithoutPayloadHash)}
          />
        </div>
        {report.quality.missingEvidence > 0 && (
          <Alert
            tone="danger"
            title="صفوف بلا دليل مقروء"
            description={`${num(report.quality.missingEvidence)} صف لم يُقرأ دليله. لا توقّع هذا التقرير.`}
          />
        )}
        {report.quality.frozenWithoutPayloadHash > 0 && (
          <Alert
            tone="danger"
            title="تجميد بلا بصمة حمولة"
            description={`${num(report.quality.frozenWithoutPayloadHash)} صف مُجمَّد بلا بصمة حمولة مسجَّلة، أي أن ما سيُنفَّذ غير مثبَّت. لا توقّع هذا التقرير.`}
          />
        )}
      </Section>

      <p className="text-xs" style={mutedStyle}>
        سجل الصفوف كاملًا — بمصدر كل صف وقراره وحمولته المحاسبية كاملة (البند والحساب ومركز التكلفة
        والمورّد/المشتري والكمية والسعر والتواريخ وبصمة الحمولة عند التجميد) — في ملف CSV المرفق،
        بالترتيب نفسه المعتمد في هذا التقرير وببصمة الحزمة نفسها في كل سطر. تاريخ إصدار هذه النسخة:{" "}
        {issuedOn}.
      </p>

      {/* The acceptance assertion itself. Every field is a BLANK: the schema stores no dual-run
          record, no control totals and no signature, so the printed page is the only record there is
          — and it must ASK for each of them by name rather than leave them to a notes box. */}
      <section className="print-only">
        <h2 className="text-sm font-bold">إقرار القبول (يُملأ بخط اليد ويُوقَّع على النسخة المطبوعة)</h2>
        <p className="mt-1 text-xs font-semibold">{ACCEPTANCE_ASSERTION_PROHIBITION_AR}</p>
        {/* The signature sheet carries the digest too: a signed page is meaningless without the
            fingerprint of the content it accepted. */}
        <div className="mt-1 text-[11px]">
          بصمة حزمة القبول ({ACCEPTANCE_DIGEST_ALGORITHM}):{" "}
          <span className="break-all font-mono" dir="ltr">
            {digest}
          </span>
        </div>
        <div className="mt-2 rounded-md p-2" style={boxStyle}>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {ACCEPTANCE_ASSERTION_FIELDS.map((field) => (
              <AssertionField key={field.key} field={field} />
            ))}
          </div>
        </div>
        <div className="mt-2 rounded-md p-2" style={boxStyle}>
          <div className="text-xs font-semibold">ملاحظات وتحفظات</div>
          {[0, 1, 2].map((line) => (
            <div key={line} className="mt-5" style={{ borderBottom: "1px solid var(--line)" }} />
          ))}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {ACCEPTANCE_SIGNATORIES_AR.map((role) => (
            <SignatureBlock key={role} role={role} />
          ))}
        </div>
      </section>
    </div>
  );
}
