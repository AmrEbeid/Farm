import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { StatusPill, type PillStatus } from "./StatusPill";

const cases: [PillStatus, string][] = [
  ["draft", "fos-pill--draft"],
  ["scheduled", "fos-pill--scheduled"],
  ["active", "fos-pill--active"],
  ["done", "fos-pill--done"],
  ["warning", "fos-pill--warning"],
  ["blocked", "fos-pill--blocked"],
];

describe("StatusPill", () => {
  it("maps every status to its role-token modifier class", () => {
    for (const [status, cls] of cases) {
      const { container, unmount } = render(<StatusPill status={status}>نص</StatusPill>);
      expect(container.querySelector(`.${cls}`)).not.toBeNull();
      unmount();
    }
  });
  it("renders the consumer label and a dot by default", () => {
    const { container } = render(<StatusPill status="done">مكتملة</StatusPill>);
    expect(screen.getByText("مكتملة")).toBeInTheDocument();
    expect(container.querySelector(".fos-pill__dot")).not.toBeNull();
  });
  it("hides the dot when dot={false}", () => {
    const { container } = render(<StatusPill status="done" dot={false}>مكتملة</StatusPill>);
    expect(container.querySelector(".fos-pill__dot")).toBeNull();
  });
  it("has no axe violations", async () => {
    const { container } = render(<StatusPill status="blocked">متوقفة</StatusPill>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
