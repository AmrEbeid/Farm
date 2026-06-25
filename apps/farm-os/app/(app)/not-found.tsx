// Route-level not-found (404) for the (app) segment. Rendered inside AppChrome
// (the authenticated shell), so a broken in-app link keeps the sidebar/nav in
// place instead of dropping the user to the bare root 404. RTL is inherited
// from the root <html dir="rtl">. Mirrors the (app) error.tsx fallback style.
import Link from "next/link";
import { Alert, Button, Card } from "@/components/ui";

export default function AppNotFound() {
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
            description="ربما يكون الرابط غير صحيح. يمكنك العودة إلى لوحة التحكم والمتابعة من هناك."
          />

          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard">
              <Button variant="primary">العودة إلى لوحة التحكم</Button>
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
