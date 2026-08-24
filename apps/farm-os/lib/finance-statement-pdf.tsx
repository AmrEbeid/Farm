import fs from "node:fs";
import path from "node:path";
import type { Browser } from "puppeteer-core";
import { fmtDate } from "@/lib/dates";
import { egpExact } from "@/lib/decimal";
import type { BalanceSheet, BalanceSheetLine } from "@/lib/balance-sheet";
import type { IncomeStatement, IncomeStatementLine } from "@/lib/income-statement";

const fontPackagePath = path.join("@fontsource", "noto-naskh-arabic", "files");
const regularFontName = "noto-naskh-arabic-arabic-400-normal.woff";
const boldFontName = "noto-naskh-arabic-arabic-700-normal.woff";

function resolveFontFile(fileName: string): string {
  const candidates = [
    path.join(process.cwd(), "node_modules", fontPackagePath, fileName),
    path.join(process.cwd(), "..", "node_modules", fontPackagePath, fileName),
    path.join(process.cwd(), "..", "..", "node_modules", fontPackagePath, fileName),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Missing bundled Arabic PDF font: ${fileName}`);
  return found;
}

let fontFaces: string | null = null;

function bundledFontFaces(): string {
  if (fontFaces) return fontFaces;
  const regular = fs.readFileSync(resolveFontFile(regularFontName)).toString("base64");
  const bold = fs.readFileSync(resolveFontFile(boldFontName)).toString("base64");
  fontFaces = `
    @font-face {
      font-family: "FarmPdfArabic";
      src: url("data:font/woff;base64,${regular}") format("woff");
      font-style: normal;
      font-weight: 400;
    }
    @font-face {
      font-family: "FarmPdfArabic";
      src: url("data:font/woff;base64,${bold}") format("woff");
      font-style: normal;
      font-weight: 700;
    }
  `;
  return fontFaces;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function text(value: string | null | undefined, fallback = "-"): string {
  return escapeHtml(value?.trim() || fallback);
}

function money(value: string): string {
  const negative = value.startsWith("-");
  const formatted = escapeHtml(egpExact(negative ? value.slice(1) : value));
  return negative
    ? `<span class="money money-negative" dir="ltr"><span>(</span><span dir="rtl">${formatted}</span><span>)</span></span>`
    : `<span class="money" dir="ltr">${formatted}</span>`;
}

function fact(label: string, value: string): string {
  return `<div class="fact"><div class="fact-label">${escapeHtml(label)}</div><div class="fact-value">${value}</div></div>`;
}

function signatureBlocks(): string {
  return `
    <div class="signatures">
      <div class="signature"><strong>إعداد المحاسب</strong><div class="signature-line">الاسم والتوقيع</div></div>
      <div class="signature"><strong>مراجعة المالك</strong><div class="signature-line">الاسم والتوقيع</div></div>
    </div>
  `;
}

function balanceRows(lines: BalanceSheetLine[]): string {
  if (!lines.length) return `<tr><td colspan="3" class="empty">لا توجد أرصدة في هذا القسم.</td></tr>`;
  return lines
    .map(
      (line) => `
        <tr>
          <td class="code" dir="ltr">${text(line.code)}</td>
          <td>${text(line.nameAr)}</td>
          <td>${money(line.balance)}</td>
        </tr>
      `,
    )
    .join("");
}

function incomeRows(lines: IncomeStatementLine[]): string {
  if (!lines.length) return `<tr><td colspan="3" class="empty">لا توجد حركة في هذا القسم.</td></tr>`;
  return lines
    .map(
      (line) => `
        <tr>
          <td class="code" dir="ltr">${text(line.code)}</td>
          <td>${text(line.nameAr)}</td>
          <td>${money(line.amount)}</td>
        </tr>
      `,
    )
    .join("");
}

function statementTable(title: string, total: string, rows: string): string {
  return `
    <section class="statement-section">
      <h2>${escapeHtml(title)} <span class="section-total">${money(total)}</span></h2>
      <table>
        <thead><tr><th class="code">الكود</th><th>اسم الحساب</th><th class="amount">المبلغ</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function balanceSheetPage(bs: BalanceSheet, asOf: string, generatedOn: string): string {
  const statementAsOf = bs.asOf ?? asOf;
  const hasData = bs.assets.length > 0 || bs.liabilities.length > 0 || bs.equity.length > 0;
  return `
    <article class="statement-page">
      <header class="document-header">
        <div>
          <h1>قائمة المركز المالي</h1>
          <p>صورة فعلية من القيود المرحلة حتى ${escapeHtml(fmtDate(statementAsOf))}.</p>
        </div>
        <div class="source-badge">القيود المرحلة فقط</div>
      </header>
      <div class="facts facts-three">
        ${fact("تاريخ القائمة", escapeHtml(fmtDate(statementAsOf)))}
        ${fact("تاريخ النسخة", escapeHtml(fmtDate(generatedOn)))}
        ${fact("حالة القائمة", bs.balanced ? "متوازنة" : "غير متوازنة")}
      </div>
      <div class="facts facts-four">
        ${fact("مجموع الموارد", hasData ? money(bs.assetsTotal) : "-")}
        ${fact("مجموع الالتزامات", hasData ? money(bs.liabilitiesTotal) : "-")}
        ${fact("حقوق المالك مع الربح", hasData ? money(bs.totalEquityInclIncome) : "-")}
        ${fact("صافي الربح حتى التاريخ", hasData ? money(bs.netIncome) : "-")}
      </div>
      ${statementTable("الموارد", bs.assetsTotal, balanceRows(bs.assets))}
      ${statementTable("الالتزامات", bs.liabilitiesTotal, balanceRows(bs.liabilities))}
      ${statementTable("حقوق المالك", bs.equityTotal, balanceRows(bs.equity))}
      <div class="accounting-check">
        <strong>التحقق المحاسبي</strong>
        <span>الموارد ${money(bs.assetsTotal)} = الالتزامات + حقوق المالك + صافي الربح ${money(bs.liabilitiesPlusEquity)}.</span>
        <span>${bs.balanced ? "القائمة متوازنة." : "القائمة غير متوازنة."}</span>
      </div>
      ${signatureBlocks()}
    </article>
  `;
}

function incomeStatementPage(statement: IncomeStatement, start: string, end: string, generatedOn: string): string {
  const periodStart = statement.periodStart ?? start;
  const periodEnd = statement.periodEnd ?? end;
  const hasActivity = statement.revenue.length > 0 || statement.expenses.length > 0;
  return `
    <article class="statement-page">
      <header class="document-header">
        <div>
          <h1>قائمة الدخل</h1>
          <p>الدخل ناقص المصروفات من ${escapeHtml(fmtDate(periodStart))} إلى ${escapeHtml(fmtDate(periodEnd))}.</p>
        </div>
        <div class="source-badge">القيود المرحلة فقط</div>
      </header>
      <div class="facts facts-three">
        ${fact("بداية الفترة", escapeHtml(fmtDate(periodStart)))}
        ${fact("نهاية الفترة", escapeHtml(fmtDate(periodEnd)))}
        ${fact("تاريخ النسخة", escapeHtml(fmtDate(generatedOn)))}
      </div>
      <div class="facts facts-four">
        ${fact("مجموع الدخل", hasActivity ? money(statement.revenueTotal) : "-")}
        ${fact("مجموع المصروف", hasActivity ? money(statement.expensesTotal) : "-")}
        ${fact("التشغيلي منها", hasActivity ? money(statement.operatingExpenses) : "-")}
        ${fact("صافي الربح", hasActivity ? money(statement.netIncome) : "-")}
      </div>
      ${statementTable("الدخل", statement.revenueTotal, incomeRows(statement.revenue))}
      ${statementTable("المصروفات", statement.expensesTotal, incomeRows(statement.expenses))}
      <div class="accounting-check">
        <strong>نتيجة الفترة</strong>
        <span>الدخل ${money(statement.revenueTotal)} ناقص المصروفات ${money(statement.expensesTotal)} = صافي ${money(statement.netIncome)}.</span>
        <span>مسحوبات المالك ليست مصروفات في هذه القائمة.</span>
      </div>
      ${signatureBlocks()}
    </article>
  `;
}

function pdfHtml(title: string, pages: string): string {
  return `<!doctype html>
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          ${bundledFontFaces()}
          @page { size: A4; margin: 15mm 14mm 16mm; }
          * { box-sizing: border-box; }
          html { direction: rtl; }
          body {
            margin: 0;
            color: #172033;
            background: #fff;
            direction: rtl;
            font-family: "FarmPdfArabic", sans-serif;
            font-size: 11pt;
            line-height: 1.45;
            letter-spacing: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .statement-page + .statement-page { break-before: page; }
          .document-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 18px;
            padding-bottom: 10px;
            border-bottom: 2px solid #166534;
          }
          h1 { margin: 0; font-size: 22pt; line-height: 1.2; }
          .document-header p { margin: 5px 0 0; color: #4b5563; }
          .source-badge {
            flex: none;
            border: 1px solid #bbf7d0;
            background: #f0fdf4;
            color: #166534;
            border-radius: 5px;
            padding: 5px 8px;
            font-size: 9pt;
            font-weight: 700;
          }
          .facts { display: grid; gap: 8px; margin-top: 12px; }
          .facts-three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .facts-four { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .fact { border: 1px solid #d1d5db; border-radius: 5px; padding: 7px 8px; min-height: 52px; }
          .fact-label { color: #6b7280; font-size: 8.5pt; }
          .fact-value { margin-top: 2px; font-weight: 700; overflow-wrap: anywhere; }
          .statement-section { margin-top: 13px; }
          h2 {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin: 0;
            border: 1px solid #d1d5db;
            border-radius: 5px 5px 0 0;
            background: #f3f4f6;
            padding: 6px 8px;
            font-size: 12pt;
          }
          .section-total { font-weight: 700; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
          th, td { border-bottom: 1px solid #e5e7eb; padding: 5px 7px; text-align: right; vertical-align: top; }
          th { color: #4b5563; font-size: 9pt; font-weight: 700; }
          th.code, td.code { width: 16%; text-align: right; unicode-bidi: isolate; }
          th.amount, th:last-child, td:last-child { width: 34%; }
          .money {
            display: inline-block;
            direction: ltr;
            unicode-bidi: isolate;
            text-align: left;
            white-space: nowrap;
            font-size: 9pt;
            font-variant-numeric: tabular-nums;
          }
          .money-negative { display: inline-flex; gap: 2px; }
          td:last-child { text-align: left; }
          .empty { color: #6b7280; text-align: center; padding: 9px; }
          .accounting-check {
            display: flex;
            flex-wrap: wrap;
            gap: 5px 10px;
            margin-top: 14px;
            border: 1px solid #bbf7d0;
            border-radius: 5px;
            background: #f0fdf4;
            padding: 8px;
            color: #14532d;
          }
          .signatures { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 22px; break-inside: avoid; }
          .signature { min-height: 72px; border: 1px solid #d1d5db; border-radius: 5px; padding: 9px; }
          .signature-line { margin-top: 27px; border-top: 1px solid #9ca3af; padding-top: 4px; color: #6b7280; font-size: 8.5pt; }
        </style>
      </head>
      <body>${pages}</body>
    </html>`;
}

function localChromiumPath(): string | null {
  const candidates = [
    process.env.FARM_PDF_CHROMIUM_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function launchPdfBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  const localPath = localChromiumPath();
  if (localPath) return puppeteer.launch({ executablePath: localPath, headless: true });

  const chromium = (await import("@sparticuz/chromium")).default;
  chromium.setGraphicsMode = false;
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

async function renderHtmlPdf(html: string): Promise<Buffer> {
  const browser = await launchPdfBrowser();
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setOfflineMode(true);
    await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(
      await page.pdf({
        format: "A4",
        preferCSSPageSize: true,
        printBackground: true,
        tagged: true,
      }),
    );
  } finally {
    await browser.close();
  }
}

export function balanceSheetPdfFilename(asOf: string): string {
  return `balance-sheet-${asOf}.pdf`;
}

export function statementPackagePdfFilename(start: string, end: string, asOf: string): string {
  return `finance-statements-${start}-to-${end}-as-of-${asOf}.pdf`;
}

export async function renderBalanceSheetPdf(input: { bs: BalanceSheet; asOf: string; generatedOn: string }): Promise<Buffer> {
  return renderHtmlPdf(
    pdfHtml(
      `قائمة المركز المالي ${input.bs.asOf ?? input.asOf}`,
      balanceSheetPage(input.bs, input.asOf, input.generatedOn),
    ),
  );
}

export async function renderStatementPackagePdf(input: {
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  start: string;
  end: string;
  asOf: string;
  generatedOn: string;
}): Promise<Buffer> {
  return renderHtmlPdf(
    pdfHtml(
      `القوائم المالية ${input.start} ${input.end}`,
      incomeStatementPage(input.incomeStatement, input.start, input.end, input.generatedOn) +
        balanceSheetPage(input.balanceSheet, input.asOf, input.generatedOn),
    ),
  );
}
