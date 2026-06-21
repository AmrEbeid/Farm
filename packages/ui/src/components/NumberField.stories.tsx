import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { NumberField } from "./NumberField";

const meta: Meta<typeof NumberField> = {
  title: "Forms/NumberField",
  component: NumberField,
  args: { decrementLabel: "إنقاص", incrementLabel: "زيادة", step: 1, min: 0, max: 20 },
};
export default meta;
type S = StoryObj<typeof NumberField>;

export const Uncontrolled: S = { args: { "aria-label": "عدد النخلات", defaultValue: 3 } };

export const Controlled: S = {
  render: (args) => {
    const [v, setV] = React.useState<number | "">(5);
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <NumberField {...args} aria-label="الكمية" value={v} onValueChange={setV} />
        <span style={{ fontSize: 12 }}>القيمة: {String(v)}</span>
      </div>
    );
  },
};

export const Invalid: S = { args: { "aria-label": "كمية", invalid: true, defaultValue: 0 } };
export const Disabled: S = { args: { "aria-label": "كمية", disabled: true, defaultValue: 2 } };

export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <NumberField aria-label="أ" defaultValue={1} decrementLabel="إنقاص" incrementLabel="زيادة" />
      <NumberField aria-label="ب" invalid defaultValue={0} decrementLabel="إنقاص" incrementLabel="زيادة" />
      <NumberField aria-label="ج" disabled defaultValue={2} decrementLabel="إنقاص" incrementLabel="زيادة" />
    </div>
  ),
};
