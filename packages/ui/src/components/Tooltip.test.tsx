import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  it("shows the tooltip on focus and links it via aria-describedby", async () => {
    render(<Tooltip label="الكمية المتاحة في المخزن"><button>المخزون</button></Tooltip>);
    const btn = screen.getByRole("button", { name: "المخزون" });
    btn.focus();
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("الكمية المتاحة في المخزن");
    expect(btn).toHaveAttribute("aria-describedby", tip.id);
  });
  it("shows on hover and hides on Escape", async () => {
    render(<Tooltip label="تلميح"><button>زر</button></Tooltip>);
    const btn = screen.getByRole("button");
    await userEvent.hover(btn);
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    btn.focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(<Tooltip label="تلميح"><button>زر</button></Tooltip>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
