import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Select } from "./Select";

const options = [
  { value: "ok", label: "سليمة" },
  { value: "low", label: "منخفضة" },
  { value: "crit", label: "حرجة", disabled: true },
];

describe("Select", () => {
  it("renders options and a placeholder", () => {
    render(<Select aria-label="الحالة" options={options} placeholder="اختر…" />);
    expect(screen.getByRole("option", { name: "اختر…" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "سليمة" })).toBeInTheDocument();
  });
  it("supports controlled selection", async () => {
    let value = "ok";
    render(<Select aria-label="الحالة" options={options} value={value} onChange={(e) => { value = e.target.value; }} />);
    await userEvent.selectOptions(screen.getByLabelText("الحالة"), "low");
    expect(value).toBe("low");
  });
  it("reflects invalid via aria-invalid", () => {
    render(<Select aria-label="الحالة" options={options} invalid />);
    expect(screen.getByLabelText("الحالة")).toHaveAttribute("aria-invalid", "true");
  });
  it("has no axe violations", async () => {
    const { container } = render(<Select aria-label="الحالة" options={options} defaultValue="ok" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
