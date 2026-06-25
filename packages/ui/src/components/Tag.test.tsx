import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Tag, type TagTone } from "./Tag";

describe("Tag", () => {
  it("renders children with the tone modifier class", () => {
    const { container } = render(<Tag tone="danger">متأخر</Tag>);
    const el = container.querySelector(".fos-tag")!;
    expect(el).toHaveTextContent("متأخر");
    expect(el.className).toContain("fos-tag--danger");
  });

  it("defaults to the neutral tone", () => {
    const { container } = render(<Tag>عادي</Tag>);
    expect(container.querySelector(".fos-tag")!.className).toContain("fos-tag--neutral");
  });

  it("maps every tone to its modifier class", () => {
    const tones: TagTone[] = ["ok", "warning", "danger", "info", "neutral", "accent"];
    for (const tone of tones) {
      const { container, unmount } = render(<Tag tone={tone}>نص</Tag>);
      expect(container.querySelector(`.fos-tag--${tone}`)).not.toBeNull();
      unmount();
    }
  });

  it("merges a consumer className and forwards rest props", () => {
    const { container } = render(
      <Tag className="extra" data-testid="t" title="تلميح">جاهز</Tag>,
    );
    const el = container.querySelector(".fos-tag")!;
    expect(el.className).toContain("fos-tag--neutral");
    expect(el.className).toContain("extra");
    expect(el).toHaveAttribute("data-testid", "t");
    expect(el).toHaveAttribute("title", "تلميح");
  });

  it("forwards an onClick handler", async () => {
    const onClick = vi.fn();
    render(<Tag onClick={onClick}>اضغط</Tag>);
    await userEvent.click(screen.getByText("اضغط"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("has no axe violations", async () => {
    const { container } = render(<Tag tone="ok">جاهز</Tag>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
