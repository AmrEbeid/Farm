import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "./Field";

const meta: Meta<typeof Field> = {
  title: "Forms/Field",
  component: Field,
  args: { label: "المبلغ (ج.م)", id: "amount", placeholder: "مثال: 42,000" },
  decorators: [(S) => <div style={{ width: 300 }}><S /></div>],
};
export default meta;
type S = StoryObj<typeof Field>;

export const Default: S = {};
export const WithError: S = { args: { label: "الكمية", id: "qty", placeholder: "كجم", error: "الكمية تتجاوز المخزون المتاح" } };
export const Select: S = {
  args: { label: "القطاع", id: "sector" },
  render: (args) => (
    <Field {...args}>
      <select id="sector" className="fos-field__control" defaultValue="hoswa">
        <option value="hoswa">الحصوة</option>
        <option value="khatara">الخطارة</option>
        <option value="babour">حوض البابور</option>
      </select>
    </Field>
  ),
};
