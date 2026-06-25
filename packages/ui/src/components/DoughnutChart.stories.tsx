import type { Meta, StoryObj } from "@storybook/react-vite";
import { DoughnutChart } from "./DoughnutChart";

const meta: Meta<typeof DoughnutChart> = {
  title: "Charts/DoughnutChart",
  component: DoughnutChart,
  args: {
    data: [
      { name: "معتمد", value: 62 },
      { name: "قيد المراجعة", value: 24 },
      { name: "مرفوض", value: 14 },
    ],
    ariaLabel: "توزيع حالات الطلبات",
    height: 280,
  },
};
export default meta;
type S = StoryObj<typeof DoughnutChart>;

export const Doughnut: S = {};
export const Pie: S = { args: { innerRatio: 0 } };
export const NoLegend: S = { args: { showLegend: false } };
export const Gallery: S = {
  render: (args) => (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div style={{ width: 320 }}><DoughnutChart {...args} /></div>
      <div style={{ width: 320 }}><DoughnutChart {...args} innerRatio={0} /></div>
    </div>
  ),
};
