import type { Meta, StoryObj } from "@storybook/react";
import { Skeleton } from "./Skeleton";

const meta: Meta<typeof Skeleton> = {
  title: "Data display/Skeleton",
  component: Skeleton,
  argTypes: { shape: { control: "inline-radio", options: ["text", "rect", "circle"] } },
};
export default meta;
type S = StoryObj<typeof Skeleton>;

export const Text: S = { args: { shape: "text", width: 240 } };
export const Paragraph: S = { args: { shape: "text", lines: 3 } };
export const Rect: S = { args: { shape: "rect", width: 280, height: 120 } };
export const Circle: S = { args: { shape: "circle", width: 48, height: 48 } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center", maxWidth: 360, flexWrap: "wrap" }}>
      <Skeleton shape="circle" width={48} height={48} />
      <div style={{ flex: 1, minWidth: 200, display: "grid", gap: 8 }}>
        <Skeleton shape="text" width="60%" />
        <Skeleton shape="text" lines={2} />
      </div>
      <Skeleton shape="rect" width={320} height={120} />
    </div>
  ),
};
