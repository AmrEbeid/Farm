import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { ThemeProvider } from "../theme";
import { DoughnutChart } from "./DoughnutChart";

const data = [
  { name: "معتمد", value: 62 },
  { name: "قيد المراجعة", value: 24 },
  { name: "مرفوض", value: 14 },
];

function Sample() {
  return (
    <ThemeProvider>
      <DoughnutChart
        data={data}
        ariaLabel="توزيع حالات الطلبات"
        tableFallback={{ caption: "توزيع الحالات", labelHeader: "الحالة", valueHeader: "النسبة" }}
      />
    </ThemeProvider>
  );
}

describe("DoughnutChart", () => {
  it("renders a labelled img region", () => {
    render(<Sample />);
    expect(screen.getByRole("img", { name: "توزيع حالات الطلبات" })).toBeInTheDocument();
  });

  it("emits a data-table fallback with each slice", () => {
    render(<Sample />);
    expect(screen.getByText("توزيع الحالات")).toBeInTheDocument();
    expect(screen.getByText("قيد المراجعة")).toBeInTheDocument();
  });

  it("renders slice values as Arabic-Indic digits in the table fallback", () => {
    render(<Sample />);
    // 62 → ٦٢ ; no Western digits leak into the Arabic table.
    expect(screen.getByText("٦٢")).toBeInTheDocument();
    expect(screen.queryByText("62")).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Sample />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
