import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import * as React from "react";
import { Input } from "./Input";

describe("Input", () => {
  it("is controlled and reports typed value", async () => {
    function Harness() {
      const [value, setValue] = React.useState("");
      return <Input aria-label="الاسم" value={value} onChange={(e) => setValue(e.target.value)} />;
    }
    render(<Harness />);
    await userEvent.type(screen.getByLabelText("الاسم"), "نخلة");
    expect((screen.getByLabelText("الاسم") as HTMLInputElement).value).toBe("نخلة");
  });
  it("reflects invalid via aria-invalid", () => {
    render(<Input aria-label="الكمية" invalid />);
    expect(screen.getByLabelText("الكمية")).toHaveAttribute("aria-invalid", "true");
  });
  it("forwards the ref to the input element", () => {
    let el: HTMLInputElement | null = null;
    render(<Input aria-label="حقل" ref={(n) => { el = n; }} />);
    expect(el).toBeInstanceOf(HTMLInputElement);
  });
  it("has no axe violations", async () => {
    const { container } = render(<Input aria-label="الاسم" defaultValue="نص" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
