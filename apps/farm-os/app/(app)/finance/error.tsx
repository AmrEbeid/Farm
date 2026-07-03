"use client";

// F11: finance-segment error boundary (/finance/*). Isolates a render/server error on a finance
// page from the rest of the (app) shell and offers a finance-scoped recovery (retry / back to the
// finance dashboard) instead of the generic app fallback. Raw error details are never surfaced to
// the user (finance internals must not leak); the error is logged for diagnostics only. RTL is
// inherited from the root <html dir="rtl">.
import { useEffect } from "react";
import Link from "next/link";
import { Alert, Button, Card } from "@/components/ui";

export default function FinanceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Diagnostics only — never shown to the user.
    console.error("[finance] route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card
        title="تعذّر عرض هذه الصفحة المالية"
        subtitle="نعتذر عن هذا الخلل — يمكنك إعادة المحاولة أو العودة إلى لوحة المالية."
        className="w-full max-w-lg"
      >
        <div className="flex flex-col gap-4">
          <Alert
            tone="danger"
            title="حدث خطأ أثناء تحميل المحتوى المالي"
            description="إذا استمرت المشكلة، يُرجى التواصل مع الدعم."
          />
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => reset()}>
              إعادة المحاولة
            </Button>
            <Link href="/finance/dashboard">
              <Button variant="ghost">العودة إلى لوحة المالية</Button>
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
