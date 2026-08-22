import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    include: ["lib/**/*.test.ts", "lib/**/tests/**/*.ts", "components/**/*.test.tsx", "components/**/*.test.ts"],
    environment: "node",
  },
});
