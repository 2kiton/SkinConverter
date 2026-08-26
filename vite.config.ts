/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Pixel tests need a real browser; see vitest.browser.config.ts.
    exclude: ["tests/**/*.browser.test.ts", "node_modules/**"],
  },
});
