import { it, expect, describe, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ThemeProvider } from "../theme";
import { ConfirmDialog } from "./ConfirmDialog";

function Demo({ onConfirm = () => {}, tone }: { onConfirm?: () => void; tone?: "primary" | "danger" }) {
  const [open, setOpen] = React.useState(false);
  return (
    <ThemeProvider>
      <button onClick={() => setOpen(true)}>احذف</button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => { onConfirm(); setOpen(false); }}
        title="حذف السجل"
        description="لا يمكن التراجع عن هذا الإجراء."
        confirmLabel="حذف"
        cancelLabel="إلغاء"
        closeLabel="إغلاق"
        tone={tone}
      />
    </ThemeProvider>
  );
}

describe("ConfirmDialog", () => {
  it("renders a labelled dialog with confirm + cancel actions", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByText("احذف"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("حذف السجل");
    expect(screen.getByRole("button", { name: "حذف" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إلغاء" })).toBeInTheDocument();
  });

  it("fires onConfirm on the confirm button and onClose on cancel", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Demo onConfirm={onConfirm} />);
    await user.click(screen.getByText("احذف"));
    await user.click(screen.getByRole("button", { name: "حذف" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText("احذف"));
    await user.click(screen.getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses the danger button variant for a destructive tone", async () => {
    const user = userEvent.setup();
    render(<Demo tone="danger" />);
    await user.click(screen.getByText("احذف"));
    expect(screen.getByRole("button", { name: "حذف" })).toHaveClass("fos-btn--danger");
  });

  it("has no axe violations when open", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByText("احذف"));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
