import type { Meta, StoryObj } from "@storybook/react";
import { Progress } from "./Progress";

const meta: Meta<typeof Progress> = {
  title: "Data Display/Progress",
  component: Progress,
  args: { value: 66, tone: "default", label: "إنجاز البرنامج" },
  argTypes: { tone: { control: "inline-radio", options: ["default", "warning", "danger"] }, value: { control: { type: "range", min: 0, max: 100 } } },
  decorators: [(S) => <div style={{ width: 280 }}><S /></div>],
};
export default meta;
type S = StoryObj<typeof Progress>;

export const Default: S = { args: { value: 75 } };
export const Warning: S = { args: { value: 90, tone: "warning" } };
export const Danger: S = { args: { value: 25, tone: "danger" } };
export const BudgetRows: S = {
  render: () => (
    <div style={{ display: "grid", gap: 12, width: 320 }}>
      <div><div style={{ fontSize: 12, marginBottom: 4 }}>أسمدة — 87%</div><Progress value={87} tone="warning" /></div>
      <div><div style={{ fontSize: 12, marginBottom: 4 }}>ري ووقود — 90%</div><Progress value={90} tone="danger" /></div>
      <div><div style={{ fontSize: 12, marginBottom: 4 }}>تعبئة — 70%</div><Progress value={70} /></div>
    </div>
  ),
};
