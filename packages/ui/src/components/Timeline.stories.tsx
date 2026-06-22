import type { Meta, StoryObj } from "@storybook/react";
import { Timeline, type TimelineItem } from "./Timeline";

const items: TimelineItem[] = [
  { id: "1", title: "تم إنشاء الخطة", time: "٠٩:٠٠", tone: "info", icon: "📝" },
  { id: "2", title: "اعتماد المالك", time: "١٠:٣٠", tone: "success", icon: "✓", description: "اعتمد عمر الطلب بالكامل" },
  { id: "3", title: "تحذير مخزون", time: "١٠:٤٥", tone: "warning", icon: "!", description: "انخفاض في صنف السكري" },
  { id: "4", title: "حُفظ المستند النهائي", time: "١١:١٥", icon: "📁" },
];

const meta: Meta<typeof Timeline> = {
  title: "Data display/Timeline",
  component: Timeline,
  args: { items, "aria-label": "سجل العمليات" },
};
export default meta;
type S = StoryObj<typeof Timeline>;

export const Default: S = {};
export const Gallery: S = {
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <Timeline items={items} aria-label="سجل العمليات" />
    </div>
  ),
};
