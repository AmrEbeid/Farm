import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { PalmGrid, type PalmLine } from "./PalmGrid";
import { PalmCell, type PalmStatus } from "./PalmCell";

const lines: PalmLine[] = [
  {
    id: "L1",
    label: "خط ١",
    cells: [
      { id: "L1-1", status: "healthy", ariaLabel: "نخلة سليمة، خط ١ موضع ١" },
      { id: "L1-2", status: "sick", ariaLabel: "نخلة مريضة، خط ١ موضع ٢" },
    ],
  },
  {
    id: "L2",
    label: "خط ٢",
    cells: [{ id: "L2-1", status: "male", ariaLabel: "نخلة ذكر، خط ٢ موضع ١" }],
  },
];

describe("PalmCell", () => {
  it("maps every status to its role-token modifier class", () => {
    const all: PalmStatus[] = ["healthy", "watch", "sick", "dead", "removed", "male"];
    for (const status of all) {
      const { container, unmount } = render(<PalmCell status={status} ariaLabel={`نخلة ${status}`} />);
      expect(container.querySelector(`.fos-palm--${status}`)).not.toBeNull();
      unmount();
    }
  });
  it("renders as a button carrying the consumer accessible label", () => {
    render(<PalmCell status="healthy" ariaLabel="نخلة سليمة، خط ١ موضع ١" />);
    expect(screen.getByRole("button", { name: "نخلة سليمة، خط ١ موضع ١" })).toBeInTheDocument();
  });
});

describe("PalmGrid", () => {
  it("renders a labelled region with a line label per line and one button per cell", () => {
    render(<PalmGrid lines={lines} ariaLabel="خريطة النخيل" />);
    expect(screen.getByRole("group", { name: "خريطة النخيل" })).toBeInTheDocument();
    expect(screen.getByText("خط ١")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
  it("fires onCellActivate with cell id + line id on click", async () => {
    const onCellActivate = vi.fn();
    render(<PalmGrid lines={lines} ariaLabel="خريطة" onCellActivate={onCellActivate} />);
    await userEvent.click(screen.getByRole("button", { name: "نخلة مريضة، خط ١ موضع ٢" }));
    expect(onCellActivate).toHaveBeenCalledWith("L1-2", "L1");
  });
  it("activates a cell with the keyboard (Enter)", async () => {
    const onCellActivate = vi.fn();
    render(<PalmGrid lines={lines} ariaLabel="خريطة" onCellActivate={onCellActivate} />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onCellActivate).toHaveBeenCalledWith("L1-1", "L1");
  });
  it("has no axe violations", async () => {
    const { container } = render(<PalmGrid lines={lines} ariaLabel="خريطة النخيل" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
