import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Alert } from "./Alert";

describe("Alert", () => {
  it("renders title + description with the tone class", () => {
    const { container } = render(<Alert tone="warning" title="انتبه" description="المخزون منخفض" />);
    expect(screen.getByText("انتبه")).toBeInTheDocument();
    expect(screen.getByText("المخزون منخفض")).toBeInTheDocument();
    expect(container.querySelector(".fos-alert")!.className).toContain("fos-alert--warning");
  });

  it("uses role=alert for danger and role=status otherwise", () => {
    const { rerender } = render(<Alert tone="danger" title="خطأ" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    rerender(<Alert tone="info" title="معلومة" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Alert tone="ok" title="تم" description="نجحت العملية" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
