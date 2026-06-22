import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Drawer } from "./Drawer";
import { Button } from "./Button";

const meta: Meta<typeof Drawer> = {
  title: "Feedback/Drawer",
  component: Drawer,
  argTypes: { side: { control: "inline-radio", options: ["start", "end"] } },
};
export default meta;
type S = StoryObj<typeof Drawer>;

function Template(args: React.ComponentProps<typeof Drawer>) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>افتح اللوحة</Button>
      <Drawer {...args} open={open} onClose={() => setOpen(false)}>
        <p>قائمة التنبيهات الأخيرة للمزرعة.</p>
        <Button variant="ghost" onClick={() => setOpen(false)}>إغلاق</Button>
      </Drawer>
    </>
  );
}

export const FromEnd: S = { args: { side: "end", title: "التنبيهات", closeLabel: "إغلاق" }, render: Template };
export const FromStart: S = { args: { side: "start", title: "التصفية", closeLabel: "إغلاق" }, render: Template };

export const Gallery: S = {
  render: () => {
    const [side, setSide] = React.useState<"start" | "end" | null>(null);
    return (
      <div style={{ display: "flex", gap: 10 }}>
        <Button onClick={() => setSide("start")}>من البداية</Button>
        <Button onClick={() => setSide("end")}>من النهاية</Button>
        <Drawer open={side !== null} onClose={() => setSide(null)} side={side ?? "end"} title="لوحة" closeLabel="إغلاق">
          الجهة: {side}
        </Drawer>
      </div>
    );
  },
};
