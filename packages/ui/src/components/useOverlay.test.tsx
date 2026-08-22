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

function NestedHarness({ onParentClose, onChildClose }: { onParentClose: () => void; onChildClose: () => void }) {
  const [parentOpen, setParentOpen] = React.useState(false);
  const [childOpen, setChildOpen] = React.useState(false);
  const parent = useOverlay({ open: parentOpen, onClose: () => { onParentClose(); setParentOpen(false); } });
  const child = useOverlay({ open: childOpen, onClose: () => { onChildClose(); setChildOpen(false); } });
  return (
    <div>
      <button onClick={() => setParentOpen(true)}>افتح الأصل</button>
      {parentOpen && (
        <div ref={parent.ref} role="dialog" aria-modal="true" aria-label="الأصل" tabIndex={-1}>
          <button onClick={() => setChildOpen(true)}>افتح الفرعي</button>
        </div>
      )}
      {childOpen && (
        <div ref={child.ref} role="dialog" aria-modal="true" aria-label="الفرعي" tabIndex={-1}>
          <button>إجراء فرعي</button>
        </div>
      )}
    </div>
  );
}

function OutOfOrderHarness() {
  const [parentActive, setParentActive] = React.useState(false);
  const [childOpen, setChildOpen] = React.useState(false);
  const parent = useOverlay({ open: parentActive, onClose: () => setParentActive(false) });
  const child = useOverlay({ open: childOpen, onClose: () => setChildOpen(false) });
  return (
    <div>
      <button onClick={() => setParentActive(true)}>افتح الدرج</button>
      <div ref={parent.ref} tabIndex={-1}>
        <button onClick={() => setChildOpen(true)}>افتح النافذة</button>
      </div>
      {childOpen && (
        <div ref={child.ref} role="dialog" aria-modal="true" aria-label="النافذة" tabIndex={-1}>
          <button onClick={() => setParentActive(false)}>حوّل لسطح المكتب</button>
          <button onClick={() => setChildOpen(false)}>أغلق النافذة</button>
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

  it("lets only the topmost nested overlay handle Escape", async () => {
    const user = userEvent.setup();
    const onParentClose = vi.fn();
    const onChildClose = vi.fn();
    render(<NestedHarness onParentClose={onParentClose} onChildClose={onChildClose} />);
    await user.click(screen.getByText("افتح الأصل"));
    await user.click(screen.getByText("افتح الفرعي"));
    await user.keyboard("{Escape}");
    expect(onChildClose).toHaveBeenCalledTimes(1);
    expect(onParentClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "الأصل" })).toBeInTheDocument();
  });

  it("keeps scroll locked and focus in place when a lower overlay deactivates first", async () => {
    const user = userEvent.setup();
    render(<OutOfOrderHarness />);
    await user.click(screen.getByText("افتح الدرج"));
    await user.click(screen.getByText("افتح النافذة"));
    const resize = screen.getByText("حوّل لسطح المكتب");
    await user.click(resize);
    expect(document.body.style.overflow).toBe("hidden");
    expect(resize).toHaveFocus();
    await user.click(screen.getByText("أغلق النافذة"));
    expect(document.body.style.overflow).toBe("");
  });
});
