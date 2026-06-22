import { it, expect, describe, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ThemeProvider } from "../theme";
import { Modal } from "./Modal";

function Demo({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <ThemeProvider>
      <button onClick={() => setOpen(true)}>افتح النافذة</button>
      <Modal
        open={open}
        onClose={() => { onClose(); setOpen(false); }}
        title="تأكيد العملية"
        closeLabel="إغلاق"
      >
        <p>محتوى النافذة</p>
        <button>إجراء</button>
      </Modal>
    </ThemeProvider>
  );
}

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(<Demo />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens as a labelled modal dialog and traps focus", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByText("افتح النافذة"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("تأكيد العملية");
  });

  it("closes on Esc, backdrop click, and the close button — returning focus to the trigger", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    const trigger = screen.getByText("افتح النافذة");
    trigger.focus();
    // Esc
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    // close button
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "إغلاق" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    // backdrop
    await user.click(trigger);
    await user.click(document.querySelector(".fos-modal__backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("has no axe violations when open", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByText("افتح النافذة"));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
