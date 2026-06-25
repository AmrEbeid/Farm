import type { Meta, StoryObj } from "@storybook/react-vite";
import { DescriptionList, type DescriptionItem } from "./DescriptionList";

const items: DescriptionItem[] = [
  { id: "owner", term: "المالك", description: "عمر عبيد" },
  { id: "region", term: "المنطقة", description: "الوادي الجديد" },
  { id: "area", term: "المساحة", description: "١٢ فدان", numeric: true },
  { id: "trees", term: "عدد الأشجار", description: "٤٨٠", numeric: true },
];

const meta: Meta<typeof DescriptionList> = {
  title: "Data display/DescriptionList",
  component: DescriptionList,
  args: { items },
  argTypes: { layout: { control: "inline-radio", options: ["stacked", "inline"] } },
};
export default meta;
type S = StoryObj<typeof DescriptionList>;

export const Stacked: S = { args: { layout: "stacked" } };
export const Inline: S = { args: { layout: "inline" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 40, flexWrap: "wrap", maxWidth: 640 }}>
      <DescriptionList items={items} layout="stacked" />
      <DescriptionList items={items} layout="inline" />
    </div>
  ),
};
