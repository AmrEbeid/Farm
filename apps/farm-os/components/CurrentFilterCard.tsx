import Link from "next/link";
import { Card } from "@/components/ui";

export function CurrentFilterCard({
  label,
  clearHref,
  showClear = true,
}: {
  label: string;
  clearHref: string;
  showClear?: boolean;
}) {
  return (
    <Card title="الفلتر الحالي">
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        {label}
      </p>
      {showClear && (
        <Link href={clearHref} className="mt-3 inline-block font-medium underline underline-offset-4" style={{ color: "var(--brand)" }}>
          مسح الفلتر
        </Link>
      )}
    </Card>
  );
}
