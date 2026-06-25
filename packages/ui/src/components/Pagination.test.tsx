import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Pagination } from "./Pagination";

describe("Pagination", () => {
  it("marks the current page with aria-current", () => {
    render(<Pagination page={2} pageCount={5} onChange={() => {}} ariaLabel="ترقيم الصفحات" prevLabel="السابق" nextLabel="التالي" />);
    expect(screen.getByRole("navigation", { name: "ترقيم الصفحات" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page");
  });
  it("calls onChange with the chosen page", async () => {
    const onChange = vi.fn();
    render(<Pagination page={1} pageCount={5} onChange={onChange} prevLabel="السابق" nextLabel="التالي" />);
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    expect(onChange).toHaveBeenCalledWith(3);
  });
  it("disables prev on the first page and next on the last", () => {
    const { rerender } = render(<Pagination page={1} pageCount={3} onChange={() => {}} prevLabel="السابق" nextLabel="التالي" />);
    expect(screen.getByRole("button", { name: "السابق" })).toBeDisabled();
    rerender(<Pagination page={3} pageCount={3} onChange={() => {}} prevLabel="السابق" nextLabel="التالي" />);
    expect(screen.getByRole("button", { name: "التالي" })).toBeDisabled();
  });
  it("next advances the page", async () => {
    const onChange = vi.fn();
    render(<Pagination page={1} pageCount={3} onChange={onChange} prevLabel="السابق" nextLabel="التالي" />);
    await userEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(onChange).toHaveBeenCalledWith(2);
  });
  it("has no axe violations", async () => {
    const { container } = render(<Pagination page={2} pageCount={5} onChange={() => {}} ariaLabel="ترقيم" prevLabel="السابق" nextLabel="التالي" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("gives prev/next an accessible-name fallback when labels are omitted", () => {
    render(<Pagination page={2} pageCount={5} onChange={() => {}} ariaLabel="ترقيم" />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });

  it("prefers a provided prev/next label over the fallback", () => {
    render(<Pagination page={2} pageCount={5} onChange={() => {}} ariaLabel="ترقيم" prevLabel="السابق" nextLabel="التالي" />);
    expect(screen.getByRole("button", { name: "السابق" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
  });

  it("has no axe violations when prev/next labels are omitted", async () => {
    const { container } = render(<Pagination page={2} pageCount={5} onChange={() => {}} ariaLabel="ترقيم" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  // A non-finite pageCount must not crash (Array.from({length: Infinity}) throws RangeError).
  it("renders no page buttons (instead of crashing) for a non-finite pageCount", () => {
    const { container } = render(
      <Pagination page={1} pageCount={Infinity} onChange={() => {}} ariaLabel="ترقيم" prevLabel="<" nextLabel=">" />
    );
    expect(container.querySelectorAll(".fos-pagination__page").length).toBe(0);
  });
});
