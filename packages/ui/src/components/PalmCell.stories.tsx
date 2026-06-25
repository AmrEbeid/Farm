import type { Meta, StoryObj } from "@storybook/react-vite";
import { PalmCell } from "./PalmCell";

const meta: Meta<typeof PalmCell> = {
  title: "Domain/PalmCell",
  component: PalmCell,
  args: { status: "healthy", ariaLabel: "نخلة سليمة", glyph: "🌴" },
  argTypes: {
    status: { control: "select", options: ["healthy", "watch", "sick", "dead", "removed", "male"] },
  },
};
export default meta;
type S = StoryObj<typeof PalmCell>;

export const Healthy: S = { args: { status: "healthy", ariaLabel: "نخلة سليمة" } };
export const Sick: S = { args: { status: "sick", ariaLabel: "نخلة مريضة" } };
export const Selected: S = { args: { status: "healthy", ariaLabel: "نخلة محددة", selected: true } };

export const Grid: S = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 32px)", gap: 4 }}>
      {(["healthy", "healthy", "watch", "sick", "dead", "male"] as const).map((s, i) => (
        <PalmCell key={i} status={s} ariaLabel={`نخلة ${i + 1} — ${s}`} />
      ))}
    </div>
  ),
};
