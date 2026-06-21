import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Textarea } from "./Textarea";

describe("Textarea", () => {
  it("accepts typed multi-line input (uncontrolled)", async () => {
    render(<Textarea aria-label="ملاحظات" />);
    const el = screen.getByLabelText("ملاحظات");
    await userEvent.type(el, "سطر");
    expect((el as HTMLTextAreaElement).value).toBe("سطر");
  });
  it("reflects invalid via aria-invalid", () => {
    render(<Textarea aria-label="ملاحظات" invalid />);
    expect(screen.getByLabelText("ملاحظات")).toHaveAttribute("aria-invalid", "true");
  });
  it("forwards the ref", () => {
    let el: HTMLTextAreaElement | null = null;
    render(<Textarea aria-label="ملاحظات" ref={(n) => { el = n; }} />);
    expect(el).toBeInstanceOf(HTMLTextAreaElement);
  });
  it("has no axe violations", async () => {
    const { container } = render(<Textarea aria-label="ملاحظات" defaultValue="نص" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
