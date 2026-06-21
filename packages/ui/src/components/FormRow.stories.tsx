import type { Meta, StoryObj } from "@storybook/react";
import { FormRow } from "./FormRow";
import { Input } from "./Input";
import { Select } from "./Select";

const meta: Meta<typeof FormRow> = {
  title: "Forms/FormRow",
  component: FormRow,
};
export default meta;
type S = StoryObj<typeof FormRow>;

export const WithHelp: S = {
  render: () => (
    <div style={{ maxWidth: 320 }}>
      <FormRow id="name" label="اسم المزرعة" help="الاسم كما في السجل التجاري">
        <Input placeholder="مزرعة عبيد" />
      </FormRow>
    </div>
  ),
};

export const WithError: S = {
  render: () => (
    <div style={{ maxWidth: 320 }}>
      <FormRow id="qty" label="الكمية" help="بالكيلوجرام" error="القيمة يجب أن تكون أكبر من صفر">
        <Input defaultValue="0" />
      </FormRow>
    </div>
  ),
};

export const Required: S = {
  render: () => (
    <div style={{ maxWidth: 320 }}>
      <FormRow id="status" label="الحالة" required>
        <Select
          options={[
            { value: "ok", label: "سليمة" },
            { value: "low", label: "منخفضة" },
          ]}
          placeholder="اختر…"
        />
      </FormRow>
    </div>
  ),
};

export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 16, maxWidth: 320 }}>
      <FormRow id="g1" label="الاسم" help="الاسم الكامل"><Input placeholder="الاسم" /></FormRow>
      <FormRow id="g2" label="الكمية" required error="مطلوب"><Input /></FormRow>
    </div>
  ),
};
