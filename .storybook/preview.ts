import type { Preview } from "@storybook/react";
import * as React from "react";
import { ThemeProvider } from "../src/theme";
import "../src/styles/index.css";

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: { default: "farm-bg", values: [{ name: "farm-bg", value: "#f3f6f3" }, { name: "surface", value: "#ffffff" }] },
  },
  globalTypes: {
    direction: { description: "Text direction", defaultValue: "rtl",
      toolbar: { title: "Direction", icon: "transfer", items: [{ value: "rtl", title: "RTL (عربي)" }, { value: "ltr", title: "LTR" }] } },
    scheme: { description: "Color scheme", defaultValue: "light",
      toolbar: { title: "Scheme", icon: "circlehollow", items: [{ value: "light", title: "Light" }, { value: "dark", title: "Dark" }] } },
    density: { description: "Control density", defaultValue: "comfortable",
      toolbar: { title: "Density", icon: "component", items: [{ value: "comfortable", title: "Comfortable" }, { value: "compact", title: "Compact" }] } },
  },
  decorators: [
    (Story, ctx) => {
      const dir = ctx.globals.direction || "rtl";
      document.documentElement.setAttribute("dir", dir);
      document.documentElement.setAttribute("lang", dir === "rtl" ? "ar" : "en");
      const { scheme = "light", density = "comfortable" } = ctx.globals;
      return React.createElement(ThemeProvider, { scheme, density, children: React.createElement(Story) });
    },
  ],
};
export default preview;
