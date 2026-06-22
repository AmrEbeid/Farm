import type { Meta, StoryObj } from "@storybook/react";
import { LineChart } from "./LineChart";

const meta: Meta<typeof LineChart> = {
  title: "Charts/LineChart",
  component: LineChart,
  args: {
    data: [
      { أسبوع: "الأول", رطوبة: 41, حرارة: 28 },
      { أسبوع: "الثاني", رطوبة: 38, حرارة: 31 },
      { أسبوع: "الثالث", رطوبة: 44, حرارة: 30 },
      { أسبوع: "الرابع", رطوبة: 39, حرارة: 33 },
    ],
    categoryKey: "أسبوع",
    series: [{ dataKey: "رطوبة", name: "الرطوبة %" }],
    ariaLabel: "رطوبة التربة الأسبوعية بالنسبة المئوية",
    height: 280,
  },
};
export default meta;
type S = StoryObj<typeof LineChart>;

export const Single: S = {};
export const MultiSeries: S = {
  args: {
    series: [
      { dataKey: "رطوبة", name: "الرطوبة %" },
      { dataKey: "حرارة", name: "الحرارة °م" },
    ],
    showLegend: true,
  },
};
export const Linear: S = { args: { curve: "linear" } };
export const Gallery: S = {
  render: (args) => (
    <div style={{ display: "grid", gap: 24 }}>
      <LineChart {...args} />
      <LineChart {...args} curve="linear" showDots={false} />
    </div>
  ),
};
