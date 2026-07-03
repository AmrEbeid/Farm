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

  it("injects aria-invalid + aria-describedby into a custom child control on error", () => {
    render(
      <Field label="نوع" id="kind" error="قيمة غير صالحة">
        <select id="kind"><option>أ</option></select>
      </Field>
    );
    const control = screen.getByLabelText("نوع");
    expect(control.tagName).toBe("SELECT");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAttribute("aria-describedby", "kind-err");
  });

  it("does not set error attributes on custom children when there is no error", () => {
    render(
      <Field label="نوع" id="kind">
        <select id="kind"><option>أ</option></select>
      </Field>
    );
    const control = screen.getByLabelText("نوع");
    expect(control).not.toHaveAttribute("aria-invalid");
    expect(control).not.toHaveAttribute("aria-describedby");
  });

  it("appends to a child's existing aria-describedby rather than overwriting it", () => {
    render(
      <Field label="نوع" id="kind" error="خطأ">
        <input id="kind" aria-describedby="hint" />
      </Field>
    );
    expect(screen.getByLabelText("نوع")).toHaveAttribute("aria-describedby", "hint kind-err");
  });

  it("required: injects native `required` onto a custom control and shows an aria-hidden marker", () => {
    render(
      <Field label="عضو الفريق" id="member" required>
        <select id="member"><option>أ</option></select>
      </Field>
    );
    // Regex match (per the FormRow convention): the "*" marker is in the label textContent but is
    // aria-hidden, so it's decorative-only.
    const control = screen.getByLabelText(/عضو الفريق/);
    expect(control).toBeRequired();
    const marker = document.querySelector(".fos-field__req")!;
    expect(marker).toHaveAttribute("aria-hidden", "true");
  });

  it("required: sets `required` on the default input too", () => {
    render(<Field label="الكمية" id="qty" required />);
    expect(screen.getByLabelText(/الكمية/)).toBeRequired();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Field label="الاسم" id="name" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations for a required custom control", async () => {
    const { container } = render(
      <Field label="عضو الفريق" id="member" required>
        <select id="member"><option>أ</option></select>
      </Field>
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with a custom child control in an error state", async () => {
    const { container } = render(
      <Field label="نوع" id="kind" error="قيمة غير صالحة">
        <select id="kind"><option>أ</option></select>
      </Field>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
