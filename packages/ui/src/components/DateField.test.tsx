import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { DateField } from "./DateField";

describe("DateField", () => {
  it("renders a native date input", () => {
    render(<DateField aria-label="تاريخ الزيارة" />);
    const el = screen.getByLabelText("تاريخ الزيارة") as HTMLInputElement;
    expect(el.type).toBe("date");
  });
  it("is controlled and updates value", async () => {
    let value = "";
    const { rerender } = render(
      <DateField aria-label="التاريخ" value={value} onChange={(e) => { value = e.target.value; }} />
    );
    await userEvent.type(screen.getByLabelText("التاريخ"), "2026-06-21");
    rerender(<DateField aria-label="التاريخ" value={value} onChange={() => {}} />);
    expect((screen.getByLabelText("التاريخ") as HTMLInputElement).value).toBe("2026-06-21");
  });
  it("reflects invalid via aria-invalid", () => {
    render(<DateField aria-label="التاريخ" invalid />);
    expect(screen.getByLabelText("التاريخ")).toHaveAttribute("aria-invalid", "true");
  });
  it("has no axe violations", async () => {
    const { container } = render(<DateField aria-label="التاريخ" defaultValue="2026-06-21" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
