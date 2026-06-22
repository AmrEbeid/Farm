import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { DataTable, type DataTableColumn } from "./DataTable";

interface Row { id: string; name: string; qty: number; }
const rows: Row[] = [
  { id: "a", name: "بلح سكري", qty: 120 },
  { id: "b", name: "بلح مجدول", qty: 80 },
];
const columns: DataTableColumn<Row>[] = [
  { id: "name", header: "الصنف", cell: (r) => r.name, sortable: true },
  { id: "qty", header: "الكمية", cell: (r) => r.qty, sortable: true, numeric: true, align: "end" },
];

describe("DataTable", () => {
  it("renders a table with headers and cells", () => {
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} caption="مخزون" />);
    expect(screen.getByRole("table", { name: "مخزون" })).toBeInTheDocument();
    expect(screen.getByText("الصنف")).toBeInTheDocument();
    expect(screen.getByText("بلح سكري")).toBeInTheDocument();
  });
  it("marks the active sort column with aria-sort and fires onSortChange on click", async () => {
    const onSortChange = vi.fn();
    render(
      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id}
        sort={{ columnId: "qty", direction: "asc" }} onSortChange={onSortChange} />
    );
    const qtyHeader = screen.getByRole("columnheader", { name: /الكمية/ });
    expect(qtyHeader).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(screen.getByRole("button", { name: /الكمية/ }));
    expect(onSortChange).toHaveBeenCalledWith({ columnId: "qty", direction: "desc" });
  });
  it("toggles to asc when a different column is activated by keyboard", async () => {
    const onSortChange = vi.fn();
    render(
      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id}
        sort={{ columnId: "qty", direction: "asc" }} onSortChange={onSortChange} />
    );
    const nameBtn = screen.getByRole("button", { name: /الصنف/ });
    nameBtn.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSortChange).toHaveBeenCalledWith({ columnId: "name", direction: "asc" });
  });
  it("renders the empty slot when there are no rows", () => {
    render(<DataTable columns={columns} rows={[]} getRowId={(r) => r.id} empty="لا توجد بيانات" />);
    expect(screen.getByText("لا توجد بيانات")).toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(
      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} caption="مخزون"
        sort={{ columnId: "qty", direction: "desc" }} onSortChange={() => {}} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
