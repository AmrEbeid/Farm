import type { Meta, StoryObj } from "@storybook/react";
import { Tag } from "./Tag";

const meta: Meta<typeof Tag> = {
  title: "Data Display/Tag",
  component: Tag,
  args: { children: "مكتملة", tone: "ok" },
  argTypes: { tone: { control: "select", options: ["ok", "warning", "danger", "info", "neutral", "accent"] } },
};
export default meta;
type S = StoryObj<typeof Tag>;

export const Ok: S = { args: { tone: "ok", children: "مكتملة" } };
export const Warning: S = { args: { tone: "warning", children: "بانتظار" } };
export const Danger: S = { args: { tone: "danger", children: "محظورة: نقص مخزون" } };
export const Info: S = { args: { tone: "info", children: "مدفوعة" } };
export const Neutral: S = { args: { tone: "neutral", children: "مسودة" } };
export const Accent: S = { args: { tone: "accent", children: "تحديث" } };
export const AllTones: S = {
  render: () => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Tag tone="ok">معتمدة</Tag>
      <Tag tone="warning">بانتظار</Tag>
      <Tag tone="danger">مرفوضة</Tag>
      <Tag tone="info">مدفوعة</Tag>
      <Tag tone="neutral">مسودة</Tag>
      <Tag tone="accent">تحديث</Tag>
    </div>
  ),
};
