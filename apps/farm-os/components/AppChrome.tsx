"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { AppShell, Tag, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import type { Role } from "@/lib/auth";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { ModuleSidebar } from "@/components/ModuleSidebar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { AutoBreadcrumbs } from "@/components/AutoBreadcrumbs";
import { findActiveNavItem, visibleModulesForRole } from "@/lib/nav";

const HelpDrawer = dynamic(() => import("@/components/HelpDrawer").then((mod) => mod.HelpDrawer), {
  ssr: false,
  loading: () => (
    <Button variant="ghost" size="sm" disabled aria-label="تحميل مساعدة هذه الصفحة">
      ؟
    </Button>
  ),
});

const CommandPalette = dynamic(() => import("@/components/CommandPalette").then((mod) => mod.CommandPalette), {
  ssr: false,
  loading: () => (
    <Button variant="ghost" size="sm" disabled aria-label="تحميل البحث" className="flex items-center gap-2">
      <span aria-hidden="true">🔍</span>
      <span className="hidden sm:inline">بحث</span>
    </Button>
  ),
});

export function AppChrome({
  children,
  role,
  roleLabel,
  name,
  orgs,
  activeOrgId,
}: {
  children: React.ReactNode;
  role: string;
  roleLabel: string;
  name: string | null;
  orgs: { id: string; name: string }[];
  activeOrgId: string | null;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const modules = visibleModulesForRole(role as Role);
  const activeNavId = findActiveNavItem(pathname)?.id ?? "dashboard";

  async function signOut() {
    await createClient().auth.signOut();
    window.location.assign("/login");
  }

  return (
    <>
      {/*
       * Skip-to-content: first focusable element on the page (visually hidden
       * until focused, see .skip-to-content in globals.css). Targets the #main
       * focus wrapper inside AppShell's <main> landmark.
       */}
      <a href="#main" className="skip-to-content">
        تخطّي إلى المحتوى
      </a>
      <AppShell
      navItems={[]}
      activeNavId={activeNavId}
      navAriaLabel="التنقل الرئيسي"
      menuButtonLabel="فتح القائمة"
      sidebarOpen={sidebarOpen}
      onSidebarOpenChange={setSidebarOpen}
      brand={<span className="font-bold">نظام تشغيل المزارع</span>}
      topbar={
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
          <CommandPalette modules={modules} />
          <HelpDrawer pathname={pathname} fallbackHelpId={activeNavId} />
          <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
          <Tag tone="accent">{roleLabel}</Tag>
          {name && <span className="text-sm">{name}</span>}
          <Button variant="ghost" size="sm" onClick={signOut}>
            خروج
          </Button>
        </div>
      }
    >
      <ModuleSidebar
        modules={modules}
        activeNavId={activeNavId}
        onNavigate={() => setSidebarOpen(false)}
      />
      {/*
       * Focus target for the skip link. AppShell already renders the <main
       * role="main"> landmark; this is a non-landmark wrapper (no role) that
       * carries the id + tabIndex={-1} so keyboard focus lands on the content.
       */}
      <div id="main" tabIndex={-1}>
        <AutoBreadcrumbs pathname={pathname} />
        {children}
      </div>
    </AppShell>
      <MobileTabBar role={role} pathname={pathname} />
    </>
  );
}
