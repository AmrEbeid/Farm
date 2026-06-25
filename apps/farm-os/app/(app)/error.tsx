"use client";

// Route-level error boundary for the (app) segment. Catches render/server
// errors thrown by any page rendered inside AppChrome and shows a friendly
// Arabic-RTL fallback instead of Next.js's default white error page.
// RTL is inherited from the root <html dir="rtl">. We never surface raw error
// details to users (could leak internals); the error is logged to the console
// for diagnostics only.
import { useEffect } from "react";
import Link from "next/link";
import { Alert, Button, Card } from "@/components/ui";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Diagnostics only — not shown to the user.
    console.error("[app] route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card
        title="حدث خطأ غير متوقع"
        subtitle="نعتذر عن هذا الخلل — يمكنك إعادة المحاولة أو العودة إلى لوحة التحكم."
        className="w-full max-w-lg"
      >
        <div className="flex flex-col gap-4">
          <Alert
            tone="danger"
            title="تعذّر عرض هذه الصفحة"
            description="حدث خطأ أثناء تحميل المحتوى. إذا استمرت المشكلة، يُرجى التواصل مع الدعم."
          />

          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => reset()}>
              إعادة المحاولة
            </Button>
            <Link href="/dashboard">
              <Button variant="ghost">العودة إلى لوحة التحكم</Button>
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
