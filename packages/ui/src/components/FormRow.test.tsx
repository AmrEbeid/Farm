import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { FormRow } from "./FormRow";
import { Input } from "./Input";

describe("FormRow", () => {
  it("associates label, help, and error with the control", () => {
    render(
      <FormRow id="qty" label="الكمية" help="بالكيلوجرام" error="قيمة غير صالحة">
        <Input />
      </FormRow>
    );
    const input = screen.getByLabelText("الكمية");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedby = input.getAttribute("aria-describedby") ?? "";
    expect(describedby).toContain("qty-help");
    expect(describedby).toContain("qty-error");
    expect(screen.getByText("بالكيلوجرام")).toHaveAttribute("id", "qty-help");
    expect(screen.getByText("قيمة غير صالحة")).toHaveAttribute("id", "qty-error");
  });
  it("omits error wiring when there is no error", () => {
    render(
      <FormRow id="name" label="الاسم" help="الاسم الكامل">
        <Input />
      </FormRow>
    );
    const input = screen.getByLabelText("الاسم");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input.getAttribute("aria-describedby")).toBe("name-help");
  });
  it("marks required fields", () => {
    render(<FormRow id="r" label="مطلوب" required><Input /></FormRow>);
    expect(screen.getByLabelText(/مطلوب/)).toBeRequired();
  });
  it("has no axe violations", async () => {
    const { container } = render(
      <FormRow id="a" label="الاسم" help="مساعدة"><Input /></FormRow>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
