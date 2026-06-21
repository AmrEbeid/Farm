import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("exposes an accessible name via label", () => {
    render(<IconButton label="حذف">🗑</IconButton>);
    expect(screen.getByRole("button", { name: "حذف" })).toBeInTheDocument();
  });
  it("fires onClick", async () => {
    let clicks = 0;
    render(<IconButton label="تعديل" onClick={() => { clicks++; }}>✎</IconButton>);
    await userEvent.click(screen.getByRole("button", { name: "تعديل" }));
    expect(clicks).toBe(1);
  });
  it("disables while loading", () => {
    render(<IconButton label="حفظ" loading>💾</IconButton>);
    expect(screen.getByRole("button", { name: "حفظ" })).toBeDisabled();
  });
  it("has no axe violations", async () => {
    const { container } = render(<IconButton label="حذف">🗑</IconButton>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
