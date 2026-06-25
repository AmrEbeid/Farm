import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(tsx|ts)"],
  // Storybook 9+ folded the essentials addons (controls, actions, backgrounds,
  // viewport, docs, measure, outline) into the core `storybook` package, so
  // `@storybook/addon-essentials` no longer exists as a separate dependency.
  addons: [],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
};
export default config;
