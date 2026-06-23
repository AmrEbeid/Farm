import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Tag } from "./Tag";

describe("Tag", () => {
  it("renders children with the tone modifier class", () => {
    const { container } = render(<Tag tone="danger">متأخر</Tag>);
    const el = container.querySelector(".fos-tag")!;
    expect(el).toHaveTextContent("متأخر");
    expect(el.className).toContain("fos-tag--danger");
  });

  it("defaults to the neutral tone", () => {
    const { container } = render(<Tag>عادي</Tag>);
    expect(container.querySelector(".fos-tag")!.className).toContain("fos-tag--neutral");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Tag tone="ok">جاهز</Tag>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
