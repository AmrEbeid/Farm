import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pagination } from "./Pagination";

const meta: Meta<typeof Pagination> = {
  title: "Data display/Pagination",
  component: Pagination,
};
export default meta;
type S = StoryObj<typeof Pagination>;

export const Default: S = {
  render: () => {
    const [page, setPage] = React.useState(2);
    return <Pagination page={page} pageCount={6} onChange={setPage} ariaLabel="ترقيم الصفحات" prevLabel="السابق" nextLabel="التالي" />;
  },
};
export const FirstPage: S = {
  render: () => {
    const [page, setPage] = React.useState(1);
    return <Pagination page={page} pageCount={4} onChange={setPage} ariaLabel="ترقيم" prevLabel="السابق" nextLabel="التالي" />;
  },
};
export const Gallery: S = {
  render: () => {
    const [page, setPage] = React.useState(3);
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <Pagination page={page} pageCount={5} onChange={setPage} ariaLabel="ترقيم" prevLabel="السابق" nextLabel="التالي" />
      </div>
    );
  },
};
