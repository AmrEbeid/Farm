import Link from "next/link";
import { Button, KpiCard } from "@amrebeid/ui";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">نظام تشغيل المزارع</h1>
        <p style={{ color: "var(--ink-muted)" }}>
          مزارع عبيد — الأساس (المرحلة أ): واجهة عربية من اليمين لليسار، مكتبة{" "}
          <code>@amrebeid/ui</code>، وعميل Supabase.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="القطاعات" value="٥" />
        <KpiCard label="الحوشات" value="٢٨" />
        <KpiCard label="النخيل" value="٤٬٣٨٠" unit="برحي" />
      </section>

      <nav className="flex flex-wrap gap-3">
        <Link href="/login">
          <Button variant="primary">تسجيل الدخول</Button>
        </Link>
        <Link href="/dashboard">
          <Button variant="ghost">لوحة التحكم</Button>
        </Link>
      </nav>
    </main>
  );
}
