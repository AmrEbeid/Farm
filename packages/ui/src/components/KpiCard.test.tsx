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

  it("omits the delta when not provided", () => {
    const { container } = render(<KpiCard label="x" value="1" />);
    expect(container.querySelector(".fos-kpi__delta")).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(<KpiCard label="الإنتاج" value="١٢٤" unit="كجم" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
