import type { Meta, StoryObj } from "@storybook/react";
import { StatusPill } from "./StatusPill";

const meta: Meta<typeof StatusPill> = {
  title: "Domain/StatusPill",
  component: StatusPill,
  args: { status: "active", children: "قيد التنفيذ", dot: true },
  argTypes: {
    status: { control: "inline-radio", options: ["draft", "scheduled", "active", "done", "warning", "blocked"] },
  },
};
export default meta;
type S = StoryObj<typeof StatusPill>;

export const Active: S = {};
export const Done: S = { args: { status: "done", children: "مكتملة" } };
export const Blocked: S = { args: { status: "blocked", children: "متوقفة" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <StatusPill status="draft">مسودة</StatusPill>
      <StatusPill status="scheduled">مجدولة</StatusPill>
      <StatusPill status="active">قيد التنفيذ</StatusPill>
      <StatusPill status="done">مكتملة</StatusPill>
      <StatusPill status="warning">تحذير</StatusPill>
      <StatusPill status="blocked">متوقفة</StatusPill>
    </div>
  ),
};
