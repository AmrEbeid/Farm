import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./IconButton";

const meta: Meta<typeof IconButton> = {
  title: "Forms/IconButton",
  component: IconButton,
  args: { label: "تعديل", children: "✎", variant: "ghost", size: "md" },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "ghost", "danger"] },
    size: { control: "inline-radio", options: ["md", "sm"] },
  },
};
export default meta;
type S = StoryObj<typeof IconButton>;

export const Ghost: S = { args: { label: "تعديل", children: "✎" } };
export const Primary: S = { args: { label: "إضافة", children: "＋", variant: "primary" } };
export const Danger: S = { args: { label: "حذف", children: "🗑", variant: "danger" } };
export const Small: S = { args: { label: "عرض", children: "👁", size: "sm" } };
export const Loading: S = { args: { label: "حفظ", children: "💾", loading: true } };
export const Disabled: S = { args: { label: "مقفل", children: "🔒", disabled: true } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <IconButton label="إضافة" variant="primary">＋</IconButton>
      <IconButton label="تعديل">✎</IconButton>
      <IconButton label="حذف" variant="danger">🗑</IconButton>
      <IconButton label="عرض" size="sm">👁</IconButton>
      <IconButton label="حفظ" loading>💾</IconButton>
    </div>
  ),
};
