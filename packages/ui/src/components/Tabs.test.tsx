import { it, expect, describe, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs, tabId, tabPanelId, type TabItem } from "./Tabs";

const items: TabItem[] = [
  { id: "overview", label: "نظرة عامة" },
  { id: "details", label: "التفاصيل" },
];

/** Controlled wrapper so keyboard activation moves the selection like a real consumer. */
function ControlledTabs({
  initial = "overview",
  dir,
}: {
  initial?: string;
  dir?: "ltr" | "rtl";
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <div dir={dir}>
      <Tabs items={items} value={value} onChange={setValue} ariaLabel="أقسام" />
    </div>
  );
}

describe("Tabs", () => {
  it("renders a tablist and marks the active tab with aria-selected", () => {
    render(<Tabs items={items} value="details" onChange={() => {}} ariaLabel="أقسام" />);
    expect(screen.getByRole("tablist", { name: "أقسام" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "التفاصيل" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "نظرة عامة" })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onChange with the clicked tab id", async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="overview" onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: "التفاصيل" }));
    expect(onChange).toHaveBeenCalledWith("details");
  });

  it("marks the active tab with the active modifier class", () => {
    render(<Tabs items={items} value="overview" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "نظرة عامة" }).className).toContain("fos-tabs__tab--active");
  });

  it("applies roving tabindex: only the active tab is focusable", () => {
    render(<Tabs items={items} value="overview" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "نظرة عامة" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "التفاصيل" })).toHaveAttribute("tabindex", "-1");
  });

  it("wires id + aria-controls to the matching panel id", () => {
    render(<Tabs items={items} value="overview" onChange={() => {}} />);
    const tab = screen.getByRole("tab", { name: "نظرة عامة" });
    expect(tab).toHaveAttribute("id", tabId("overview"));
    expect(tab).toHaveAttribute("aria-controls", tabPanelId("overview"));
  });

  it("ArrowRight activates and focuses the next tab (LTR)", async () => {
    render(<ControlledTabs />);
    const first = screen.getByRole("tab", { name: "نظرة عامة" });
    first.focus();
    await userEvent.keyboard("{ArrowRight}");
    const next = screen.getByRole("tab", { name: "التفاصيل" });
    expect(next).toHaveAttribute("aria-selected", "true");
    expect(next).toHaveFocus();
  });

  it("ArrowLeft wraps to the last tab (LTR)", async () => {
    render(<ControlledTabs />);
    screen.getByRole("tab", { name: "نظرة عامة" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    const last = screen.getByRole("tab", { name: "التفاصيل" });
    expect(last).toHaveAttribute("aria-selected", "true");
    expect(last).toHaveFocus();
  });

  it("Home and End jump to the first/last tab", async () => {
    render(<ControlledTabs initial="details" />);
    screen.getByRole("tab", { name: "التفاصيل" }).focus();
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "نظرة عامة" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "التفاصيل" })).toHaveAttribute("aria-selected", "true");
  });

  it("respects RTL: ArrowRight moves to the previous tab", async () => {
    render(<ControlledTabs initial="details" dir="rtl" />);
    const second = screen.getByRole("tab", { name: "التفاصيل" });
    second.focus();
    await userEvent.keyboard("{ArrowRight}");
    // In RTL, ArrowRight goes backward to the first (overview) tab.
    expect(screen.getByRole("tab", { name: "نظرة عامة" })).toHaveAttribute("aria-selected", "true");
  });
});
