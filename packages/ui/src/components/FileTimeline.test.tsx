import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { FileTimeline, type TimelineEvent, type TimelineKind } from "./FileTimeline";

const events: TimelineEvent[] = [
  { id: "e1", kind: "operation", title: "ري", time: "١٢ يونيو ٠٩:٣٠" },
  { id: "e2", kind: "issue", title: "إصابة بالسوسة", time: "١٣ يونيو", description: "خط ٢" },
  { id: "e3", kind: "inspection", title: "فحص دوري", time: "١٤ يونيو" },
  { id: "e4", kind: "expense", title: "شراء سماد", time: "١٥ يونيو" },
  { id: "e5", kind: "photo", title: "صورة الثمار", time: "١٦ يونيو" },
];

describe("FileTimeline", () => {
  it("renders an ordered list with every event title + time", () => {
    render(<FileTimeline events={events} ariaLabel="سجل المزرعة" />);
    expect(screen.getByRole("list", { name: "سجل المزرعة" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("إصابة بالسوسة")).toBeInTheDocument();
    expect(screen.getByText("خط ٢")).toBeInTheDocument();
  });
  it("maps every kind to its role-token marker class", () => {
    const all: TimelineKind[] = ["operation", "issue", "inspection", "expense", "photo"];
    const { container } = render(
      <FileTimeline ariaLabel="سجل" events={all.map((k, i) => ({ id: `${i}`, kind: k, title: k, time: "اليوم" }))} />,
    );
    for (const k of all) expect(container.querySelector(`.fos-tl--${k}`)).not.toBeNull();
  });
  it("renders a glyph in the marker, hidden from the accessibility tree", () => {
    const { container } = render(
      <FileTimeline ariaLabel="سجل" events={[{ id: "g", kind: "operation", title: "ري", time: "اليوم", glyph: "💧" }]} />,
    );
    const marker = container.querySelector(".fos-tl__marker")!;
    expect(marker).toHaveTextContent("💧");
    expect(marker).toHaveAttribute("aria-hidden", "true");
  });
  it("omits the description element when an event has none", () => {
    const { container } = render(
      <FileTimeline ariaLabel="سجل" events={[{ id: "n", kind: "photo", title: "صورة", time: "اليوم" }]} />,
    );
    expect(container.querySelector(".fos-tl__desc")).toBeNull();
  });
  it("merges a consumer className and forwards rest props", () => {
    const { container } = render(
      <FileTimeline ariaLabel="سجل" events={events} className="extra" data-testid="ftl" />,
    );
    const el = container.querySelector(".fos-tl")!;
    expect(el.className).toContain("extra");
    expect(el).toHaveAttribute("data-testid", "ftl");
  });
  it("has no axe violations", async () => {
    const { container } = render(<FileTimeline events={events} ariaLabel="سجل المزرعة" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
