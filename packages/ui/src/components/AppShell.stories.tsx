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
