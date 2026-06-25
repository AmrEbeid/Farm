import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { RoleSwitcher, type RoleOption } from "./RoleSwitcher";

const options: RoleOption[] = [
  { id: "owner", label: "المالك" },
  { id: "accountant", label: "المحاسب" },
  { id: "worker", label: "العامل" },
];

const meta: Meta<typeof RoleSwitcher> = {
  title: "Navigation/RoleSwitcher",
  component: RoleSwitcher,
  args: { options, value: "owner", label: "تبديل الدور" },
};
export default meta;
type S = StoryObj<typeof RoleSwitcher>;

function Controlled(props: React.ComponentProps<typeof RoleSwitcher>) {
  const [v, setV] = React.useState(props.value);
  return <RoleSwitcher {...props} value={v} onRoleChange={setV} />;
}

export const Default: S = { render: (args) => <Controlled {...args} /> };
export const AsWorker: S = { render: (args) => <Controlled {...args} value="worker" /> };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      <Controlled options={options} value="owner" label="دور ١" onRoleChange={() => {}} />
      <Controlled options={options} value="accountant" label="دور ٢" onRoleChange={() => {}} />
    </div>
  ),
};
