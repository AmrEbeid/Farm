import type { Meta, StoryObj } from "@storybook/react";
import { Textarea } from "./Textarea";

const meta: Meta<typeof Textarea> = {
  title: "Forms/Textarea",
  component: Textarea,
  args: { placeholder: "اكتب ملاحظاتك…", rows: 3 },
};
export default meta;
type S = StoryObj<typeof Textarea>;

export const Default: S = { args: { "aria-label": "ملاحظات", placeholder: "ملاحظات الزيارة" } };
export const Invalid: S = { args: { "aria-label": "ملاحظات", invalid: true, defaultValue: "نص غير صالح" } };
export const Disabled: S = { args: { "aria-label": "مقفل", disabled: true, defaultValue: "للقراءة فقط" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 10, maxWidth: 360 }}>
      <Textarea aria-label="عادي" placeholder="اكتب هنا…" />
      <Textarea aria-label="خطأ" invalid defaultValue="غير صالح" />
      <Textarea aria-label="معطل" disabled defaultValue="معطل" />
    </div>
  ),
};
