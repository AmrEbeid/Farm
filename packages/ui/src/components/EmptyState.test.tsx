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
  it("has no axe violations", async () => {
    const { container } = render(
      <EmptyState icon="🌴" title="لا توجد أشجار مسجلة" description="أضف أول قطاع نخيل" action={<button>إضافة قطاع</button>} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
