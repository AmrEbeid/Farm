import { it, expect, describe } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders a single shimmer by default and is decorative", () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector(".fos-skeleton");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-hidden", "true");
  });
  it("applies the shape modifier", () => {
    const { container } = render(<Skeleton shape="circle" width={40} height={40} />);
    expect(container.querySelector(".fos-skeleton--circle")).toBeInTheDocument();
  });
  it("renders multiple lines for text with lines > 1", () => {
    const { container } = render(<Skeleton shape="text" lines={3} />);
    expect(container.querySelectorAll(".fos-skeleton__line")).toHaveLength(3);
  });
  it("forwards width/height styles", () => {
    const { container } = render(<Skeleton shape="rect" width={120} height={16} />);
    const el = container.querySelector(".fos-skeleton") as HTMLElement;
    expect(el.style.width).toBe("120px");
    expect(el.style.height).toBe("16px");
  });
  it("has no axe violations", async () => {
    const { container } = render(<Skeleton shape="text" lines={2} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
