import type { Meta, StoryObj } from "@storybook/react-vite";
import { NavItem } from "./NavItem";

const meta: Meta<typeof NavItem> = {
  title: "Navigation/NavItem",
  component: NavItem,
  args: { item: { id: "plans", label: "الخطة الشهرية", icon: "🗓️", href: "/plans" }, active: false },
};
export default meta;
type S = StoryObj<typeof NavItem>;

export const Default: S = {};
export const Active: S = { args: { active: true } };
export const NoIcon: S = { args: { item: { id: "reports", label: "التقارير", href: "/reports" } } };

export const List: S = {
  render: () => (
    <nav style={{ display: "flex", flexDirection: "column", gap: 4, width: 240 }}>
      <NavItem item={{ id: "d", label: "لوحة التحكم", icon: "🏠", href: "/dashboard" }} active />
      <NavItem item={{ id: "f", label: "المزرعة", icon: "🌴", href: "/farm" }} />
      <NavItem item={{ id: "i", label: "المخزون", icon: "📦", href: "/inventory" }} />
    </nav>
  ),
};
