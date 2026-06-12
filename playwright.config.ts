import { defineConfig } from "@playwright/test";

/** Playwright-Electron E2E suite (Phase 4+): echo-demo against the mock peer. */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // One Electron app at a time; the suite is small and shares no state anyway.
  workers: 1,
});
