import fs from "node:fs";
import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { fmtDate } from "@/lib/dates";
import { egp } from "@/lib/money";
import type { BalanceSheet, BalanceSheetLine } from "@/lib/balance-sheet";

const fontPackagePath = path.join("@fontsource", "noto-naskh-arabic", "files");

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

const regularFont = resolveFontFile("noto-naskh-arabic-arabic-400-normal.woff");
const boldFont = resolveFontFile("noto-naskh-arabic-arabic-700-normal.woff");

let fontsRegistered = false;

function ensureFonts() {
  if (fontsRegistered) return;
  Font.register({
    family: "NotoNaskhArabic",
    fonts: [
      { src: regularFont, fontWeight: 400 },
      { src: boldFont, fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

const styles = StyleSheet.create({
  page: {
    padding: 28,
    fontFamily: "NotoNaskhArabic",
    fontSize: 10,
    color: "#111827",
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 6,
    textAlign: "right",
  },
  subtitle: {
    fontSize: 10,
    color: "#4b5563",
    marginBottom: 14,
    textAlign: "right",
  },
  grid: {
    display: "flex",
    flexDirection: "row-reverse",
    gap: 8,
    marginBottom: 14,
  },
  tile: {
    flexGrow: 1,
    width: "24%",
    border: "1 solid #d1d5db",
    borderRadius: 6,
    padding: 8,
  },
  label: {
    color: "#6b7280",
    fontSize: 8,
    marginBottom: 3,
    textAlign: "right",
  },
  value: {
    fontWeight: 700,
    textAlign: "right",
  },
  section: {
    marginTop: 10,
  },
  sectionHeader: {
    backgroundColor: "#f3f4f6",
    border: "1 solid #d1d5db",
    borderRadius: 6,
    padding: 7,
    fontWeight: 700,
    textAlign: "right",
  },
  row: {
    display: "flex",
    flexDirection: "row-reverse",
    borderBottom: "1 solid #e5e7eb",
    paddingVertical: 5,
    gap: 8,
  },
  code: {
    width: 62,
    textAlign: "right",
    color: "#374151",
  },
  name: {
    flexGrow: 1,
    textAlign: "right",
  },
  money: {
    width: 110,
    textAlign: "left",
  },
  note: {
    marginTop: 12,
    padding: 8,
    border: "1 solid #d1d5db",
    borderRadius: 6,
    color: "#374151",
    textAlign: "right",
  },
  signatures: {
    display: "flex",
    flexDirection: "row-reverse",
    gap: 12,
    marginTop: 24,
  },
  signatureBox: {
    flexGrow: 1,
    border: "1 solid #d1d5db",
    borderRadius: 6,
    padding: 10,
    minHeight: 72,
  },
  signatureLine: {
    marginTop: 28,
    borderTop: "1 solid #9ca3af",
    paddingTop: 5,
    color: "#6b7280",
    fontSize: 8,
    textAlign: "right",
  },
});

export function balanceSheetPdfFilename(asOf: string): string {
  return `balance-sheet-${asOf}.pdf`;
}

function hasBalanceSheetData(bs: BalanceSheet): boolean {
  return bs.assets.length > 0 || bs.liabilities.length > 0 || bs.equity.length > 0;
}

function Section({ title, total, lines }: { title: string; total: number; lines: BalanceSheetLine[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeader}>
        {title} — {egp(total)}
      </Text>
      {lines.length ? (
        lines.map((line, index) => (
          <View key={`${line.code}-${index}`} style={styles.row}>
            <Text style={styles.code}>{line.code || "—"}</Text>
            <Text style={styles.name}>{line.nameAr || "—"}</Text>
            <Text style={styles.money}>{egp(line.balance)}</Text>
          </View>
        ))
      ) : (
        <View style={styles.row}>
          <Text style={styles.name}>لا توجد أرصدة في هذا القسم.</Text>
        </View>
      )}
    </View>
  );
}

function BalanceSheetPdfDocument({ bs, asOf, generatedOn }: { bs: BalanceSheet; asOf: string; generatedOn: string }) {
  const statementAsOf = bs.asOf ?? asOf;
  const hasData = hasBalanceSheetData(bs);
  return (
    <Document title={`قائمة المركز المالي ${statementAsOf}`} author="Farm OS">
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>قائمة المركز المالي</Text>
        <Text style={styles.subtitle}>صورة فعلية من القيود المرحلة حتى {fmtDate(statementAsOf)}.</Text>

        <View style={styles.grid}>
          <View style={styles.tile}>
            <Text style={styles.label}>تاريخ القائمة</Text>
            <Text style={styles.value}>{fmtDate(statementAsOf)}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.label}>تاريخ النسخة</Text>
            <Text style={styles.value}>{fmtDate(generatedOn)}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.label}>المصدر</Text>
            <Text style={styles.value}>القيود المرحلة فقط</Text>
          </View>
        </View>

        <View style={styles.grid}>
          <View style={styles.tile}>
            <Text style={styles.label}>مجموع الموارد</Text>
            <Text style={styles.value}>{egp(hasData ? bs.assetsTotal : null)}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.label}>مجموع الالتزامات</Text>
            <Text style={styles.value}>{egp(hasData ? bs.liabilitiesTotal : null)}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.label}>حقوق المالك مع الربح</Text>
            <Text style={styles.value}>{egp(hasData ? bs.totalEquityInclIncome : null)}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.label}>صافي الربح حتى التاريخ</Text>
            <Text style={styles.value}>{egp(hasData ? bs.netIncome : null)}</Text>
          </View>
        </View>

        <Section title="الموارد" total={bs.assetsTotal} lines={bs.assets} />
        <Section title="الالتزامات" total={bs.liabilitiesTotal} lines={bs.liabilities} />
        <Section title="حقوق المالك" total={bs.equityTotal} lines={bs.equity} />

        <Text style={styles.note}>
          التحقق المحاسبي: الموارد {egp(bs.assetsTotal)} = الالتزامات + حقوق المالك + صافي الربح{" "}
          {egp(bs.liabilitiesPlusEquity)} — {bs.balanced ? "القائمة متوازنة" : "القائمة غير متوازنة"}.
        </Text>

        <View style={styles.signatures}>
          <View style={styles.signatureBox}>
            <Text style={styles.value}>إعداد المحاسب</Text>
            <Text style={styles.signatureLine}>الاسم والتوقيع</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text style={styles.value}>مراجعة المالك</Text>
            <Text style={styles.signatureLine}>الاسم والتوقيع</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderBalanceSheetPdf(input: { bs: BalanceSheet; asOf: string; generatedOn: string }): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(<BalanceSheetPdfDocument {...input} />);
}
