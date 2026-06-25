import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "./Input";

const meta: Meta<typeof Input> = {
  title: "Forms/Input",
  component: Input,
  args: { placeholder: "اكتب هنا…", inputSize: "md" },
  argTypes: { inputSize: { control: "inline-radio", options: ["md", "sm"] } },
};
export default meta;
type S = StoryObj<typeof Input>;

export const Default: S = { args: { "aria-label": "الاسم", placeholder: "اسم المزرعة" } };
export const Small: S = { args: { "aria-label": "كود", inputSize: "sm", placeholder: "الكود" } };
export const Invalid: S = { args: { "aria-label": "البريد", invalid: true, defaultValue: "خطأ" } };
export const Disabled: S = { args: { "aria-label": "مقفل", disabled: true, defaultValue: "غير قابل للتعديل" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 10, maxWidth: 320 }}>
      <Input aria-label="عادي" placeholder="عادي" />
      <Input aria-label="صغير" inputSize="sm" placeholder="صغير" />
      <Input aria-label="خطأ" invalid defaultValue="قيمة غير صالحة" />
      <Input aria-label="معطل" disabled defaultValue="معطل" />
    </div>
  ),
};
