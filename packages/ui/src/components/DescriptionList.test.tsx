import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { DescriptionList, type DescriptionItem } from "./DescriptionList";

const items: DescriptionItem[] = [
  { id: "owner", term: "المالك", description: "عمر عبيد" },
  { id: "area", term: "المساحة", description: "١٢ فدان", numeric: true },
  { id: "trees", term: "عدد الأشجار", description: "٤٨٠", numeric: true },
];

describe("DescriptionList", () => {
  it("renders term/description pairs", () => {
    render(<DescriptionList items={items} />);
    expect(screen.getByText("المالك")).toBeInTheDocument();
    expect(screen.getByText("عمر عبيد")).toBeInTheDocument();
  });
  it("applies the inline layout modifier", () => {
    const { container } = render(<DescriptionList items={items} layout="inline" />);
    expect(container.querySelector(".fos-dl--inline")).toBeInTheDocument();
  });
  it("marks numeric descriptions", () => {
    const { container } = render(<DescriptionList items={items} />);
    expect(container.querySelector(".fos-dl__dd--num")).toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(<DescriptionList items={items} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
