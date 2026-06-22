import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Timeline, type TimelineItem } from "./Timeline";

const items: TimelineItem[] = [
  { id: "1", title: "تم إنشاء الخطة", time: "٠٩:٠٠", tone: "info" },
  { id: "2", title: "اعتماد المالك", time: "١٠:٣٠", tone: "success", description: "اعتمد عمر الطلب" },
  { id: "3", title: "حُفظ المستند", time: "١١:١٥" },
];

describe("Timeline", () => {
  it("renders an ordered list with all items", () => {
    render(<Timeline items={items} aria-label="سجل العمليات" />);
    expect(screen.getByRole("list", { name: "سجل العمليات" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("اعتماد المالك")).toBeInTheDocument();
  });
  it("applies the tone modifier to the marker", () => {
    const { container } = render(<Timeline items={items} />);
    expect(container.querySelector(".fos-timeline__marker--success")).toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(<Timeline items={items} aria-label="سجل العمليات" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
