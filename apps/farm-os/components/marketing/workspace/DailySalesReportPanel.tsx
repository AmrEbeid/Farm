"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Textarea, useToast } from "@/components/ui";
import type { MarketingRecordRow } from "@/components/marketing/MarketingRecordTable";
import { archiveMarketingRecord, saveMarketingRecord, type MarketingRecordInput } from "@/app/(app)/marketing/actions";
import { num } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import {
  buildDailySalesReportPayload,
  computeDailySalesReport,
  DAILY_SALES_REPORT_CHANNEL_OPTIONS,
  DAILY_SALES_REPORT_DEFAULT_SELLER,
  dailySalesReportTitle,
  DSR_MAX_EXPENSE_ITEMS,
  DSR_MAX_LINES,
  DSR_MAX_NOTES_LENGTH,
  DSR_MAX_TEXT_LENGTH,
  isValidExpenseItem,
  isValidSalesLine,
  readDailySalesReportPayload,
  type DailyExpenseItemInput,
  type DailySalesLineInput,
  type DailySalesReportResult,
  type DailySalesSectorBreakdown,
  type DailySalesSectorLedgerRow,
} from "@/lib/marketing/workspace/daily-sales-report";

const CHANNEL_DATALIST_ID = "dsr-channel-options";

function parseNum(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function witnessList(witnesses: string): string[] {
  return witnesses
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Source `buildDailyReportMsg()` — Arabic-formatted via `num()`, never auto-sent (copy only). */
function buildWhatsappMessage(input: {
  date: string;
  seller: string;
  notes: string;
  expenseItems: readonly DailyExpenseItemInput[];
  result: DailySalesReportResult;
}): string {
  const { date, seller, notes, expenseItems, result } = input;
  const expLines = expenseItems.length
    ? expenseItems.map((it) => `- ${it.name}: ${num(it.amount)} جنيه`).join("\n")
    : "- لا يوجد";
  const sectorLines = result.sectors
    .map(
      (s) =>
        `- ${s.name}${s.channel ? ` (${s.channel})` : ""}: ${num(s.qtyKg)} كجم × ${num(s.pricePerKg, 2)}ج/كجم = ${num(s.revenueShare)}ج — مصروفاته ${num(s.expenseShare)}ج، صافيه ${num(s.netShare)}ج`,
    )
    .join("\n");
  return `تقرير مبيعات يوم ${date || "-"} — مزرعة عُبيد

الكمية الإجمالية: ${num(result.qtyKg)} كجم من ${num(result.sectors.length)} خط بيع
إجمالي قيمة البيع (قبل الخصم): ${num(result.totalRevenue)} جنيه
متوسط سعر الكيلو الإجمالي: ${num(result.avgPriceGross, 2)} ج/كجم

تفصيل خطوط البيع:
${sectorLines}

بنود المصروفات:
${expLines}
إجمالي المصروفات: ${num(result.totalExpenses)} جنيه
متوسط التكلفة للكيلو: ${num(result.avgCostPerKg, 2)} ج/كجم

متوسط سعر الكيلو الصافي (بعد خصم المصاريف): ${num(result.avgPriceNet, 2)} ج/كجم
الإجمالي بعد خصم المصاريف (الصافي): ${num(result.netAfterExpenses)} جنيه${result.netAfterExpenses < 0 ? " (خسارة)" : ""}
${notes ? `ملاحظات: ${notes}` : ""}

${seller || DAILY_SALES_REPORT_DEFAULT_SELLER}`;
}

function SectorBreakdownTable({ sectors }: { sectors: readonly DailySalesSectorBreakdown[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b text-start" style={{ borderColor: "var(--line)" }}>
            <th className="p-2 text-start">القطاع</th>
            <th className="p-2 text-start">القناة</th>
            <th className="p-2 text-start">الكمية</th>
            <th className="p-2 text-start">سعر الكيلو</th>
            <th className="p-2 text-start">القيمة</th>
            <th className="p-2 text-start">حصته من المصروفات</th>
            <th className="p-2 text-start">صافي الخط</th>
          </tr>
        </thead>
        <tbody>
          {sectors.map((s, i) => (
            <tr key={`${s.name}-${s.channel}-${i}`} className="border-b" style={{ borderColor: "var(--line)" }}>
              <td className="p-2 font-bold">{s.name}</td>
              <td className="p-2">{s.channel}</td>
              <td className="p-2">{num(s.qtyKg)} كجم</td>
              <td className="p-2">{num(s.pricePerKg, 2)} ج/كجم</td>
              <td className="p-2">{num(s.revenueShare)} ج</td>
              <td className="p-2">{num(s.expenseShare)} ج</td>
              <td className="p-2 font-bold" style={{ color: s.netShare >= 0 ? "var(--ok, #17613d)" : "var(--danger, #a44732)" }}>
                {num(s.netShare)} ج
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * SPEC-0032 — the "تقرير المبيعات اليومي" (daily sales report) workflow, transcribed from the
 * source HTML (لines 1660-1715, 2579-2835): multiple sale lines (sector × channel × qty × price),
 * multiple expense lines, live totals/averages/allocation, save to `daily_sales_report`, a
 * copy-only WhatsApp summary (never auto-sent), and a print receipt via `window.print()` only.
 */
export function DailySalesReportPanel({
  orgId,
  canWrite,
  rows,
  sectorLedger,
}: {
  orgId: string;
  canWrite: boolean;
  rows: MarketingRecordRow[];
  sectorLedger: DailySalesSectorLedgerRow[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [editId, setEditId] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [seller, setSeller] = useState(DAILY_SALES_REPORT_DEFAULT_SELLER);
  const [buyer, setBuyer] = useState("");
  const [witnesses, setWitnesses] = useState("");
  const [notes, setNotes] = useState("");

  const [lines, setLines] = useState<DailySalesLineInput[]>([]);
  const [lineSector, setLineSector] = useState("");
  const [lineChannel, setLineChannel] = useState("");
  const [lineQty, setLineQty] = useState("");
  const [linePrice, setLinePrice] = useState("");
  const [lineError, setLineError] = useState<string | null>(null);

  const [expenseItems, setExpenseItems] = useState<DailyExpenseItemInput[]>([]);
  const [expenseName, setExpenseName] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseError, setExpenseError] = useState<string | null>(null);

  const [pending, setPending] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [whatsappText, setWhatsappText] = useState<string | null>(null);

  const result = useMemo(() => computeDailySalesReport(lines, expenseItems), [lines, expenseItems]);
  const hasLines = lines.length > 0;

  function resetForm() {
    setEditId(null);
    setDate(new Date().toISOString().slice(0, 10));
    setSeller(DAILY_SALES_REPORT_DEFAULT_SELLER);
    setBuyer("");
    setWitnesses("");
    setNotes("");
    setLines([]);
    setExpenseItems([]);
    setWhatsappText(null);
    setSaveMsg(null);
  }

  function addLine() {
    setLineError(null);
    const candidate: DailySalesLineInput = {
      sector: lineSector.trim(),
      channel: lineChannel.trim(),
      qtyKg: parseNum(lineQty),
      pricePerKg: parseNum(linePrice),
    };
    if (lines.length >= DSR_MAX_LINES) {
      setLineError(`لا يمكن إضافة أكثر من ${num(DSR_MAX_LINES)} خط بيع في التقرير الواحد.`);
      return;
    }
    if (!isValidSalesLine(candidate)) {
      setLineError("أدخل القطاع والكمية وسعر الكيلو على الأقل (أرقام أكبر من صفر).");
      return;
    }
    setLines((v) => [...v, candidate]);
    setLineSector("");
    setLineChannel("");
    setLineQty("");
    setLinePrice("");
  }

  function removeLine(index: number) {
    setLines((v) => v.filter((_, i) => i !== index));
  }

  function addExpenseItem() {
    setExpenseError(null);
    const candidate: DailyExpenseItemInput = { name: expenseName.trim(), amount: parseNum(expenseAmount) };
    if (expenseItems.length >= DSR_MAX_EXPENSE_ITEMS) {
      setExpenseError(`لا يمكن إضافة أكثر من ${num(DSR_MAX_EXPENSE_ITEMS)} بند مصروفات في التقرير الواحد.`);
      return;
    }
    if (!isValidExpenseItem(candidate)) {
      setExpenseError("أدخل اسم البند والمبلغ (رقم أكبر من صفر).");
      return;
    }
    setExpenseItems((v) => [...v, candidate]);
    setExpenseName("");
    setExpenseAmount("");
  }

  function removeExpenseItem(index: number) {
    setExpenseItems((v) => v.filter((_, i) => i !== index));
  }

  async function save() {
    setSaveMsg(null);
    if (!date) {
      setSaveMsg({ tone: "danger", text: "أدخل تاريخ التقرير." });
      return;
    }
    if (!hasLines) {
      setSaveMsg({ tone: "danger", text: "أضف خط بيع واحد على الأقل (قطاع، كمية، سعر) قبل الحفظ." });
      return;
    }
    const payload = buildDailySalesReportPayload({ date, seller, buyer, witnesses, notes, lines, expenseItems, result });
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 32_000) {
      setSaveMsg({ tone: "danger", text: "حجم التقرير أكبر من حد الحفظ. اختصر النصوص أو قسّم التقرير." });
      return;
    }
    setPending(true);
    const input: MarketingRecordInput = {
      id: editId,
      orgId,
      recordType: "daily_sales_report",
      title: dailySalesReportTitle(date),
      payload,
      amount: result.netAfterExpenses,
      status: result.netAfterExpenses >= 0 ? "profit" : "loss",
    };
    let r: { ok: boolean; error?: string };
    try {
      r = await saveMarketingRecord(input);
    } catch {
      r = { ok: false, error: "تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى." };
    }
    setPending(false);
    if (r.ok) {
      toast.ok(editId ? "تم تحديث تقرير اليوم" : "تم حفظ تقرير اليوم في السجل");
      resetForm();
      router.refresh();
    } else {
      setSaveMsg({ tone: "danger", text: r.error ?? "تعذّر الحفظ" });
    }
  }

  function generateWhatsappText() {
    if (!hasLines) {
      setSaveMsg({ tone: "danger", text: "أضف خط بيع واحد على الأقل (قطاع، كمية، سعر) أولاً." });
      return;
    }
    setSaveMsg(null);
    setWhatsappText(buildWhatsappMessage({ date, seller, notes, expenseItems, result }));
  }

  async function copyWhatsappText() {
    if (!whatsappText) return;
    await navigator.clipboard.writeText(whatsappText);
    toast.ok("تم نسخ رسالة الواتساب");
  }

  function printReport() {
    if (!hasLines) {
      setSaveMsg({ tone: "danger", text: "أضف خط بيع واحد على الأقل (قطاع، كمية، سعر) أولاً." });
      return;
    }
    window.print();
  }

  const savedReports = useMemo(
    () =>
      rows
        .filter((r) => r.recordType === "daily_sales_report" && !r.archived)
        .map((row) => ({ row, record: readDailySalesReportPayload(row.payload) }))
        .sort((a, b) => (a.record.date < b.record.date ? 1 : a.record.date > b.record.date ? -1 : 0)),
    [rows],
  );
  function startEdit(row: MarketingRecordRow) {
    const record = readDailySalesReportPayload(row.payload);
    setEditId(row.id);
    setDate(record.date || new Date().toISOString().slice(0, 10));
    setSeller(record.seller || DAILY_SALES_REPORT_DEFAULT_SELLER);
    setBuyer(record.buyer);
    setWitnesses(record.witnesses);
    setNotes(record.notes);
    setLines(record.lines);
    setExpenseItems(record.expenseItems);
    setWhatsappText(null);
    setSaveMsg(null);
    document.getElementById("daily-sales-report-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function archive(id: string) {
    setPending(true);
    let response: { ok: boolean; error?: string };
    try {
      response = await archiveMarketingRecord(id, true);
    } catch {
      response = { ok: false, error: "تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى." };
    }
    setPending(false);
    if (!response.ok) {
      setSaveMsg({ tone: "danger", text: response.error ?? "تعذّر أرشفة التقرير" });
      return;
    }
    if (editId === id) resetForm();
    toast.ok("تمت أرشفة التقرير");
    router.refresh();
  }

  const witnessNames = witnessList(witnesses);

  return (
    <section id="daily-sales-report-editor" className="flex flex-col gap-4 rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
      <div>
        <h2 className="text-lg font-bold">تقرير المبيعات اليومي</h2>
        <p style={{ color: "var(--ink-muted)" }}>
          سجّل كل عملية بيع اليوم كخط منفصل بقطاعه وقناته وكميته وسعره — يمكن بيع نفس اليوم من أكثر من
          قطاع وبأكثر من سعر معًا. المصروفات بنود منفصلة تُضاف بأي عدد، وتتوزع على كل خط بيع على قدر
          كميته. الإجمالي والمتوسطات تُحسب تلقائيًا.
        </p>
      </div>
      <div className="print-only">
        <h2>إيصال مبيعات — {fmtDate(date)}</h2>
      </div>

      <div role="alert" aria-live="assertive" aria-atomic="true">
        {saveMsg && <Alert tone={saveMsg.tone} title={saveMsg.text} />}
      </div>

      <div className="no-print grid gap-3 sm:grid-cols-2">
        <Field id="dsr-date" label="التاريخ" required>
          <Input id="dsr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>
      {!canWrite && date === "" && (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          {fmtDate(null)}
        </p>
      )}

      {/* Sale lines */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold">
          خطوط البيع اليوم (كل خط = قطاع + نوع بيع/قناة + كمية + سعر الكيلو الخاص به)
        </label>
        {canWrite && (
          <div className="no-print flex flex-wrap items-end gap-2">
            <Field id="dsr-line-sector" label="اسم القطاع">
              <Input
                id="dsr-line-sector"
                value={lineSector}
                onChange={(e) => setLineSector(e.target.value)}
                maxLength={DSR_MAX_TEXT_LENGTH}
                placeholder="مثال: حوض البابور"
              />
            </Field>
            <Field id="dsr-line-channel" label="نوع البيع / القناة">
              <Input
                id="dsr-line-channel"
                list={CHANNEL_DATALIST_ID}
                value={lineChannel}
                onChange={(e) => setLineChannel(e.target.value)}
                maxLength={DSR_MAX_TEXT_LENGTH}
                placeholder="تصدير / محلي..."
              />
            </Field>
            <datalist id={CHANNEL_DATALIST_ID}>
              {DAILY_SALES_REPORT_CHANNEL_OPTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <Field id="dsr-line-qty" label="الكمية بالكيلو">
              <Input id="dsr-line-qty" type="number" step="0.1" min="0" value={lineQty} onChange={(e) => setLineQty(e.target.value)} />
            </Field>
            <Field id="dsr-line-price" label="سعر الكيلو (جنيه)">
              <Input id="dsr-line-price" type="number" step="0.01" min="0" value={linePrice} onChange={(e) => setLinePrice(e.target.value)} />
            </Field>
            <Button type="button" variant="ghost" onClick={addLine} disabled={lines.length >= DSR_MAX_LINES}>
              + إضافة خط بيع
            </Button>
          </div>
        )}
        {lineError && (
          <div role="alert" aria-live="assertive">
            <Alert tone="danger" title={lineError} />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                <th className="p-2 text-start">القطاع</th>
                <th className="p-2 text-start">القناة</th>
                <th className="p-2 text-start">الكمية</th>
                <th className="p-2 text-start">سعر الكيلو</th>
                <th className="p-2 text-start">القيمة</th>
                {canWrite && <th className="no-print p-2" />}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={canWrite ? 6 : 5} className="p-3 text-center" style={{ color: "var(--ink-muted)" }}>
                    لا يوجد خطوط بيع مضافة بعد.
                  </td>
                </tr>
              ) : (
                lines.map((line, i) => (
                  <tr key={i} className="border-b" style={{ borderColor: "var(--line)" }}>
                    <td className="p-2">{line.sector}</td>
                    <td className="p-2">{line.channel || "بيع"}</td>
                    <td className="p-2">{num(line.qtyKg)} كجم</td>
                    <td className="p-2">{num(line.pricePerKg, 2)} ج/كجم</td>
                    <td className="p-2">{num(line.qtyKg * line.pricePerKg)} ج</td>
                    {canWrite && (
                      <td className="no-print p-2">
                        <Button type="button" variant="ghost" onClick={() => removeLine(i)}>
                          حذف
                        </Button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          إجمالي الكمية: {num(result.qtyKg)} كجم من {num(lines.length)} خط بيع — إجمالي قيمة البيع: {num(result.totalRevenue)} جنيه
        </p>
      </div>

      {/* Expense items */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold">
          بنود المصروفات (إيجار، دفعة، نقل... أضف أي عدد، تتوزع على القطاعات على قدر كمية كل واحد)
        </label>
        {canWrite && (
          <div className="no-print flex flex-wrap items-end gap-2">
            <Field id="dsr-exp-name" label="اسم البند">
              <Input
                id="dsr-exp-name"
                value={expenseName}
                onChange={(e) => setExpenseName(e.target.value)}
                maxLength={DSR_MAX_TEXT_LENGTH}
                placeholder="مثال: إيجار"
              />
            </Field>
            <Field id="dsr-exp-amount" label="المبلغ بالجنيه">
              <Input id="dsr-exp-amount" type="number" step="0.01" min="0" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} />
            </Field>
            <Button type="button" variant="ghost" onClick={addExpenseItem} disabled={expenseItems.length >= DSR_MAX_EXPENSE_ITEMS}>
              + إضافة بند
            </Button>
          </div>
        )}
        {expenseError && (
          <div role="alert" aria-live="assertive">
            <Alert tone="danger" title={expenseError} />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                <th className="p-2 text-start">البند</th>
                <th className="p-2 text-start">المبلغ</th>
                {canWrite && <th className="no-print p-2" />}
              </tr>
            </thead>
            <tbody>
              {expenseItems.length === 0 ? (
                <tr>
                  <td colSpan={canWrite ? 3 : 2} className="p-3 text-center" style={{ color: "var(--ink-muted)" }}>
                    لا يوجد بنود مصروفات مضافة بعد.
                  </td>
                </tr>
              ) : (
                expenseItems.map((item, i) => (
                  <tr key={i} className="border-b" style={{ borderColor: "var(--line)" }}>
                    <td className="p-2">{item.name}</td>
                    <td className="p-2">{num(item.amount)} ج</td>
                    {canWrite && (
                      <td className="no-print p-2">
                        <Button type="button" variant="ghost" onClick={() => removeExpenseItem(i)}>
                          حذف
                        </Button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          إجمالي المصروفات حتى الآن: {num(result.totalExpenses)} جنيه ({num(expenseItems.length)} بند)
        </p>
      </div>

      {/* Parties */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="dsr-seller" label="اسم المُسلِّم (من المزرعة)">
          <Input id="dsr-seller" value={seller} onChange={(e) => setSeller(e.target.value)} maxLength={DSR_MAX_TEXT_LENGTH} />
        </Field>
        <Field id="dsr-buyer" label="اسم المستلم / المشتري">
          <Input id="dsr-buyer" value={buyer} onChange={(e) => setBuyer(e.target.value)} maxLength={DSR_MAX_TEXT_LENGTH} placeholder="اسم المشتري أو من استلم البضاعة" />
        </Field>
        <div className="sm:col-span-2">
          <Field id="dsr-witnesses" label="أسماء إضافية للتوقيع (حضور/شهود) — افصل بينهم بفاصلة">
            <Input id="dsr-witnesses" value={witnesses} onChange={(e) => setWitnesses(e.target.value)} maxLength={DSR_MAX_NOTES_LENGTH} placeholder="مثال: أحمد ماهر, عبدالرحيم" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field id="dsr-notes" label="ملاحظات">
            <Textarea id="dsr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={DSR_MAX_NOTES_LENGTH} />
          </Field>
        </div>
      </div>

      {/* Live result */}
      <div className="rounded-md border p-3" style={{ borderColor: "var(--line)" }}>
        <p>
          إجمالي قيمة البيع قبل الخصم: <b>{num(result.totalRevenue)} ج</b> لـ<b>{num(result.qtyKg)} كجم</b> من {num(lines.length)} خط بيع
          (متوسط سعر الكيلو الإجمالي: {num(result.avgPriceGross, 2)} ج/كجم)
        </p>
        <p>
          إجمالي المصروفات ({num(expenseItems.length)} بند): <b>{num(result.totalExpenses)} ج</b> (متوسط التكلفة للكيلو: {num(result.avgCostPerKg, 2)} ج/كجم)
        </p>
        <p>متوسط سعر الكيلو الصافي (بعد خصم المصاريف): <b>{num(result.avgPriceNet, 2)} ج/كجم</b></p>
        <p className="text-lg">
          الإجمالي بعد خصم المصاريف (الصافي):{" "}
          <b style={{ color: result.netAfterExpenses >= 0 ? "var(--ok, #17613d)" : "var(--danger, #a44732)" }}>{num(result.netAfterExpenses)} ج</b>
          {result.netAfterExpenses < 0 && hasLines ? " — ⚠️ خسارة اليوم" : ""}
        </p>
      </div>

      {hasLines && (
        <div className="flex flex-col gap-2">
          <h3 className="font-bold">تفصيل خطوط البيع حسب القطاع</h3>
          <SectorBreakdownTable sectors={result.sectors} />
        </div>
      )}

      <div className="flex flex-col gap-1 text-sm">
        <p><b>تم الاستلام والتسليم بالمطابقة</b></p>
        <p>{seller || "المُسلِّم"}: ______________________</p>
        <p>{buyer || "المستلم"}: ______________________</p>
        {witnessNames.map((name) => (
          <p key={name}>{name}: ______________________</p>
        ))}
      </div>

      {canWrite && (
        <div className="no-print flex flex-wrap gap-2">
          <Button type="button" onClick={() => void save()} loading={pending} disabled={!hasLines || !date}>
            {editId ? "حفظ التعديلات" : "حفظ في السجل"}
          </Button>
          <Button type="button" variant="ghost" onClick={generateWhatsappText} disabled={!hasLines}>
            توليد رسالة واتساب
          </Button>
          <Button type="button" variant="ghost" onClick={printReport} disabled={!hasLines}>
            طباعة كإيصال بتوقيعات
          </Button>
          {editId && (
            <Button type="button" variant="ghost" onClick={resetForm}>
              إلغاء التعديل
            </Button>
          )}
        </div>
      )}

      {whatsappText && (
        <div className="no-print flex flex-col gap-2">
          <Field id="dsr-whatsapp-text" label="نص رسالة الواتساب (للنسخ اليدوي فقط — لا يُرسل تلقائيًا)">
            <Textarea id="dsr-whatsapp-text" value={whatsappText} readOnly rows={10} />
          </Field>
          <div>
            <Button type="button" variant="ghost" onClick={() => void copyWhatsappText()}>
              نسخ رسالة الواتساب
            </Button>
          </div>
        </div>
      )}

      {/* Saved reports */}
      <div className="no-print flex flex-col gap-3">
        <h3 className="font-bold">التقارير اليومية المحفوظة</h3>
        {savedReports.length === 0 ? (
          <p style={{ color: "var(--ink-muted)" }}>لا توجد تقارير محفوظة بعد.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {savedReports.map(({ row, record }) => (
              <li key={row.id} className="flex flex-col gap-2 rounded-md border p-3" style={{ borderColor: "var(--line)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">{fmtDate(record.date)}</span>
                  <span
                    className="font-bold"
                    style={{ color: record.netAfterExpenses >= 0 ? "var(--ok, #17613d)" : "var(--danger, #a44732)" }}
                  >
                    الصافي: {num(record.netAfterExpenses)} ج
                  </span>
                </div>
                <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
                  {num(record.qtyKg)} كجم — إجمالي البيع {num(record.totalRevenue)} ج — مصروفات {num(record.totalExpenses)} ج — متوسط
                  الصافي {num(record.avgPriceNet, 2)} ج/كجم
                  {record.seller ? ` — المُسلِّم: ${record.seller}` : ""}
                  {record.buyer ? ` — المستلم: ${record.buyer}` : ""}
                </p>
                {record.sectors.length > 0 && <SectorBreakdownTable sectors={record.sectors} />}
                {record.notes && <p className="text-sm">ملاحظات: {record.notes}</p>}
                {canWrite && (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="ghost" onClick={() => startEdit(row)} disabled={pending}>
                      تعديل
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => void archive(row.id)} disabled={pending}>
                      أرشفة
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="no-print flex flex-col gap-3">
        <h3 className="font-bold">حسابات القطاعات من كل التقارير المحفوظة</h3>
        {sectorLedger.length === 0 ? (
          <p style={{ color: "var(--ink-muted)" }}>لا توجد بيانات بعد — احفظ أول تقرير يومي.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                  <th className="p-2 text-start">القطاع</th>
                  <th className="p-2 text-start">أيام البيع</th>
                  <th className="p-2 text-start">الكمية</th>
                  <th className="p-2 text-start">المبيعات</th>
                  <th className="p-2 text-start">المصروفات</th>
                  <th className="p-2 text-start">الصافي</th>
                  <th className="p-2 text-start">متوسط السعر</th>
                </tr>
              </thead>
              <tbody>
                {sectorLedger.map((row) => (
                  <tr key={row.name} className="border-b" style={{ borderColor: "var(--line)" }}>
                    <td className="p-2 font-bold">{row.name}</td>
                    <td className="p-2">{num(row.days)} يوم</td>
                    <td className="p-2">{num(row.qtyKg)} كجم</td>
                    <td className="p-2">{num(row.revenue)} ج</td>
                    <td className="p-2">{num(row.expenses)} ج</td>
                    <td className="p-2 font-bold" style={{ color: row.net >= 0 ? "var(--ok, #17613d)" : "var(--danger, #a44732)" }}>
                      {num(row.net)} ج
                    </td>
                    <td className="p-2">{num(row.avgPrice, 2)} ج/كجم</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
