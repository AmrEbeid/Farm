import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoopStepper, type LoopStep } from "./LoopStepper";

const steps: LoopStep[] = [
  { id: "plan", label: "تخطيط", state: "done" },
  { id: "check", label: "فحص", state: "done" },
  { id: "approve", label: "اعتماد", state: "active" },
  { id: "execute", label: "تنفيذ", state: "pending" },
  { id: "file", label: "أرشفة", state: "pending" },
];

const meta: Meta<typeof LoopStepper> = {
  title: "Domain/LoopStepper",
  component: LoopStepper,
  args: { steps, ariaLabel: "حلقة التخطيط" },
};
export default meta;
type S = StoryObj<typeof LoopStepper>;

export const Default: S = {};
export const WithBlocked: S = {
  args: { steps: [...steps.slice(0, 3), { id: "execute", label: "تنفيذ", state: "blocked" }, steps[4]] },
};
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 16 }}>
      <LoopStepper ariaLabel="بداية" steps={steps.map((s, i) => ({ ...s, state: i === 0 ? "active" : "pending" }))} />
      <LoopStepper ariaLabel="منتصف" steps={steps} />
      <LoopStepper ariaLabel="اكتمال" steps={steps.map((s) => ({ ...s, state: "done" }))} />
    </div>
  ),
};
