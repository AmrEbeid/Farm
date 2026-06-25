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
  it("falls back to the default marker tone when none is given", () => {
    const { container } = render(<Timeline items={[{ id: "x", title: "بدون نبرة" }]} />);
    expect(container.querySelector(".fos-timeline__marker--default")).toBeInTheDocument();
  });
  it("renders an icon inside the marker and the time/description only when present", () => {
    const { container } = render(
      <Timeline items={[{ id: "x", title: "مع أيقونة", icon: "🌴" }]} />,
    );
    expect(container.querySelector(".fos-timeline__marker")).toHaveTextContent("🌴");
    expect(container.querySelector(".fos-timeline__time")).toBeNull();
    expect(container.querySelector(".fos-timeline__desc")).toBeNull();
  });
  it("merges a consumer className and forwards rest props", () => {
    const { container } = render(
      <Timeline items={items} className="extra" data-testid="tl" />,
    );
    const el = container.querySelector(".fos-timeline")!;
    expect(el.className).toContain("extra");
    expect(el).toHaveAttribute("data-testid", "tl");
  });
  it("has no axe violations", async () => {
    const { container } = render(<Timeline items={items} aria-label="سجل العمليات" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
