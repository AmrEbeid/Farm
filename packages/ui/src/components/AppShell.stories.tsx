import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { AppShell } from "./AppShell";
import type { NavItemData } from "./NavItem";
import { SearchInput } from "./SearchInput";
import { RoleSwitcher } from "./RoleSwitcher";

const navItems: NavItemData[] = [
  { id: "dashboard", label: "لوحة التحكم", icon: "📊", href: "/" },
  { id: "palms", label: "النخيل", icon: "🌴", href: "/palms" },
  { id: "inventory", label: "المخزون", icon: "📦", href: "/inventory" },
  { id: "accounting", label: "المحاسبة", icon: "💰", href: "/accounting", roles: ["owner", "accountant"] },
  { id: "settings", label: "الإعدادات", icon: "⚙️", href: "/settings", roles: ["owner"] },
];

const meta: Meta<typeof AppShell> = {
  title: "Navigation/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
  argTypes: { role: { control: "inline-radio", options: [undefined, "owner", "accountant", "worker"] } },
  args: {
    navItems,
    activeNavId: "palms",
    navAriaLabel: "التنقل الرئيسي",
    menuButtonLabel: "فتح القائمة",
  },
};
export default meta;
type S = StoryObj<typeof AppShell>;

function Topbar() {
  const [q, setQ] = React.useState("");
  const [role, setRole] = React.useState("owner");
  return (
    <>
      <SearchInput label="بحث" icon="🔍" placeholder="ابحث…" value={q} onValueChange={setQ} />
      <RoleSwitcher
        label="الدور"
        value={role}
        onRoleChange={setRole}
        options={[
          { id: "owner", label: "المالك" },
          { id: "accountant", label: "المحاسب" },
          { id: "worker", label: "العامل" },
        ]}
      />
    </>
  );
}

/**
 * Consumer-owned sidebar: collapsible workspaces (buttons) plus real links. Stands in for the app
 * navigation R1b moves into the `sidebar` slot — links close the mobile drawer, toggles do not.
 */
function AppSidebar() {
  const [openGroup, setOpenGroup] = React.useState<string | null>("farm");
  const groups = [
    { id: "farm", label: "المزرعة", links: [["/palms", "النخيل"], ["/blocks", "القطاعات"]] },
    { id: "ops", label: "العمليات", links: [["/tasks", "المهام"], ["/irrigation", "الري"]] },
  ];
  return (
    <nav aria-label="تنقل التطبيق" style={{ display: "grid", gap: "var(--space-2)" }}>
      <a href="/" style={{ fontWeight: 700, color: "var(--ink)" }}>الرئيسية</a>
      {groups.map((g) => (
        <div key={g.id}>
          <button
            type="button"
            aria-expanded={openGroup === g.id}
            onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)}
            style={{ all: "unset", cursor: "pointer", fontWeight: 600, color: "var(--ink-muted)" }}
          >
            {g.label}
          </button>
          {openGroup === g.id && (
            <div style={{ display: "grid", gap: "var(--space-1)", paddingInlineStart: "var(--space-3)" }}>
              {g.links.map(([href, label]) => (
                <a key={href} href={href} style={{ color: "var(--ink)" }}>{label}</a>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

/** Inline stand-in for the app's Lucide `Menu` — the slot takes any node, so UI adds no dependency. */
function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

export const Default: S = {
  render: (args) => (
    <AppShell {...args} brand={<span>🌴 مزرعة عبيد</span>} topbar={<Topbar />}>
      <h1 style={{ marginTop: 0 }}>النخيل</h1>
      <p>محتوى الصفحة هنا. غيّر عرض النافذة لرؤية القائمة الجانبية تنطوي إلى درج.</p>
    </AppShell>
  ),
};

export const WorkerRole: S = {
  args: { role: "worker" },
  render: (args) => (
    <AppShell {...args} brand={<span>🌴 مزرعة عبيد</span>} topbar={<Topbar />}>
      <h1 style={{ marginTop: 0 }}>عرض العامل</h1>
      <p>عناصر المحاسبة والإعدادات مخفية لهذا الدور.</p>
    </AppShell>
  ),
};

/** The `sidebar` slot replaces the generated `navItems` nav; `menuIcon` replaces the ☰ fallback. */
export const CustomSidebarAndMenuIcon: S = {
  render: (args) => (
    <AppShell {...args} sidebar={<AppSidebar />} menuIcon={<MenuIcon />} brand={<span>🌴 مزرعة عبيد</span>} topbar={<Topbar />}>
      <h1 style={{ marginTop: 0 }}>القطاعات</h1>
      <p>القائمة الجانبية من التطبيق نفسه؛ الروابط تُغلق الدرج على الجوال، وأزرار المجموعات لا تغلقه.</p>
    </AppShell>
  ),
};

/**
 * Mobile RTL drawer, forced open: the drawer sits above the scrim on the inline-start (right) edge
 * and the scrim beside it stays clickable. Narrow the viewport if the toolbar viewport does not apply.
 */
export const MobileRtlDrawerOpen: S = {
  globals: { direction: "rtl", viewport: { value: "mobile2", isRotated: false } },
  render: function MobileRtlDrawerStory(args) {
    const [open, setOpen] = React.useState(true);
    return (
      <AppShell {...args} sidebar={<AppSidebar />} menuIcon={<MenuIcon />} sidebarOpen={open} onSidebarOpenChange={setOpen} brand={<span>🌴 مزرعة عبيد</span>}>
        <h1 style={{ marginTop: 0 }}>الرئيسية</h1>
        <p>الدرج مفتوح فوق الحجاب؛ اضغط الحجاب للإغلاق.</p>
      </AppShell>
    );
  },
};

export const Gallery: S = {
  render: () => (
    <AppShell
      navItems={navItems}
      activeNavId="inventory"
      role="accountant"
      navAriaLabel="التنقل"
      menuButtonLabel="فتح القائمة"
      brand={<span>🌴 مزرعة عبيد</span>}
      topbar={<Topbar />}
    >
      <h1 style={{ marginTop: 0 }}>المخزون</h1>
    </AppShell>
  ),
};
