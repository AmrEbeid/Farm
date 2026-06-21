import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import * as React from "react";
import { NumberField } from "./NumberField";

function Controlled() {
  const [v, setV] = React.useState<number | "">(2);
  return (
    <NumberField
      aria-label="الكمية"
      value={v}
      onValueChange={setV}
      step={1}
      min={0}
      max={5}
      decrementLabel="إنقاص"
      incrementLabel="زيادة"
    />
  );
}

describe("NumberField", () => {
  it("increments via the step-up button, clamped to max", async () => {
    render(<Controlled />);
    const inc = screen.getByRole("button", { name: "زيادة" });
    const input = screen.getByLabelText("الكمية") as HTMLInputElement;
    expect(input.value).toBe("2");
    await userEvent.click(inc);
    expect(input.value).toBe("3");
  });
  it("decrements and clamps at min", async () => {
    render(<Controlled />);
    const dec = screen.getByRole("button", { name: "إنقاص" });
    await userEvent.click(dec);
    await userEvent.click(dec);
    await userEvent.click(dec); // would go below 0
    expect((screen.getByLabelText("الكمية") as HTMLInputElement).value).toBe("0");
  });
  it("reflects invalid via aria-invalid", () => {
    render(<NumberField aria-label="ك" invalid decrementLabel="-" incrementLabel="+" defaultValue={1} />);
    expect(screen.getByLabelText("ك")).toHaveAttribute("aria-invalid", "true");
  });
  it("has no axe violations", async () => {
    const { container } = render(
      <NumberField aria-label="الكمية" defaultValue={1} decrementLabel="إنقاص" incrementLabel="زيادة" />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
