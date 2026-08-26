/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

/**
 * Canvas only exists in a browser, so `src/lib/convert/images.ts` cannot be
 * covered by the Node suite. This project runs the pixel-level tests in real
 * Chromium; everything else stays in the fast Node run.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
