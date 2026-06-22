import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Stat } from "./Stat";

describe("Stat", () => {
  it("renders label, value and unit", () => {
    render(<Stat label="إجمالي الإنتاج" value="12٬480" unit="كجم" />);
    expect(screen.getByText("إجمالي الإنتاج")).toBeInTheDocument();
    expect(screen.getByText("12٬480")).toBeInTheDocument();
    expect(screen.getByText("كجم")).toBeInTheDocument();
  });
  it("applies the trend modifier to the change line", () => {
    const { container } = render(<Stat label="الإيراد" value="٣٢٪" trend="down" change="-٤٪" />);
    expect(container.querySelector(".fos-stat__change--down")).toBeInTheDocument();
  });
  it("uses tabular-nums on the value", () => {
    const { container } = render(<Stat label="الرصيد" value="٧٫٢" />);
    expect(container.querySelector(".fos-stat__value")).toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(<Stat label="صافي الربح" value="2.71" unit="م ج.م" change="+٨٪" trend="up" help="مقارنة بالشهر السابق" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
