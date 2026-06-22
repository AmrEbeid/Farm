import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { LoopStepper, type LoopStep } from "./LoopStepper";

const steps: LoopStep[] = [
  { id: "plan", label: "تخطيط", state: "done" },
  { id: "check", label: "فحص", state: "done" },
  { id: "approve", label: "اعتماد", state: "active" },
  { id: "execute", label: "تنفيذ", state: "pending" },
  { id: "file", label: "أرشفة", state: "blocked" },
];

describe("LoopStepper", () => {
  it("renders an ordered list of all steps", () => {
    render(<LoopStepper steps={steps} ariaLabel="حلقة التخطيط" />);
    expect(screen.getByRole("list", { name: "حلقة التخطيط" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("اعتماد")).toBeInTheDocument();
  });
  it("marks the active step with aria-current and the right state class", () => {
    const { container } = render(<LoopStepper steps={steps} ariaLabel="حلقة" />);
    const current = container.querySelector('[aria-current="step"]');
    expect(current).not.toBeNull();
    expect(current).toHaveClass("fos-loopstep--active");
    expect(container.querySelector(".fos-loopstep--blocked")).not.toBeNull();
    expect(container.querySelectorAll(".fos-loopstep--done")).toHaveLength(2);
  });
  it("defaults missing state to pending", () => {
    const { container } = render(
      <LoopStepper steps={[{ id: "x", label: "خطوة" }]} ariaLabel="حلقة" />,
    );
    expect(container.querySelector(".fos-loopstep--pending")).not.toBeNull();
  });
  it("has no axe violations", async () => {
    const { container } = render(<LoopStepper steps={steps} ariaLabel="حلقة التخطيط" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
