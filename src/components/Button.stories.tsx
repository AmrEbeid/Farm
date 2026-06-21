import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "Actions/Button",
  component: Button,
  args: { children: "اعتماد", variant: "primary", size: "md" },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "ghost", "danger"] },
    size: { control: "inline-radio", options: ["md", "sm"] },
  },
};
export default meta;
type S = StoryObj<typeof Button>;

export const Primary: S = { args: { variant: "primary", children: "اعتماد الطلب" } };
export const Ghost: S = { args: { variant: "ghost", children: "إلغاء" } };
export const Danger: S = { args: { variant: "danger", children: "✕ رفض" } };
export const Small: S = { args: { size: "sm", children: "عرض" } };
export const Loading: S = { args: { loading: true, children: "جارٍ الحفظ" } };
export const Disabled: S = { args: { disabled: true, children: "اعتماد (للمالك فقط)" } };
export const WithIcon: S = { args: { icon: "✓", children: "تم" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <Button variant="primary">اعتماد</Button>
      <Button variant="ghost">إلغاء</Button>
      <Button variant="danger">رفض</Button>
      <Button size="sm" variant="ghost">عرض</Button>
      <Button loading>حفظ</Button>
      <Button disabled>غير متاح</Button>
    </div>
  ),
};
