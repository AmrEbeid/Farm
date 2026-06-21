import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import * as React from "react";
import { Switch } from "./Switch";

function Harness() {
  const [on, setOn] = React.useState(false);
  return <Switch label="الإشعارات" checked={on} onCheckedChange={setOn} />;
}

describe("Switch", () => {
  it("has switch role with an accessible name and initial state", () => {
    render(<Harness />);
    const sw = screen.getByRole("switch", { name: "الإشعارات" });
    expect(sw).toHaveAttribute("aria-checked", "false");
  });
  it("toggles on click", async () => {
    render(<Harness />);
    const sw = screen.getByRole("switch", { name: "الإشعارات" });
    await userEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
  });
  it("toggles on Space key", async () => {
    render(<Harness />);
    const sw = screen.getByRole("switch", { name: "الإشعارات" });
    sw.focus();
    await userEvent.keyboard(" ");
    expect(sw).toHaveAttribute("aria-checked", "true");
  });
  it("has no axe violations", async () => {
    const { container } = render(<Switch label="الوضع الليلي" defaultChecked />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
