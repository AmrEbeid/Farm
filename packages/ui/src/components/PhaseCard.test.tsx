import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { PhaseCard } from "./PhaseCard";

describe("PhaseCard", () => {
  it("renders title, status and meta rows", () => {
    render(
      <PhaseCard
        title="تقليم النخيل"
        tone="warning"
        status="قيد التنفيذ"
        meta={[
          { label: "الموعد", value: "١٢ يونيو" },
          { label: "المسؤول", value: "خالد" },
        ]}
      />,
    );
    expect(screen.getByText("تقليم النخيل")).toBeInTheDocument();
    expect(screen.getByText("قيد التنفيذ")).toBeInTheDocument();
    expect(screen.getByText("الموعد")).toBeInTheDocument();
    expect(screen.getByText("خالد")).toBeInTheDocument();
  });
  it("applies the tone modifier class", () => {
    const { container } = render(<PhaseCard title="مرحلة" tone="danger" />);
    expect(container.querySelector(".fos-phase--danger")).not.toBeNull();
  });
  it("renders a progressbar when progress is provided", () => {
    render(<PhaseCard title="مرحلة" progress={60} progressLabel="نسبة الإنجاز" />);
    const bar = screen.getByRole("progressbar", { name: "نسبة الإنجاز" });
    expect(bar).toHaveAttribute("aria-valuenow", "60");
  });
  it("has no axe violations", async () => {
    const { container } = render(
      <PhaseCard title="تسميد" tone="ok" status="مكتملة" progress={100} progressLabel="الإنجاز" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
