import { Card } from "@/components/ui";

export interface FinanceStatementPrintItem {
  id: string;
  label: string;
  value: string;
}

const defaultSignatures = ["إعداد المحاسب", "مراجعة المالك"];
const tileStyle = { borderColor: "var(--line)", background: "var(--surface)" } as const;
const mutedStyle = { color: "var(--ink-muted)" } as const;
const signatureLineStyle = { borderColor: "var(--line)", color: "var(--ink-muted)" } as const;

export function FinanceStatementPrintPacket({
  title,
  items,
  signatures = defaultSignatures,
}: {
  title: string;
  items: FinanceStatementPrintItem[];
  signatures?: string[];
}) {
  return (
    <section className="print-only">
      <Card title={title}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.id} className="rounded-md border p-3" style={tileStyle}>
              <div className="text-xs" style={mutedStyle}>
                {item.label}
              </div>
              <div className="mt-1 text-sm font-semibold">{item.value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {signatures.map((signature) => (
            <div key={signature} className="rounded-md border p-3" style={tileStyle}>
              <div className="text-sm font-semibold">{signature}</div>
              <div className="mt-8 border-t pt-2 text-xs" style={signatureLineStyle}>
                الاسم والتوقيع
              </div>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}
