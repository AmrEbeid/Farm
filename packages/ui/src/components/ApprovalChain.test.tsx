import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { ApprovalChain, type ApprovalStep } from "./ApprovalChain";

const steps: ApprovalStep[] = [
  { id: "req", state: "requested", actor: "مقدّم الطلب: سعاد" },
  { id: "rev", state: "pending", actor: "المراجع: خالد", note: "بانتظار المراجعة" },
  { id: "fin", state: "approved", actor: "المالك: عمر" },
];

describe("ApprovalChain", () => {
  it("renders an ordered list of actors", () => {
    render(<ApprovalChain steps={steps} ariaLabel="سلسلة الاعتماد" />);
    expect(screen.getByRole("list", { name: "سلسلة الاعتماد" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("المراجع: خالد")).toBeInTheDocument();
  });
  it("maps each state to its role-token class and marks pending as current", () => {
    const { container } = render(<ApprovalChain steps={steps} ariaLabel="سلسلة" />);
    expect(container.querySelector(".fos-approval--requested")).not.toBeNull();
    expect(container.querySelector(".fos-approval--approved")).not.toBeNull();
    const current = container.querySelector('[aria-current="step"]');
    expect(current).toHaveClass("fos-approval--pending");
  });
  it("shows a rejected step", () => {
    const { container } = render(
      <ApprovalChain ariaLabel="سلسلة" steps={[{ id: "r", state: "rejected", actor: "المالك" }]} />,
    );
    expect(container.querySelector(".fos-approval--rejected")).not.toBeNull();
  });
  it("has no axe violations", async () => {
    const { container } = render(<ApprovalChain steps={steps} ariaLabel="سلسلة الاعتماد" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
