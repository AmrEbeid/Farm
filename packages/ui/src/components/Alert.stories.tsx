import type { Meta, StoryObj } from "@storybook/react-vite";
import { Alert } from "./Alert";

const meta: Meta<typeof Alert> = {
  title: "Feedback/Alert",
  component: Alert,
  args: { tone: "warning", title: "مخزون منخفض — كرتون", description: "420 متبقٍ (حد الطلب 500)", icon: "📦" },
};
export default meta;
type S = StoryObj<typeof Alert>;

export const Danger: S = { args: { tone: "danger", title: "ارتفاع صيد سوسة النخيل", description: "الخطارة: 14 حشرة/مصيدة (المعتاد 3)", icon: "🪲" } };
export const Warning: S = {};
export const Info: S = { args: { tone: "info", title: "ري الـ22 فدان مكتمل", description: "6/6 دورات", icon: "💧" } };
export const Ok: S = { args: { tone: "ok", title: "تحليل المتبقيات (MRL) ناجح", description: "مطابق Codex/EU", icon: "🧪" } };
export const Feed: S = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, maxWidth: 420 }}>
      <Alert tone="danger" title="سوسة — الخطارة" description="منذ ساعة" icon="🪲" />
      <Alert tone="warning" title="3 أذونات بانتظار موافقتك" description="87,500 ج.م" icon="🧾" />
      <Alert tone="info" title="ري التأسيس جارٍ" icon="💧" />
    </div>
  ),
};
