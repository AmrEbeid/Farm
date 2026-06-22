import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { RoleSwitcher, type RoleOption } from "./RoleSwitcher";

const options: RoleOption[] = [
  { id: "owner", label: "المالك" },
  { id: "accountant", label: "المحاسب" },
  { id: "worker", label: "العامل" },
];

describe("RoleSwitcher", () => {
  it("renders an accessible, labeled combobox reflecting the controlled value", () => {
    render(<RoleSwitcher options={options} value="accountant" onRoleChange={() => {}} label="تبديل الدور" />);
    const select = screen.getByRole("combobox", { name: "تبديل الدور" }) as HTMLSelectElement;
    expect(select.value).toBe("accountant");
  });

  it("calls onRoleChange with the chosen role id", async () => {
    const onRoleChange = vi.fn();
    render(<RoleSwitcher options={options} value="owner" onRoleChange={onRoleChange} label="الدور" />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "worker");
    expect(onRoleChange).toHaveBeenCalledWith("worker");
  });

  it("is keyboard focusable", async () => {
    render(<RoleSwitcher options={options} value="owner" onRoleChange={() => {}} label="الدور" />);
    await userEvent.tab();
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <RoleSwitcher options={options} value="owner" onRoleChange={() => {}} label="الدور" />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
