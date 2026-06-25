import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tabs } from "./Tabs";

const meta: Meta<typeof Tabs> = { title: "Navigation/Tabs", component: Tabs };
export default meta;
type S = StoryObj<typeof Tabs>;

export const Default: S = {
  render: () => {
    const [v, setV] = React.useState("pl");
    return (
      <Tabs
        ariaLabel="أقسام الحسابات"
        value={v}
        onChange={setV}
        items={[
          { id: "pl", label: "الأرباح" },
          { id: "exp", label: "المصروفات" },
          { id: "crop", label: "حسب المحصول" },
          { id: "bud", label: "الميزانيات" },
        ]}
      />
    );
  },
};
