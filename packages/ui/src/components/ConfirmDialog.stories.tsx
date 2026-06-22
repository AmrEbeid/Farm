import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "./Button";

const meta: Meta<typeof ConfirmDialog> = {
  title: "Feedback/ConfirmDialog",
  component: ConfirmDialog,
  argTypes: { tone: { control: "inline-radio", options: ["primary", "danger"] } },
};
export default meta;
type S = StoryObj<typeof ConfirmDialog>;

function Template(args: Omit<React.ComponentProps<typeof ConfirmDialog>, "open" | "onClose" | "onConfirm">) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant={args.tone === "danger" ? "danger" : "primary"} onClick={() => setOpen(true)}>
        {args.confirmLabel}
      </Button>
      <ConfirmDialog {...args} open={open} onClose={() => setOpen(false)} onConfirm={() => setOpen(false)} />
    </>
  );
}

export const Default: S = {
  args: { title: "تأكيد الاعتماد", description: "سيتم اعتماد الطلب نهائيًا.", confirmLabel: "اعتماد", cancelLabel: "إلغاء", closeLabel: "إغلاق", tone: "primary" },
  render: Template,
};
export const Destructive: S = {
  args: { title: "حذف السجل", description: "لا يمكن التراجع عن هذا الإجراء.", confirmLabel: "حذف", cancelLabel: "إلغاء", closeLabel: "إغلاق", tone: "danger" },
  render: Template,
};

export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 10 }}>
      <Template title="اعتماد" description="اعتماد الطلب؟" confirmLabel="اعتماد" cancelLabel="إلغاء" closeLabel="إغلاق" tone="primary" />
      <Template title="حذف" description="حذف السجل؟" confirmLabel="حذف" cancelLabel="إلغاء" closeLabel="إغلاق" tone="danger" />
    </div>
  ),
};
