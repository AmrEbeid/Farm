import type { Meta, StoryObj } from "@storybook/react";
import { Checkbox } from "./Checkbox";

const meta: Meta<typeof Checkbox> = {
  title: "Forms/Checkbox",
  component: Checkbox,
  args: { label: "موافق على الشروط" },
};
export default meta;
type S = StoryObj<typeof Checkbox>;

export const Default: S = { args: { label: "تفعيل التنبيهات" } };
export const Checked: S = { args: { label: "مكتمل", defaultChecked: true } };
export const Invalid: S = { args: { label: "إقرار مطلوب", invalid: true } };
export const Disabled: S = { args: { label: "غير متاح", disabled: true } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 10 }}>
      <Checkbox label="خيار افتراضي" />
      <Checkbox label="مُحدد" defaultChecked />
      <Checkbox label="خطأ" invalid />
      <Checkbox label="معطل" disabled />
    </div>
  ),
};
