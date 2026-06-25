import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { ToastProvider, useToast } from "./Toast";
import { Button } from "./Button";

const meta: Meta = { title: "Feedback/Toast" };
export default meta;
type S = StoryObj;

function Buttons() {
  const t = useToast();
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <Button onClick={() => t.ok("تم حفظ السجل")}>نجاح</Button>
      <Button variant="ghost" onClick={() => t.info("جارٍ المزامنة")}>معلومة</Button>
      <Button variant="ghost" onClick={() => t.warning("مخزون منخفض", { description: "الديزل أقل من 20%" })}>تحذير</Button>
      <Button variant="danger" onClick={() => t.danger("فشل الحفظ", { duration: 0 })}>خطأ ثابت</Button>
    </div>
  );
}

export const Playground: S = {
  render: () => (
    <ToastProvider>
      <Buttons />
    </ToastProvider>
  ),
};

export const Gallery: S = {
  render: () => {
    function Auto() {
      const t = useToast();
      React.useEffect(() => {
        t.ok("تم الاعتماد");
        t.warning("مخزون منخفض", { description: "أعد الطلب قريبًا" });
        t.danger("نقص حرج", { duration: 0 });
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }
    return (
      <ToastProvider>
        <Auto />
      </ToastProvider>
    );
  },
};
