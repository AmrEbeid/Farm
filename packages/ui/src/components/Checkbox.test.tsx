import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Checkbox } from "./Checkbox";

describe("Checkbox", () => {
  it("associates the visible label with the input", () => {
    render(<Checkbox label="موافق على الشروط" />);
    expect(screen.getByRole("checkbox", { name: "موافق على الشروط" })).toBeInTheDocument();
  });
  it("toggles on label click", async () => {
    let checked = false;
    render(<Checkbox label="تأكيد" checked={checked} onChange={(e) => { checked = e.target.checked; }} />);
    await userEvent.click(screen.getByText("تأكيد"));
    expect(checked).toBe(true);
  });
  it("forwards the ref", () => {
    let el: HTMLInputElement | null = null;
    render(<Checkbox label="x" ref={(n) => { el = n; }} />);
    expect(el).toBeInstanceOf(HTMLInputElement);
  });
  it("has no axe violations", async () => {
    const { container } = render(<Checkbox label="موافق" defaultChecked />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
