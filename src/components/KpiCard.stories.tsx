import type { Meta, StoryObj } from "@storybook/react";
import { KpiCard } from "./KpiCard";

const meta: Meta<typeof KpiCard> = {
  title: "Data Display/KpiCard",
  component: KpiCard,
  args: { label: "صافي 2025", value: "2.71", unit: "م ج.م", icon: "💵", delta: "▲ من 1.92م في 2024", deltaDirection: "up" },
};
export default meta;
type S = StoryObj<typeof KpiCard>;

export const Up: S = {};
export const Down: S = { args: { label: "مصروفات 2025", value: "4.97", unit: "م ج.م", icon: "📤", delta: "▲ 80% توسّع", deltaDirection: "down" } };
export const Count: S = { args: { label: "نخيل برحي", value: "4,380", unit: undefined, icon: "🌴", delta: "+ 299 ذكور · 28 حوش", deltaDirection: "none" } };
export const Row: S = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
      <KpiCard label="مبيعات 2025" value="7.68" unit="م ج.م" icon="📥" delta="▲ 64%" deltaDirection="up" />
      <KpiCard label="مصروفات" value="4.97" unit="م ج.م" icon="📤" delta="▲ 80%" deltaDirection="down" />
      <KpiCard label="صافي" value="2.71" unit="م ج.م" icon="💵" delta="▲" deltaDirection="up" />
      <KpiCard label="أذونات معلّقة" value="3" icon="🧾" delta="بانتظار موافقتك" />
    </div>
  ),
};
