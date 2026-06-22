import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("renders initials from the name when no src", () => {
    render(<Avatar name="عمر عبيد" />);
    expect(screen.getByText("عع")).toBeInTheDocument();
  });
  it("exposes the name as an accessible label", () => {
    render(<Avatar name="عمر عبيد" />);
    expect(screen.getByLabelText("عمر عبيد")).toBeInTheDocument();
  });
  it("renders an image with alt when src is provided", () => {
    render(<Avatar name="عمر عبيد" src="/omar.jpg" />);
    expect(screen.getByRole("img", { name: "عمر عبيد" })).toBeInTheDocument();
  });
  it("applies the size modifier", () => {
    const { container } = render(<Avatar name="عمر" size="lg" />);
    expect(container.querySelector(".fos-avatar--lg")).toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(<Avatar name="عمر عبيد" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
