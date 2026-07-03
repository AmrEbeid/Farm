import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { KpiCard } from "./KpiCard";

describe("KpiCard", () => {
  it("renders the label, value, and unit", () => {
    render(<KpiCard label="المتاح" value="٣٠٠" unit="كجم" />);
    expect(screen.getByText("المتاح")).toBeInTheDocument();
    expect(screen.getByText("٣٠٠")).toBeInTheDocument();
    expect(screen.getByText("كجم")).toBeInTheDocument();
  });

  it("renders a delta with the direction modifier class", () => {
    const { container } = render(<KpiCard label="x" value="1" delta="−٤٪" deltaDirection="down" />);
    const delta = container.querySelector(".fos-kpi__delta")!;
    expect(delta).toHaveTextContent("−٤٪");
    expect(delta.className).toContain("fos-kpi__delta--down");
  });

  it("adds a non-colour VALENCE mark (WCAG 1.4.1): ⚠ for down, ✓ for up, none for neutral", () => {
    const down = render(<KpiCard label="x" value="1" delta="d" deltaDirection="down" />);
    const downMark = down.container.querySelector(".fos-kpi__delta-mark")!;
    expect(downMark.textContent).toContain("⚠");
    expect(downMark).toHaveAttribute("aria-hidden", "true");
    down.unmount();

    const up = render(<KpiCard label="x" value="1" delta="d" deltaDirection="up" />);
    expect(up.container.querySelector(".fos-kpi__delta-mark")!.textContent).toContain("✓");
    up.unmount();

    // Neutral delta stays colour-free with no mark — nothing to disambiguate.
    const none = render(<KpiCard label="x" value="1" delta="d" deltaDirection="none" />);
    expect(none.container.querySelector(".fos-kpi__delta-mark")).toBeNull();
  });

  it("omits the delta when not provided", () => {
    const { container } = render(<KpiCard label="x" value="1" />);
    expect(container.querySelector(".fos-kpi__delta")).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(<KpiCard label="الإنتاج" value="١٢٤" unit="كجم" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
