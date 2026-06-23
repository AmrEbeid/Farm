import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { PalmCell } from "./PalmCell";

describe("PalmCell", () => {
  it("applies the status modifier class and the consumer aria-label", () => {
    render(<PalmCell status="sick" ariaLabel="نخلة مريضة — صف ٣ نخلة ٨" />);
    const btn = screen.getByRole("button", { name: "نخلة مريضة — صف ٣ نخلة ٨" });
    expect(btn.className).toContain("fos-palm--sick");
  });

  it("reflects selection via aria-pressed + modifier class", () => {
    render(<PalmCell status="healthy" ariaLabel="نخلة" selected />);
    const btn = screen.getByRole("button", { name: "نخلة" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(btn.className).toContain("fos-palm--selected");
  });

  it("fires onClick", async () => {
    const onClick = vi.fn();
    render(<PalmCell status="healthy" ariaLabel="نخلة" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "نخلة" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("has no axe violations", async () => {
    const { container } = render(<PalmCell status="watch" ariaLabel="نخلة تحت المراقبة" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
