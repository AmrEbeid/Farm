import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { Switch } from "./Switch";

const meta: Meta<typeof Switch> = {
  title: "Forms/Switch",
  component: Switch,
  args: { label: "الإشعارات" },
};
export default meta;
type S = StoryObj<typeof Switch>;

export const Off: S = { args: { label: "الإشعارات" } };
export const On: S = { args: { label: "الوضع الليلي", defaultChecked: true } };
export const Disabled: S = { args: { label: "غير متاح", disabled: true } };

export const Controlled: S = {
  render: () => {
    const [on, setOn] = React.useState(true);
    return (
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Switch label="مزامنة" checked={on} onCheckedChange={setOn} />
        <span style={{ fontSize: 13 }}>{on ? "مفعّل" : "متوقف"}</span>
      </label>
    );
  },
};

export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <Switch label="إيقاف" />
      <Switch label="تشغيل" defaultChecked />
      <Switch label="معطل" disabled />
    </div>
  ),
};
