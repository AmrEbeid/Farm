import type { Meta, StoryObj } from "@storybook/react";
import { PhaseCard } from "./PhaseCard";

const meta: Meta<typeof PhaseCard> = {
  title: "Domain/PhaseCard",
  component: PhaseCard,
  args: {
    title: "تقليم النخيل",
    tone: "warning",
    status: "قيد التنفيذ",
    meta: [
      { label: "الموعد", value: "١٢ يونيو" },
      { label: "المسؤول", value: "خالد" },
    ],
    progress: 45,
    progressLabel: "نسبة الإنجاز",
  },
  argTypes: { tone: { control: "inline-radio", options: ["neutral", "info", "ok", "warning", "danger"] } },
};
export default meta;
type S = StoryObj<typeof PhaseCard>;

export const Default: S = {};
export const Completed: S = { args: { tone: "ok", status: "مكتملة", progress: 100 } };
export const Blocked: S = { args: { tone: "danger", status: "متوقفة", progress: 20 } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 12, maxWidth: 360 }}>
      <PhaseCard title="ري" tone="info" status="مجدولة" meta={[{ label: "الموعد", value: "غدًا" }]} />
      <PhaseCard title="تسميد" tone="ok" status="مكتملة" progress={100} progressLabel="الإنجاز" />
      <PhaseCard title="مكافحة آفات" tone="danger" status="متوقفة" progress={10} progressLabel="الإنجاز" />
    </div>
  ),
};
