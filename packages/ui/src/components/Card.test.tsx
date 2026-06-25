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

  it("renders a subtitle without a title", () => {
    const { container } = render(<Card subtitle="هذا الأسبوع">x</Card>);
    expect(container.querySelector(".fos-card__title")).toBeNull();
    expect(container.querySelector(".fos-card__sub")).toHaveTextContent("هذا الأسبوع");
  });

  it("merges a consumer className and forwards rest props", () => {
    const { container } = render(
      <Card className="extra" data-testid="card" role="region" aria-label="ملخص">x</Card>,
    );
    const el = container.querySelector(".fos-card")!;
    expect(el.className).toContain("extra");
    expect(el).toHaveAttribute("data-testid", "card");
    expect(el).toHaveAttribute("aria-label", "ملخص");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Card title="عنوان">x</Card>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
