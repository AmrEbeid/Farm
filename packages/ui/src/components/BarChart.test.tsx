import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { ThemeProvider } from "../theme";
import { BarChart } from "./BarChart";

const data = [
  { شهر: "يناير", إنتاج: 120 },
  { شهر: "فبراير", إنتاج: 180 },
  { شهر: "مارس", إنتاج: 90 },
];

function Sample() {
  return (
    <ThemeProvider>
      <BarChart
        data={data}
        categoryKey="شهر"
        series={[{ dataKey: "إنتاج", name: "الإنتاج (كجم)" }]}
        ariaLabel="إنتاج التمور الشهري بالكيلوجرام"
        tableFallback={{ caption: "إنتاج شهري", columnHeader: "الشهر" }}
      />
    </ThemeProvider>
  );
}

describe("BarChart", () => {
  it("renders a labelled img region", () => {
    render(<Sample />);
    expect(screen.getByRole("img", { name: "إنتاج التمور الشهري بالكيلوجرام" })).toBeInTheDocument();
  });

  it("emits a visually-hidden data-table fallback", () => {
    render(<Sample />);
    expect(screen.getByText("إنتاج شهري")).toBeInTheDocument();
    expect(screen.getByText("فبراير")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Sample />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
