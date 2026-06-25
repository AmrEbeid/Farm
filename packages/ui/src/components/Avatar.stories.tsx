import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "./Avatar";

const meta: Meta<typeof Avatar> = {
  title: "Data display/Avatar",
  component: Avatar,
  args: { name: "عمر عبيد", size: "md" },
  argTypes: { size: { control: "inline-radio", options: ["sm", "md", "lg"] } },
};
export default meta;
type S = StoryObj<typeof Avatar>;

export const Initials: S = {};
export const Image: S = { args: { src: "https://i.pravatar.cc/96?img=12" } };
export const Large: S = { args: { size: "lg", name: "فاطمة حسن" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Avatar name="عمر عبيد" size="sm" />
      <Avatar name="فاطمة حسن" size="md" />
      <Avatar name="محمود علي" size="lg" />
      <Avatar name="عمر عبيد" size="lg" src="https://i.pravatar.cc/96?img=12" />
    </div>
  ),
};
