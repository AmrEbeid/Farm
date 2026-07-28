import { it, expect, describe, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { axe } from "jest-axe";
import { ThemeProvider } from "../theme";
import { ToastProvider, useToast } from "./Toast";

function Trigger() {
  const t = useToast();
  return (
    <>
      <button onClick={() => t.ok("تم الحفظ")}>نجاح</button>
      <button onClick={() => t.ok("إشعار ثانٍ")}>ثاني</button>
      <button onClick={() => t.danger("فشل الحفظ", { duration: 0 })}>خطأ ثابت</button>
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    </ThemeProvider>
  );
}

describe("useToast / Toaster", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("renders a polite live region and shows a toast on demand", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("نجاح"));
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("تم الحفظ")).toBeInTheDocument();
  });

  it("auto-dismisses after the duration", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("نجاح"));
    expect(screen.getByText("تم الحفظ")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText("تم الحفظ")).not.toBeInTheDocument();
  });

  // MEDIUM-3: adding a second toast must NOT reset the first toast's countdown.
  it("does not restart a live toast's timer when another toast is added", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("نجاح"));          // toast 1 starts (duration 4500)
    expect(screen.getByText("تم الحفظ")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3000); });        // toast 1 at 3000/4500
    await user.click(screen.getByText("ثاني"));          // add toast 2 mid-flight
    act(() => { vi.advanceTimersByTime(2000); });        // total 5000 > 4500 for toast 1
    expect(screen.queryByText("تم الحفظ")).not.toBeInTheDocument(); // toast 1 dismissed on time
    expect(screen.getByText("إشعار ثانٍ")).toBeInTheDocument();     // toast 2 (2000ms) still alive
  });

  it("keeps a sticky (duration<=0) toast on screen", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("خطأ ثابت"));
    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.getByText("فشل الحفظ")).toBeInTheDocument();
  });

  it("throws when useToast is used outside a provider", () => {
    function Bad() { useToast(); return null; }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bad />)).toThrow();
    spy.mockRestore();
  });

  it("has no axe violations with a visible toast", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("نجاح"));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

// React #418: the Toaster used to createPortal into document.body on the FIRST client render,
// mutating the DOM while the root was still hydrating. Records whether the portal already
// existed during the hydration commit (layout phase runs right after DOM mutations).
function PortalProbe({ seen }: { seen: boolean[] }) {
  React.useLayoutEffect(() => {
    seen.push(document.body.querySelector(".fos-toaster") != null);
  }, [seen]);
  return null;
}

describe("Toaster SSR hydration", () => {
  it("does not portal into document.body until hydration has committed", async () => {
    const seen: boolean[] = [];
    const tree = (
      <ThemeProvider>
        <ToastProvider>
          <Trigger />
          <PortalProbe seen={seen} />
        </ToastProvider>
      </ThemeProvider>
    );

    const html = renderToString(tree);
    expect(html).not.toContain("fos-toaster"); // server emits no toaster markup

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const recoverable: unknown[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, tree, {
        onRecoverableError: (e) => recoverable.push(e),
      });
    });

    expect(recoverable).toEqual([]);            // no recoverable hydration error
    expect(errorSpy).not.toHaveBeenCalled();    // no hydration warning
    expect(seen).toEqual([false]);              // body untouched while hydrating
    errorSpy.mockRestore();

    // ...and the portal works once mounted.
    expect(document.body.querySelector(".fos-toaster")).not.toBeNull();
    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
    });
    expect(document.body.querySelector(".fos-toaster")?.textContent).toContain("تم الحفظ");

    await act(async () => root.unmount());
    container.remove();
  });
});
