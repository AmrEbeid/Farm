import type { Meta, StoryObj } from "@storybook/react";
import { SidebarNav } from "./SidebarNav";
import type { NavItemData } from "./NavItem";

const items: NavItemData[] = [
  { id: "dashboard", label: "لوحة التحكم", icon: "📊", href: "/" },
  { id: "palms", label: "النخيل", icon: "🌴", href: "/palms" },
  { id: "inventory", label: "المخزون", icon: "📦", href: "/inventory" },
  { id: "accounting", label: "المحاسبة", icon: "💰", href: "/accounting", roles: ["owner", "accountant"] },
  { id: "settings", label: "الإعدادات", icon: "⚙️", href: "/settings", roles: ["owner"] },
];

const meta: Meta<typeof SidebarNav> = {
  title: "Navigation/SidebarNav",
  component: SidebarNav,
  args: { items, activeId: "palms", ariaLabel: "التنقل الرئيسي" },
  argTypes: { role: { control: "inline-radio", options: [undefined, "owner", "accountant", "worker"] } },
};
export default meta;
type S = StoryObj<typeof SidebarNav>;

export const Default: S = {};
export const OwnerRole: S = { args: { role: "owner" } };
export const WorkerRole: S = { args: { role: "worker" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div style={{ width: 220 }}><SidebarNav items={items} activeId="dashboard" ariaLabel="مالك" role="owner" /></div>
      <div style={{ width: 220 }}><SidebarNav items={items} activeId="palms" ariaLabel="عامل" role="worker" /></div>
    </div>
  ),
};
