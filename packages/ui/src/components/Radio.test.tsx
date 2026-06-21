import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import * as React from "react";
import { RadioGroup } from "./Radio";

const options = [
  { value: "owner", label: "مالك" },
  { value: "manager", label: "مدير" },
  { value: "worker", label: "عامل" },
];

function Harness() {
  const [v, setV] = React.useState("owner");
  return <RadioGroup name="role" legend="الدور" options={options} value={v} onValueChange={setV} />;
}

describe("RadioGroup", () => {
  it("renders one radio per option grouped under the legend", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "الدور" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });
  it("selects on click", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("radio", { name: "مدير" }));
    expect((screen.getByRole("radio", { name: "مدير" }) as HTMLInputElement).checked).toBe(true);
  });
  it("has no axe violations", async () => {
    const { container } = render(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
