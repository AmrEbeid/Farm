"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { AppShell, Tag, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import type { Role } from "@/lib/auth";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { ModuleSidebar } from "@/components/ModuleSidebar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { AutoBreadcrumbs } from "@/components/AutoBreadcrumbs";
import { NavIcon } from "@/components/NavIcon";
import {
  findActiveNavItem,
  primaryNavigationForRole,
  primaryNavIdForPath,
  visibleModulesForRole,
  workspaceModulesForRole,
} from "@/lib/nav";

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
      <NavIcon name="search" />
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

  const appRole = role as Role;
  const modules = visibleModulesForRole(appRole);
  const primaryItems = primaryNavigationForRole(appRole);
  const workspaces = workspaceModulesForRole(appRole);
  const activeNavId = findActiveNavItem(pathname)?.id ?? "dashboard";
  const activePrimaryNavId = primaryNavIdForPath(appRole, pathname);
  const activePrimaryIsExact = primaryItems.some(
    (item) => item.id === activePrimaryNavId && item.href === pathname,
  );

  async function signOut() {
    await createClient().auth.signOut();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Preserve the same-origin full reload after clearing the auth cookie.
    window.location.assign("/login");
  }

  return (
    <AppShell
      activeNavId={activeNavId}
      navAriaLabel="التنقل الرئيسي"
      menuButtonLabel="فتح القائمة"
      menuIcon={<Menu size={20} strokeWidth={2} />}
      sidebarOpen={sidebarOpen}
      onSidebarOpenChange={setSidebarOpen}
      sidebar={
        <ModuleSidebar
          primaryItems={primaryItems}
          workspaces={workspaces}
          activeNavId={activeNavId}
          activePrimaryNavId={activePrimaryNavId}
          activePrimaryIsExact={activePrimaryIsExact}
          onNavigate={() => setSidebarOpen(false)}
        />
      }
      skipLink={
        <a href="#main" className="skip-to-content">
          تخطّي إلى المحتوى
        </a>
      }
      mobileNavigation={<MobileTabBar role={appRole} pathname={pathname} />}
      brand={<span className="hidden font-bold sm:inline">نظام تشغيل المزارع</span>}
      topbar={
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
          <CommandPalette modules={modules} />
          <HelpDrawer pathname={pathname} fallbackHelpId={activeNavId} />
          <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
          <Tag tone="accent" className="hidden sm:inline-flex">
            {roleLabel}
          </Tag>
          {name && <span className="hidden text-sm sm:inline">{name}</span>}
          <Button variant="ghost" size="sm" onClick={signOut}>
            خروج
          </Button>
        </div>
      }
    >
      {/*
       * Focus target for the skip link. AppShell already renders the <main
       * role="main"> landmark; this is a non-landmark wrapper (no role) that
       * carries the id + tabIndex={-1} so keyboard focus lands on the content.
       */}
      <div id="main" tabIndex={-1}>
        <AutoBreadcrumbs pathname={pathname} role={appRole} />
        {children}
      </div>
    </AppShell>
  );
}
