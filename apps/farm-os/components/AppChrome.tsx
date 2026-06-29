"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell, Tag, Button, type NavItemData } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { HelpDrawer } from "@/components/HelpDrawer";
import { APP_NAV } from "@/lib/nav";

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
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems: NavItemData[] = APP_NAV.filter(
    (n) => !n.roles || n.roles.includes(role as never),
  ).map((n) => ({ id: n.id, label: n.label, icon: n.icon, href: n.href }));

  const activeNavId =
    APP_NAV.find((n) => pathname.startsWith(n.href.split("/").slice(0, 2).join("/")))?.id ??
    "dashboard";

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
      navItems={navItems}
      activeNavId={activeNavId}
      navAriaLabel="التنقل الرئيسي"
      menuButtonLabel="فتح القائمة"
      sidebarOpen={sidebarOpen}
      onSidebarOpenChange={setSidebarOpen}
      onNavSelect={(id) => {
        const item = APP_NAV.find((n) => n.id === id);
        if (item) {
          router.push(item.href);
          setSidebarOpen(false);
        }
      }}
      brand={<span className="font-bold">نظام تشغيل المزارع</span>}
      topbar={
        <div className="flex items-center gap-3">
          <HelpDrawer navId={activeNavId} />
          <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
          <Tag tone="accent">{roleLabel}</Tag>
          {name && <span className="text-sm">{name}</span>}
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
        {children}
      </div>
    </AppShell>
    </>
  );
}
