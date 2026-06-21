import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Combobox } from "./Combobox";

const options = [
  { value: "khalas", label: "خلاص" },
  { value: "barhi", label: "برحي" },
  { value: "sukkari", label: "سكري" },
  { value: "ajwa", label: "عجوة" },
  { value: "medjool", label: "مجدول" },
];

const meta: Meta<typeof Combobox> = {
  title: "Forms/Combobox",
  component: Combobox,
  args: { options, placeholder: "ابحث عن الصنف…" },
};
export default meta;
type S = StoryObj<typeof Combobox>;

export const Default: S = {
  render: (args) => {
    const [v, setV] = React.useState("");
    return (
      <div style={{ maxWidth: 280 }}>
        <Combobox {...args} aria-label="الصنف" value={v} onValueChange={setV} />
      </div>
    );
  },
};

export const Invalid: S = {
  render: (args) => {
    const [v, setV] = React.useState("");
    return <div style={{ maxWidth: 280 }}><Combobox {...args} aria-label="الصنف" invalid value={v} onValueChange={setV} /></div>;
  },
};

export const Gallery: S = {
  render: () => {
    const [a, setA] = React.useState("");
    const [b, setB] = React.useState("خلاص");
    return (
      <div style={{ display: "grid", gap: 14, maxWidth: 280 }}>
        <Combobox aria-label="فارغ" options={options} value={a} onValueChange={setA} placeholder="ابحث…" />
        <Combobox aria-label="محدد" options={options} value={b} onValueChange={setB} />
      </div>
    );
  },
};
