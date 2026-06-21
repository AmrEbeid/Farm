import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { RadioGroup } from "./Radio";

const options = [
  { value: "owner", label: "مالك" },
  { value: "manager", label: "مدير" },
  { value: "worker", label: "عامل" },
];

const meta: Meta<typeof RadioGroup> = {
  title: "Forms/RadioGroup",
  component: RadioGroup,
  args: { name: "role", legend: "الدور", options },
};
export default meta;
type S = StoryObj<typeof RadioGroup>;

export const Default: S = {
  render: (args) => {
    const [v, setV] = React.useState("owner");
    return <RadioGroup {...args} value={v} onValueChange={setV} />;
  },
};

export const Disabled: S = { args: { defaultValue: "manager", disabled: true } };

export const Gallery: S = {
  render: () => {
    const [v, setV] = React.useState("worker");
    return (
      <div style={{ display: "grid", gap: 20 }}>
        <RadioGroup name="r1" legend="الدور" options={options} value={v} onValueChange={setV} />
        <RadioGroup name="r2" legend="معطل" options={options} defaultValue="owner" disabled />
      </div>
    );
  },
};
