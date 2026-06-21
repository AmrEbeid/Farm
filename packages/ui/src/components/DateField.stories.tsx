import type { Meta, StoryObj } from "@storybook/react";
import { DateField } from "./DateField";

const meta: Meta<typeof DateField> = {
  title: "Forms/DateField",
  component: DateField,
  args: { fieldSize: "md" },
  argTypes: { fieldSize: { control: "inline-radio", options: ["md", "sm"] } },
};
export default meta;
type S = StoryObj<typeof DateField>;

export const Default: S = { args: { "aria-label": "تاريخ الزيارة" } };
export const WithValue: S = { args: { "aria-label": "التاريخ", defaultValue: "2026-06-21" } };
export const Small: S = { args: { "aria-label": "التاريخ", fieldSize: "sm", defaultValue: "2026-06-21" } };
export const Invalid: S = { args: { "aria-label": "التاريخ", invalid: true } };
export const Disabled: S = { args: { "aria-label": "التاريخ", disabled: true, defaultValue: "2026-06-21" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 10, maxWidth: 240 }}>
      <DateField aria-label="أ" defaultValue="2026-06-21" />
      <DateField aria-label="ب" fieldSize="sm" defaultValue="2026-06-21" />
      <DateField aria-label="ج" invalid />
      <DateField aria-label="د" disabled defaultValue="2026-06-21" />
    </div>
  ),
};
