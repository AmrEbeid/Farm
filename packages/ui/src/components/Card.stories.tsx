import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "./Card";
import { Tag } from "./Tag";

const meta: Meta<typeof Card> = {
  title: "Layout/Card",
  component: Card,
  args: { title: "ربحية القطاعات", subtitle: "بعد توزيع التكاليف" },
};
export default meta;
type S = StoryObj<typeof Card>;

export const Basic: S = {
  args: {
    title: "🏞️ ربحية القطاعات",
    subtitle: "موسم 2025 — بيانات فعلية",
    children: "صافي الحصوة 740 ألف ج.م · الأعلى بين القطاعات.",
  },
};
export const WithContent: S = {
  render: () => (
    <Card title="🧾 إذن صرف V-2026-091" subtitle="بانتظار موافقة المالك" style={{ maxWidth: 360 }}>
      <p style={{ margin: "0 0 10px", fontSize: 13 }}>سلفات بوتاسيوم — الحصوة · 42,000 ج.م</p>
      <Tag tone="warning">بانتظار</Tag>
    </Card>
  ),
};
