import Link from "next/link";
import type { Metadata } from "next";
import { RootDocument } from "@/app/root-document";
import { Alert, Button, Card } from "@/components/ui";

export const metadata: Metadata = {
  metadataBase: new URL("https://ebeidfarm.business"),
  title: "الصفحة غير موجودة",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <RootDocument lang="ar" dir="rtl">
      <div className="flex min-h-screen items-center justify-center p-6">
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
    </RootDocument>
  );
}
