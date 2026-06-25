import type { Meta, StoryObj } from "@storybook/react-vite";
import { ApprovalChain, type ApprovalStep } from "./ApprovalChain";

const steps: ApprovalStep[] = [
  { id: "req", state: "approved", actor: "مقدّم الطلب: سعاد", note: "١٢ يونيو" },
  { id: "rev", state: "pending", actor: "المراجع: خالد", note: "بانتظار المراجعة" },
  { id: "fin", state: "requested", actor: "المالك: عمر" },
];

const meta: Meta<typeof ApprovalChain> = {
  title: "Domain/ApprovalChain",
  component: ApprovalChain,
  args: { steps, ariaLabel: "سلسلة اعتماد طلب الصرف" },
};
export default meta;
type S = StoryObj<typeof ApprovalChain>;

export const InReview: S = {};
export const Approved: S = {
  args: { steps: steps.map((s) => ({ ...s, state: "approved" as const })) },
};
export const Rejected: S = {
  args: {
    steps: [
      { id: "req", state: "approved", actor: "مقدّم الطلب: سعاد" },
      { id: "rev", state: "rejected", actor: "المراجع: خالد", note: "تجاوز الميزانية" },
    ],
  },
};
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 16, maxWidth: 360 }}>
      <ApprovalChain ariaLabel="قيد المراجعة" steps={steps} />
      <ApprovalChain ariaLabel="مرفوض" steps={[
        { id: "a", state: "approved", actor: "سعاد" },
        { id: "b", state: "rejected", actor: "خالد", note: "تجاوز الميزانية" },
      ]} />
    </div>
  ),
};
