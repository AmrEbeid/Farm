import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileTimeline, type TimelineEvent } from "./FileTimeline";

const events: TimelineEvent[] = [
  { id: "e1", kind: "operation", title: "ري الكتلة أ", time: "١٢ يونيو ٠٩:٣٠", glyph: "💧" },
  { id: "e2", kind: "issue", title: "إصابة بسوسة النخيل", time: "١٣ يونيو ١١:٠٠", description: "خط ٢ موضع ٤", glyph: "⚠️" },
  { id: "e3", kind: "inspection", title: "فحص دوري", time: "١٤ يونيو", glyph: "🔍" },
  { id: "e4", kind: "expense", title: "شراء سماد عضوي", time: "١٥ يونيو", description: "١٢٠٠ ج.م", glyph: "💰" },
  { id: "e5", kind: "photo", title: "توثيق الثمار", time: "١٦ يونيو", glyph: "📷" },
];

const meta: Meta<typeof FileTimeline> = {
  title: "Domain/FileTimeline",
  component: FileTimeline,
  args: { events, ariaLabel: "سجل أحداث المزرعة" },
};
export default meta;
type S = StoryObj<typeof FileTimeline>;

export const Default: S = {};
export const Gallery: S = {
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <FileTimeline ariaLabel="سجل مختصر" events={events.slice(0, 3)} />
    </div>
  ),
};
