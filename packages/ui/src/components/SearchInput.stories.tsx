import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { SearchInput } from "./SearchInput";

const meta: Meta<typeof SearchInput> = {
  title: "Navigation/SearchInput",
  component: SearchInput,
  args: { label: "بحث في المزرعة", icon: "🔍", placeholder: "ابحث عن نخلة، صنف، أو طلب…" },
};
export default meta;
type S = StoryObj<typeof SearchInput>;

function Controlled(props: React.ComponentProps<typeof SearchInput>) {
  const [v, setV] = React.useState(props.value ?? "");
  return <SearchInput {...props} value={v} onValueChange={setV} />;
}

export const Default: S = { render: (args) => <Controlled {...args} /> };
export const Prefilled: S = { render: (args) => <Controlled {...args} value="نخيل المجدول" /> };
export const NoIcon: S = { render: (args) => <Controlled {...args} icon={undefined} /> };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 360 }}>
      <Controlled label="بحث" icon="🔍" placeholder="بحث سريع" value="" onValueChange={() => {}} />
      <Controlled label="بحث المخزون" icon="📦" placeholder="ابحث في المخزون" value="سماد" onValueChange={() => {}} />
    </div>
  ),
};
