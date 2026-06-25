import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { VerdictBanner } from "./VerdictBanner";

describe("VerdictBanner", () => {
  it("renders children with the tone class and the default tone icon", () => {
    const { container } = render(<VerdictBanner tone="danger">نقص حرج</VerdictBanner>);
    const el = container.querySelector(".fos-verdict")!;
    expect(el).toHaveTextContent("نقص حرج");
    expect(el.className).toContain("fos-verdict--danger");
    expect(el).toHaveTextContent("⛔"); // default danger glyph
  });

  it("uses a custom icon when provided", () => {
    render(<VerdictBanner tone="ok" icon={<span>★</span>}>كافٍ</VerdictBanner>);
    expect(screen.getByText("★")).toBeInTheDocument();
  });

  it("exposes role=status so the verdict is announced", () => {
    render(<VerdictBanner tone="warning">اطلب قريبًا</VerdictBanner>);
    expect(screen.getByRole("status")).toHaveTextContent("اطلب قريبًا");
  });

  it("renders the default glyph for each tone", () => {
    const { container, rerender } = render(<VerdictBanner tone="ok">x</VerdictBanner>);
    expect(container.querySelector(".fos-verdict")).toHaveTextContent("✅");
    rerender(<VerdictBanner tone="warning">x</VerdictBanner>);
    expect(container.querySelector(".fos-verdict")).toHaveTextContent("⚠️");
  });

  it("merges a consumer className and forwards rest props", () => {
    const { container } = render(
      <VerdictBanner tone="ok" className="extra" data-testid="v">كافٍ</VerdictBanner>,
    );
    const el = container.querySelector(".fos-verdict")!;
    expect(el.className).toContain("fos-verdict--ok");
    expect(el.className).toContain("extra");
    expect(el).toHaveAttribute("data-testid", "v");
  });

  it("has no axe violations", async () => {
    const { container } = render(<VerdictBanner tone="ok">المخزون كافٍ</VerdictBanner>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
