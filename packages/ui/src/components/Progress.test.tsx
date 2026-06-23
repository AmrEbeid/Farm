import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Progress } from "./Progress";

describe("Progress", () => {
  it("exposes the value via role=progressbar + aria-valuenow", () => {
    render(<Progress value={42} label="تقدم الخطة" />);
    const bar = screen.getByRole("progressbar", { name: "تقدم الخطة" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
  });

  it("clamps out-of-range values to [0, 100]", () => {
    const { rerender } = render(<Progress value={150} label="x" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    rerender(<Progress value={-20} label="x" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  // Guard: a non-finite value must not produce an invalid aria-valuenow / width.
  it("treats a non-finite value as 0", () => {
    render(<Progress value={NaN} label="x" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Progress value={60} label="تقدم" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
