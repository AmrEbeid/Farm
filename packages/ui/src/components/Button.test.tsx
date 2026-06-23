import { it, expect, describe, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Button } from "./Button";

describe("Button", () => {
  it("applies variant and size modifier classes", () => {
    const { container } = render(<Button variant="danger" size="sm">حذف</Button>);
    const btn = container.querySelector("button")!;
    expect(btn.className).toContain("fos-btn--danger");
    expect(btn.className).toContain("fos-btn--sm");
  });

  it("defaults to primary/md", () => {
    const { container } = render(<Button>حفظ</Button>);
    const btn = container.querySelector("button")!;
    expect(btn.className).toContain("fos-btn--primary");
    expect(btn.className).toContain("fos-btn--md");
  });

  it("loading shows a spinner, sets aria-busy, disables, and hides the icon", () => {
    const { container } = render(<Button loading icon={<span data-testid="ic" />}>حفظ</Button>);
    const btn = container.querySelector("button")!;
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".fos-btn__spinner")).not.toBeNull();
    expect(screen.queryByTestId("ic")).toBeNull();
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>x</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("forwards a ref to the underlying button", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<Button ref={ref}>x</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("has no axe violations", async () => {
    const { container } = render(<Button>حفظ</Button>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
