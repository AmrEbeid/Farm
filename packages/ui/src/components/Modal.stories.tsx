import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

const meta: Meta<typeof Modal> = {
  title: "Feedback/Modal",
  component: Modal,
  argTypes: { size: { control: "inline-radio", options: ["sm", "md", "lg"] } },
};
export default meta;
type S = StoryObj<typeof Modal>;

function Template(args: React.ComponentProps<typeof Modal>) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>افتح النافذة</Button>
      <Modal
        {...args}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={() => setOpen(false)}>تأكيد</Button>
          </>
        }
      >
        هل أنت متأكد من تنفيذ هذه العملية على المزرعة؟
      </Modal>
    </>
  );
}

export const Default: S = { args: { title: "تأكيد العملية", closeLabel: "إغلاق", size: "md" }, render: Template };
export const Large: S = { args: { title: "تفاصيل النخلة", closeLabel: "إغلاق", size: "lg" }, render: Template };
export const NoTitle: S = { args: { closeLabel: "إغلاق", size: "sm" }, render: Template };

export const Gallery: S = {
  render: () => {
    const [which, setWhich] = React.useState<"sm" | "md" | "lg" | null>(null);
    return (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button onClick={() => setWhich("sm")}>صغيرة</Button>
        <Button onClick={() => setWhich("md")}>متوسطة</Button>
        <Button onClick={() => setWhich("lg")}>كبيرة</Button>
        <Modal open={which !== null} onClose={() => setWhich(null)} title="نافذة" closeLabel="إغلاق" size={which ?? "md"}>
          الحجم: {which}
        </Modal>
      </div>
    );
  },
};
