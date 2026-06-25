import { it, expect, describe, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ThemeProvider } from "../theme";
import { Drawer } from "./Drawer";

function Demo({ side, onClose = () => {} }: { side?: "start" | "end"; onClose?: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <ThemeProvider>
      <button onClick={() => setOpen(true)}>افتح اللوحة</button>
      <Drawer
        open={open}
        onClose={() => { onClose(); setOpen(false); }}
        side={side}
        title="التنبيهات"
        closeLabel="إغلاق"
      >
        <button>عنصر</button>
      </Drawer>
    </ThemeProvider>
  );
}

describe("Drawer", () => {
  it("is closed by default and opens as a labelled dialog", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByText("افتح اللوحة"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("التنبيهات");
  });

  it("reflects the inline side via a modifier class (defaults to end)", async () => {
    const user = userEvent.setup();
    render(<Demo side="start" />);
    await user.click(screen.getByText("افتح اللوحة"));
    expect(screen.getByRole("dialog")).toHaveClass("fos-drawer--start");
  });

  it("closes on Esc and backdrop, returning focus to the trigger", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    const trigger = screen.getByText("افتح اللوحة");
    trigger.focus();
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.click(document.querySelector(".fos-drawer__backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("has no axe violations when open", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByText("افتح اللوحة"));
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it("falls back to a 'Close' accessible name when closeLabel is an empty string", () => {
    render(
      <ThemeProvider>
        <Drawer open onClose={() => {}} title="ت" closeLabel="">x</Drawer>
      </ThemeProvider>
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
