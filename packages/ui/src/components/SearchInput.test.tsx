import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { SearchInput } from "./SearchInput";

describe("SearchInput", () => {
  it("exposes a search role and an accessible label", () => {
    render(<SearchInput label="بحث في المزرعة" value="" onValueChange={() => {}} />);
    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "بحث في المزرعة" })).toBeInTheDocument();
  });

  it("is controlled — calls onValueChange on input", async () => {
    const onValueChange = vi.fn();
    render(<SearchInput label="بحث" value="" onValueChange={onValueChange} />);
    await userEvent.type(screen.getByRole("searchbox"), "نخ");
    expect(onValueChange).toHaveBeenCalled();
    expect(onValueChange).toHaveBeenLastCalledWith("خ");
  });

  it("fires onSubmitSearch with the value on Enter", async () => {
    const onSubmitSearch = vi.fn();
    render(<SearchInput label="بحث" value="نخيل" onValueChange={() => {}} onSubmitSearch={onSubmitSearch} />);
    const box = screen.getByRole("searchbox");
    box.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSubmitSearch).toHaveBeenCalledWith("نخيل");
  });

  it("has no axe violations", async () => {
    const { container } = render(<SearchInput label="بحث" value="" onValueChange={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
