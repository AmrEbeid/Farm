"use client";

import { useState } from "react";
import {
  AppShell,
  KpiCard,
  StatusPill,
  Alert,
  type NavItemData,
} from "@/components/ui";

const NAV_ITEMS: NavItemData[] = [
  { id: "dashboard", label: "لوحة التحكم", icon: "🏠", href: "/dashboard" },
  { id: "farm", label: "المزرعة", icon: "🌴", href: "#" },
  { id: "plans", label: "الخطط", icon: "🗓️", href: "#" },
  { id: "inventory", label: "المخزون", icon: "📦", href: "#" },
  { id: "purchase", label: "طلبات الشراء", icon: "🧾", href: "#" },
];

export default function DashboardPage() {
  const [activeNavId, setActiveNavId] = useState("dashboard");

  return (
    <AppShell
      navItems={NAV_ITEMS}
      activeNavId={activeNavId}
      onNavSelect={setActiveNavId}
      navAriaLabel="التنقل الرئيسي"
      menuButtonLabel="فتح القائمة"
      brand={<span className="font-bold">نظام تشغيل المزارع</span>}
    >
      <div className="flex flex-col gap-6 p-6">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">لوحة تحكم المالك</h1>
          <StatusPill status="active">قيد التشغيل</StatusPill>
        </header>

        <Alert
          tone="info"
          title="نموذج أولي للمرحلة أ"
          description="هذه لوحة تحكم تجريبية تثبت ربط مكتبة @amrebeid/ui وعميل Supabase. البيانات أدناه توضيحية."
        />

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="المساحة" value="٣٬٣٤٠" unit="فدان" />
          <KpiCard label="القطاعات" value="٥" />
          <KpiCard label="الحوشات" value="٢٨" />
          <KpiCard
            label="مخزون سلفات البوتاسيوم"
            value="٣٠٠"
            unit="كجم"
            delta="الحد الأدنى ٢٠٠"
            deltaDirection="down"
          />
        </section>
      </div>
    </AppShell>
  );
}
