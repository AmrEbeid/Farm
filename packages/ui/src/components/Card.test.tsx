import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Card } from "./Card";

describe("Card", () => {
  it("renders title, subtitle, and children", () => {
    render(<Card title="الملخص" subtitle="هذا الأسبوع"><p>محتوى</p></Card>);
    expect(screen.getByText("الملخص")).toBeInTheDocument();
    expect(screen.getByText("هذا الأسبوع")).toBeInTheDocument();
    expect(screen.getByText("محتوى")).toBeInTheDocument();
  });

  it("omits the header elements when title/subtitle are absent", () => {
    const { container } = render(<Card><p>فقط محتوى</p></Card>);
    expect(container.querySelector(".fos-card__title")).toBeNull();
    expect(container.querySelector(".fos-card__sub")).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Card title="عنوان">x</Card>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
