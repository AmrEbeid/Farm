import Link from "next/link";
import { Button } from "@/components/ui";

export default function Home() {
  // Public, unauthenticated landing page — no org context, so it must NOT display
  // any farm figures (a hardcoded count would be fabricated data, violating the
  // no-fabricated-numbers rule). Real KPIs live behind auth on the role dashboards,
  // each derived from a live org-scoped query.
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">نظام تشغيل المزارع</h1>
        <p style={{ color: "var(--ink-muted)" }}>
          مزارع عبيد — الأساس (المرحلة أ): واجهة عربية من اليمين لليسار، مكتبة{" "}
          <code>@amrebeid/ui</code>، وعميل Supabase.
        </p>
      </header>

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
