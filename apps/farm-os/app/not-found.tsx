// Root not-found (404) page. Rendered within the root layout, so RTL is
// inherited from <html dir="rtl"> and the @amrebeid/ui ThemeProvider is in
// scope. Mirrors the (app) error.tsx fallback (Card + Alert + actions) for a
// consistent, friendly Arabic experience instead of Next.js's default 404.
import Link from "next/link";
import { Alert, Button, Card } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card
        title="الصفحة غير موجودة"
        subtitle="عذرًا، الصفحة التي تبحث عنها غير متوفرة أو ربما تم نقلها."
        className="w-full max-w-lg"
      >
        <div className="flex flex-col gap-4">
          <Alert
            tone="warning"
            title="تعذّر العثور على هذه الصفحة (خطأ ٤٠٤)"
            description="ربما يكون الرابط غير صحيح. يمكنك العودة إلى لوحة المعلومات أو الصفحة الرئيسية."
          />

          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard">
              <Button variant="primary">العودة إلى لوحة المعلومات</Button>
            </Link>
            <Link href="/">
              <Button variant="ghost">الصفحة الرئيسية</Button>
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
