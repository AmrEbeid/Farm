import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tooltip } from "./Tooltip";
import { Button } from "./Button";

const meta: Meta<typeof Tooltip> = {
  title: "Data display/Tooltip",
  component: Tooltip,
  args: { label: "الكمية المتاحة في المخزن", placement: "top" },
  argTypes: { placement: { control: "inline-radio", options: ["top", "bottom", "start", "end"] } },
};
export default meta;
type S = StoryObj<typeof Tooltip>;

export const Default: S = {
  render: (args) => (
    <div style={{ padding: 60 }}>
      <Tooltip {...args}><Button variant="ghost">المخزون</Button></Tooltip>
    </div>
  ),
};
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 48, padding: 60, flexWrap: "wrap" }}>
      <Tooltip label="أعلى" placement="top"><Button variant="ghost">أعلى</Button></Tooltip>
      <Tooltip label="أسفل" placement="bottom"><Button variant="ghost">أسفل</Button></Tooltip>
      <Tooltip label="البداية" placement="start"><Button variant="ghost">بداية</Button></Tooltip>
      <Tooltip label="النهاية" placement="end"><Button variant="ghost">نهاية</Button></Tooltip>
    </div>
  ),
};
