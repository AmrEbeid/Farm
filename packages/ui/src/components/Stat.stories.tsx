import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stat } from "./Stat";

const meta: Meta<typeof Stat> = {
  title: "Data display/Stat",
  component: Stat,
  args: { label: "إجمالي الإنتاج", value: "12٬480", unit: "كجم" },
  argTypes: {
    trend: { control: "inline-radio", options: ["up", "down", "flat"] },
  },
};
export default meta;
type S = StoryObj<typeof Stat>;

export const Default: S = {};
export const Up: S = { args: { label: "صافي الربح", value: "2.71", unit: "م ج.م", trend: "up", change: "+٨٪" } };
export const Down: S = { args: { label: "نسبة الفاقد", value: "٦٫٤", unit: "٪", trend: "down", change: "-٢٪" } };
export const WithHelp: S = { args: { label: "متوسط العائد", value: "١٬٢٠٠", unit: "ج.م/شجرة", help: "آخر ٣٠ يومًا" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
      <Stat label="إجمالي الإنتاج" value="12٬480" unit="كجم" />
      <Stat label="صافي الربح" value="2.71" unit="م ج.م" trend="up" change="+٨٪" />
      <Stat label="نسبة الفاقد" value="٦٫٤" unit="٪" trend="down" change="-٢٪" />
      <Stat label="متوسط العائد" value="١٬٢٠٠" unit="ج.م/شجرة" help="آخر ٣٠ يومًا" />
    </div>
  ),
};
