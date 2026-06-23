import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Field } from "./Field";

describe("Field", () => {
  it("associates the label with the default input via htmlFor/id", () => {
    render(<Field label="الاسم" id="name" placeholder="اكتب الاسم" />);
    const input = screen.getByLabelText("الاسم");
    expect(input).toHaveAttribute("id", "name");
    expect(input).toHaveAttribute("placeholder", "اكتب الاسم");
  });

  it("renders custom children instead of the default input", () => {
    render(
      <Field label="نوع" id="kind">
        <select id="kind"><option>أ</option></select>
      </Field>
    );
    expect(screen.getByLabelText("نوع").tagName).toBe("SELECT");
  });

  it("wires error → aria-invalid + aria-describedby + visible message", () => {
    render(<Field label="الكمية" id="qty" error="قيمة غير صالحة" />);
    const input = screen.getByLabelText("الكمية");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "qty-err");
    const err = document.getElementById("qty-err")!;
    expect(err).toHaveTextContent("قيمة غير صالحة");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Field label="الاسم" id="name" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
