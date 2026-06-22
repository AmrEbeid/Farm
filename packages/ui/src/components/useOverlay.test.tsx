import { it, expect, describe, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useOverlay } from "./useOverlay";

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = React.useState(false);
  const close = () => { onClose(); setOpen(false); };
  const { ref } = useOverlay({ open, onClose: close });
  return (
    <div>
      <button onClick={() => setOpen(true)}>افتح</button>
      {open && (
        <div ref={ref} role="dialog" aria-modal="true">
          <button>الأول</button>
          <button>الأخير</button>
        </div>
      )}
    </div>
  );
}

describe("useOverlay", () => {
  it("moves focus inside on open and returns it to the trigger on close", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const trigger = screen.getByText("افتح");
    trigger.focus();
    await user.click(trigger);
    expect(document.activeElement).toBe(screen.getByText("الأول"));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it("traps Tab within the panel (wraps last → first)", async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => {}} />);
    await user.click(screen.getByText("افتح"));
    const first = screen.getByText("الأول");
    const last = screen.getByText("الأخير");
    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);
    first.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });

  it("locks body scroll while open", async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => {}} />);
    expect(document.body.style.overflow).toBe("");
    await user.click(screen.getByText("افتح"));
    expect(document.body.style.overflow).toBe("hidden");
  });
});
