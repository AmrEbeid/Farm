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

// All marker tones, including `danger` (rejections/failures) and the
// neutral `default`, which the realistic Default story above never exercises.
const allTones: TimelineItem[] = [
  { id: "t1", title: "حدث افتراضي", time: "٠٨:٠٠", icon: "•", description: "بدون لون (default)" },
  { id: "t2", title: "معلومة", time: "٠٩:٠٠", tone: "info", icon: "i" },
  { id: "t3", title: "نجاح", time: "١٠:٠٠", tone: "success", icon: "✓" },
  { id: "t4", title: "تحذير", time: "١١:٠٠", tone: "warning", icon: "!" },
  { id: "t5", title: "خطأ", time: "١٢:٠٠", tone: "danger", icon: "✕", description: "رُفض الطلب" },
];

export const Gallery: S = {
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <Timeline items={allTones} aria-label="نغمات السجل" />
    </div>
  ),
};
