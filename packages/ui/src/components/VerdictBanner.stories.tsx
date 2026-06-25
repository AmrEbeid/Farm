import type { Meta, StoryObj } from "@storybook/react-vite";
import { VerdictBanner } from "./VerdictBanner";

const meta: Meta<typeof VerdictBanner> = {
  title: "Farm OS/VerdictBanner",
  component: VerdictBanner,
  args: { tone: "danger", children: "نقص حرج — الغطاء 4 أيام < مهلة التوريد 5 أيام. اطلب الآن." },
  argTypes: { tone: { control: "inline-radio", options: ["ok", "warning", "danger"] } },
  decorators: [(S) => <div style={{ maxWidth: 460 }}><S /></div>],
};
export default meta;
type S = StoryObj<typeof VerdictBanner>;

export const Shortage: S = {};
export const ReorderSoon: S = { args: { tone: "warning", children: "تحت نقطة إعادة الطلب (574 كجم). جهّز أمر شراء." } };
export const Covered: S = { args: { tone: "ok", children: "مغطّى — الغطاء 12 يوم يكفي." } };
