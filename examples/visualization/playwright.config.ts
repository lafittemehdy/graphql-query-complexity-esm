/** Runs built visualization accessibility checks on a dedicated preview server. */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:4176/graphql-query-complexity-esm/",
    browserName: "chromium",
    reducedMotion: "reduce",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4176 --strictPort",
    url: "http://127.0.0.1:4176/graphql-query-complexity-esm/",
    reuseExistingServer: false,
  },
});
