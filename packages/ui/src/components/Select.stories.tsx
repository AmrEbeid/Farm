import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select } from "./Select";

const options = [
  { value: "ok", label: "سليمة" },
  { value: "low", label: "منخفضة" },
  { value: "crit", label: "حرجة" },
];

const meta: Meta<typeof Select> = {
  title: "Forms/Select",
  component: Select,
  args: { options, selectSize: "md" },
  argTypes: { selectSize: { control: "inline-radio", options: ["md", "sm"] } },
};
export default meta;
type S = StoryObj<typeof Select>;

export const Default: S = { args: { "aria-label": "الحالة", placeholder: "اختر الحالة…" } };
export const Small: S = { args: { "aria-label": "الحالة", selectSize: "sm", defaultValue: "ok" } };
export const Invalid: S = { args: { "aria-label": "الحالة", invalid: true, placeholder: "مطلوب" } };
export const Disabled: S = { args: { "aria-label": "الحالة", disabled: true, defaultValue: "ok" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 10, maxWidth: 280 }}>
      <Select aria-label="أ" options={options} placeholder="اختر…" />
      <Select aria-label="ب" options={options} selectSize="sm" defaultValue="low" />
      <Select aria-label="ج" options={options} invalid placeholder="مطلوب" />
      <Select aria-label="د" options={options} disabled defaultValue="ok" />
    </div>
  ),
};
