import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the title and description", () => {
    render(<EmptyState title="لا توجد طلبات" description="ابدأ بإنشاء أول طلب صرف" />);
    expect(screen.getByText("لا توجد طلبات")).toBeInTheDocument();
    expect(screen.getByText("ابدأ بإنشاء أول طلب صرف")).toBeInTheDocument();
  });
  it("renders the action slot", () => {
    render(<EmptyState title="فارغ" action={<button>إنشاء</button>} />);
    expect(screen.getByRole("button", { name: "إنشاء" })).toBeInTheDocument();
  });
  it("renders the icon, hidden from the accessibility tree", () => {
    const { container } = render(<EmptyState title="فارغ" icon="🌴" />);
    const icon = container.querySelector(".fos-empty__icon")!;
    expect(icon).toHaveTextContent("🌴");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
  it("omits optional slots when not provided", () => {
    const { container } = render(<EmptyState title="فارغ فقط" />);
    expect(container.querySelector(".fos-empty__icon")).toBeNull();
    expect(container.querySelector(".fos-empty__desc")).toBeNull();
    expect(container.querySelector(".fos-empty__action")).toBeNull();
  });
  it("merges a consumer className and forwards rest props", () => {
    const { container } = render(
      <EmptyState title="x" className="extra" data-testid="empty" />,
    );
    const el = container.querySelector(".fos-empty")!;
    expect(el.className).toContain("extra");
    expect(el).toHaveAttribute("data-testid", "empty");
  });
  it("has no axe violations", async () => {
    const { container } = render(
      <EmptyState icon="🌴" title="لا توجد أشجار مسجلة" description="أضف أول قطاع نخيل" action={<button>إضافة قطاع</button>} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
