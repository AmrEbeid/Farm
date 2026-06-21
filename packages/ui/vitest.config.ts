import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    css: true,
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
  },
});
