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

  describe("mobile reflow", () => {
    it("opts into card reflow by default and labels each cell with its header", () => {
      const { container } = render(
        <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} caption="مخزون" />
      );
      expect(container.querySelector(".fos-table-wrap--reflow")).toBeInTheDocument();
      const cells = container.querySelectorAll<HTMLTableCellElement>(".fos-table__td");
      // first data row: name + qty cells carry their column header as data-label
      expect(cells[0]).toHaveAttribute("data-label", "الصنف");
      expect(cells[1]).toHaveAttribute("data-label", "الكمية");
    });

    it("can opt out to legacy horizontal scroll with reflow=\"scroll\"", () => {
      const { container } = render(
        <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} reflow="scroll" />
      );
      expect(container.querySelector(".fos-table-wrap--reflow")).toBeNull();
      expect(container.querySelector(".fos-table-wrap")).toBeInTheDocument();
    });

    it("omits data-label for non-string (JSX) headers so no broken label renders", () => {
      const jsxCols: DataTableColumn<Row>[] = [
        { id: "name", header: <span>الصنف</span>, cell: (r) => r.name },
        { id: "qty", header: "الكمية", cell: (r) => r.qty, numeric: true },
      ];
      const { container } = render(
        <DataTable columns={jsxCols} rows={rows} getRowId={(r) => r.id} />
      );
      const cells = container.querySelectorAll<HTMLTableCellElement>(".fos-table__td");
      expect(cells[0]).not.toHaveAttribute("data-label");
      expect(cells[1]).toHaveAttribute("data-label", "الكمية");
    });

    it("has no axe violations in card-reflow mode", async () => {
      const { container } = render(
        <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} caption="مخزون" />
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
