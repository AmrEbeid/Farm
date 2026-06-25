import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyState } from "./EmptyState";
import { Button } from "./Button";

const meta: Meta<typeof EmptyState> = {
  title: "Data display/EmptyState",
  component: EmptyState,
  args: { title: "لا توجد طلبات صرف", description: "ابدأ بإنشاء أول طلب صرف للمخزن" },
};
export default meta;
type S = StoryObj<typeof EmptyState>;

export const Default: S = {};
export const WithIconAndAction: S = {
  args: {
    icon: "🌴",
    title: "لا توجد أشجار مسجلة",
    description: "أضف أول قطاع نخيل لتبدأ متابعة الإنتاج",
    action: <Button>إضافة قطاع</Button>,
  },
};
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 24, maxWidth: 420 }}>
      <EmptyState title="لا توجد طلبات" description="القائمة فارغة حاليًا" />
      <EmptyState icon="🌴" title="لا توجد أشجار" description="أضف أول قطاع نخيل" action={<Button>إضافة قطاع</Button>} />
    </div>
  ),
};
