import type { Meta, StoryObj } from "@storybook/react-vite";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";

const items: Crumb[] = [
  { id: "home", label: "الرئيسية", href: "/" },
  { id: "palms", label: "النخيل", href: "/palms" },
  { id: "p-12", label: "نخلة ١٢" },
];

const meta: Meta<typeof Breadcrumbs> = {
  title: "Navigation/Breadcrumbs",
  component: Breadcrumbs,
  args: { items, ariaLabel: "مسار التنقل" },
};
export default meta;
type S = StoryObj<typeof Breadcrumbs>;

export const Default: S = {};
export const TwoLevels: S = { args: { items: items.slice(0, 2).concat({ id: "x", label: "المخزون" }) } };
export const CustomSeparator: S = { args: { separator: "‹" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Breadcrumbs items={items} ariaLabel="مسار ١" />
      <Breadcrumbs items={items} ariaLabel="مسار ٢" separator="←" />
    </div>
  ),
};
