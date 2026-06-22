import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { DataTable, type DataTableColumn, type SortState } from "./DataTable";

interface Row { id: string; variety: string; qty: number; price: number; }
const data: Row[] = [
  { id: "1", variety: "بلح سكري", qty: 120, price: 45 },
  { id: "2", variety: "بلح مجدول", qty: 80, price: 70 },
  { id: "3", variety: "بلح زغلول", qty: 200, price: 30 },
];
const columns: DataTableColumn<Row>[] = [
  { id: "variety", header: "الصنف", cell: (r) => r.variety, sortable: true },
  { id: "qty", header: "الكمية (كجم)", cell: (r) => r.qty, sortable: true, numeric: true },
  { id: "price", header: "السعر (ج.م)", cell: (r) => r.price, sortable: true, numeric: true },
];

function sortRows(rows: Row[], sort: SortState | null): Row[] {
  if (!sort) return rows;
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sort.columnId as keyof Row];
    const bv = b[sort.columnId as keyof Row];
    return av < bv ? -dir : av > bv ? dir : 0;
  });
}

const meta: Meta<typeof DataTable<Row>> = {
  title: "Data display/DataTable",
  component: DataTable,
};
export default meta;
type S = StoryObj<typeof DataTable<Row>>;

export const Sortable: S = {
  render: () => {
    const [sort, setSort] = React.useState<SortState | null>({ columnId: "qty", direction: "desc" });
    return (
      <DataTable
        caption="مخزون الأصناف"
        columns={columns}
        rows={sortRows(data, sort)}
        getRowId={(r) => r.id}
        sort={sort}
        onSortChange={setSort}
      />
    );
  },
};

export const StickyHeader: S = {
  render: () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: String(i), variety: `صنف ${i + 1}`, qty: (i * 13) % 300, price: 20 + (i % 9) * 5,
    }));
    const [sort, setSort] = React.useState<SortState | null>(null);
    return (
      <DataTable
        caption="جدول طويل (رأس ثابت)"
        columns={columns}
        rows={sortRows(many, sort)}
        getRowId={(r) => r.id}
        sort={sort}
        onSortChange={setSort}
        stickyHeader
      />
    );
  },
};

export const Empty: S = {
  render: () => (
    <DataTable
      caption="مخزون الأصناف"
      columns={columns}
      rows={[]}
      getRowId={(r) => r.id}
      empty="لا توجد أصناف مسجلة بعد"
    />
  ),
};

export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 24 }}>
      <DataTable caption="جدول مرتّب" columns={columns} rows={data} getRowId={(r) => r.id}
        sort={{ columnId: "price", direction: "asc" }} onSortChange={() => {}} />
      <DataTable caption="جدول فارغ" columns={columns} rows={[]} getRowId={(r) => r.id} empty="لا توجد بيانات" />
    </div>
  ),
};
