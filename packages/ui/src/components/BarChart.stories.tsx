import type { Meta, StoryObj } from "@storybook/react";
import { BarChart } from "./BarChart";

const meta: Meta<typeof BarChart> = {
  title: "Charts/BarChart",
  component: BarChart,
  args: {
    data: [
      { شهر: "يناير", إنتاج: 120, تالف: 12 },
      { شهر: "فبراير", إنتاج: 180, تالف: 20 },
      { شهر: "مارس", إنتاج: 90, تالف: 8 },
      { شهر: "أبريل", إنتاج: 210, تالف: 15 },
    ],
    categoryKey: "شهر",
    series: [{ dataKey: "إنتاج", name: "الإنتاج (كجم)" }],
    ariaLabel: "إنتاج التمور الشهري بالكيلوجرام",
    height: 280,
  },
};
export default meta;
type S = StoryObj<typeof BarChart>;

export const Single: S = {};
export const Grouped: S = {
  args: {
    series: [
      { dataKey: "إنتاج", name: "الإنتاج" },
      { dataKey: "تالف", name: "التالف" },
    ],
    showLegend: true,
  },
};
export const Stacked: S = {
  args: {
    series: [
      { dataKey: "إنتاج", name: "الإنتاج" },
      { dataKey: "تالف", name: "التالف" },
    ],
    stacked: true,
    showLegend: true,
  },
};
export const Gallery: S = {
  render: (args) => (
    <div style={{ display: "grid", gap: 24 }}>
      <BarChart {...args} />
      <BarChart {...args} series={[{ dataKey: "إنتاج", name: "الإنتاج" }, { dataKey: "تالف", name: "التالف" }]} stacked showLegend />
    </div>
  ),
};
