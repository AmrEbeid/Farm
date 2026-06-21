import type { Preview } from "@storybook/react";
import "../src/styles/index.css";

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: { default: "farm-bg", values: [{ name: "farm-bg", value: "#f3f6f3" }, { name: "surface", value: "#ffffff" }] },
  },
  globalTypes: {
    direction: { description: "Text direction", defaultValue: "rtl",
      toolbar: { title: "Direction", icon: "transfer", items: [{ value: "rtl", title: "RTL (عربي)" }, { value: "ltr", title: "LTR" }] } },
  },
  decorators: [
    (Story, ctx) => {
      const dir = ctx.globals.direction || "rtl";
      document.documentElement.setAttribute("dir", dir);
      document.documentElement.setAttribute("lang", dir === "rtl" ? "ar" : "en");
      return Story();
    },
  ],
};
export default preview;
