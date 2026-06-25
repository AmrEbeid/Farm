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

  it("renders a leading icon, hidden from the accessibility tree", () => {
    const { container } = render(<Alert tone="ok" title="تم" icon="✅" />);
    const icon = container.querySelector(".fos-alert__icon")!;
    expect(icon).toHaveTextContent("✅");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("omits the description element when not provided", () => {
    const { container } = render(<Alert tone="info" title="معلومة فقط" />);
    expect(container.querySelector(".fos-alert__desc")).toBeNull();
    expect(container.querySelector(".fos-alert__icon")).toBeNull();
  });

  it("merges a consumer className and forwards rest props", () => {
    const { container } = render(
      <Alert tone="info" title="x" className="extra" data-testid="a" />,
    );
    const el = container.querySelector(".fos-alert")!;
    expect(el.className).toContain("fos-alert--info");
    expect(el.className).toContain("extra");
    expect(el).toHaveAttribute("data-testid", "a");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Alert tone="ok" title="تم" description="نجحت العملية" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
