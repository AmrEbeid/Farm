import type { Preview } from "@storybook/react-vite";
import * as React from "react";
import { ThemeProvider } from "../src/theme";
import "../src/styles/index.css";

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    // Storybook 9+ replaced the `values` array + `default` key with an `options`
    // map keyed by id; the active background moves to `initialGlobals` below.
    backgrounds: {
      options: {
        "farm-bg": { name: "farm-bg", value: "#f3f6f3" },
        surface: { name: "surface", value: "#ffffff" },
      },
    },
  },
  // Storybook 9+ deprecates `globalTypes.defaultValue`; initial global values
  // (direction/scheme/density + the default background) live here instead.
  initialGlobals: {
    direction: "rtl",
    scheme: "light",
    density: "comfortable",
    backgrounds: { value: "farm-bg" },
  },
  globalTypes: {
    direction: { description: "Text direction",
      toolbar: { title: "Direction", icon: "transfer", items: [{ value: "rtl", title: "RTL (عربي)" }, { value: "ltr", title: "LTR" }] } },
    scheme: { description: "Color scheme",
      toolbar: { title: "Scheme", icon: "circlehollow", items: [{ value: "light", title: "Light" }, { value: "dark", title: "Dark" }] } },
    density: { description: "Control density",
      toolbar: { title: "Control density", icon: "component", items: [{ value: "comfortable", title: "Comfortable" }, { value: "compact", title: "Compact" }] } },
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
