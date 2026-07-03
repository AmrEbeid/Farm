"use client";

// F11: field-surface error boundary for the /m segment (الميدان, /m/execute, /m/receive).
// Without this, a render/server error on the mobile field screens bubbles to the whole (app)
// boundary and shows the desktop-framed fallback. Field roles work one-handed on a phone, often on
// a weak connection, so this fallback is single-column with a large retry target and does NOT surface
// raw error details (could leak internals) — the error is logged for diagnostics only. RTL is
// inherited from the root <html dir="rtl">.
import { useEffect } from "react";
import Link from "next/link";
import { Alert, Button } from "@/components/ui";

export default function FieldError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Diagnostics only — never shown to the user.
    console.error("[m] field route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-5 p-4">
      <Alert
        tone="danger"
        title="تعذّر عرض هذه الشاشة"
        description="حدث خطأ أثناء التحميل. تحقّق من الاتصال ثم أعد المحاولة."
      />
      <div className="flex flex-col gap-3">
        <Button variant="primary" onClick={() => reset()} className="min-h-12 w-full text-base">
          إعادة المحاولة
        </Button>
        <Link href="/dashboard" className="w-full">
          <Button variant="ghost" className="min-h-12 w-full text-base">
            العودة إلى الصفحة الرئيسية
          </Button>
        </Link>
      </div>
    </div>
  );
}
