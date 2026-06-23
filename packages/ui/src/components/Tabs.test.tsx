import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs, type TabItem } from "./Tabs";

const items: TabItem[] = [
  { id: "overview", label: "نظرة عامة" },
  { id: "details", label: "التفاصيل" },
];

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
});
