import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { ThemeProvider } from "../theme";
import { LineChart } from "./LineChart";

const data = [
  { أسبوع: "1", رطوبة: 41 },
  { أسبوع: "2", رطوبة: 38 },
  { أسبوع: "3", رطوبة: 44 },
];

function Sample() {
  return (
    <ThemeProvider scheme="dark">
      <LineChart
        data={data}
        categoryKey="أسبوع"
        series={[{ dataKey: "رطوبة", name: "الرطوبة %" }]}
        ariaLabel="رطوبة التربة الأسبوعية بالنسبة المئوية"
        tableFallback={{ caption: "الرطوبة الأسبوعية", columnHeader: "الأسبوع" }}
      />
    </ThemeProvider>
  );
}

describe("LineChart", () => {
  it("renders a labelled img region", () => {
    render(<Sample />);
    expect(screen.getByRole("img", { name: "رطوبة التربة الأسبوعية بالنسبة المئوية" })).toBeInTheDocument();
  });

  it("emits a data-table fallback", () => {
    render(<Sample />);
    expect(screen.getByText("الرطوبة الأسبوعية")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Sample />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
