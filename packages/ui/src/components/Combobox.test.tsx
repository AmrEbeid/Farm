import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import * as React from "react";
import { Combobox } from "./Combobox";

const options = [
  { value: "khalas", label: "خلاص" },
  { value: "barhi", label: "برحي" },
  { value: "sukkari", label: "سكري" },
];

function Harness() {
  const [v, setV] = React.useState("");
  return <Combobox aria-label="الصنف" options={options} value={v} onValueChange={setV} placeholder="ابحث…" />;
}

describe("Combobox", () => {
  it("exposes a combobox role with listbox semantics", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "الصنف" });
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
  it("opens and filters options on typing", async () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "الصنف" });
    await userEvent.type(input, "بر");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(1);
    expect(opts[0]).toHaveTextContent("برحي");
  });
  it("navigates with arrows and selects with Enter", async () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "الصنف" }) as HTMLInputElement;
    await userEvent.click(input);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(input.value).toBe("برحي");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
  it("closes on Escape", async () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "الصنف" });
    await userEvent.click(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
