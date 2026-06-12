import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

/**
 * The Phase 4 tracer bullet, end to end against the mock peer (no tokens, no
 * network): branded login -> home -> launcher -> param form -> streamed run
 * view -> success state. Requires `electron-vite build` output (pnpm e2e does
 * this) and a display (WSLg/X11).
 */

const MAIN_ENTRY = resolve(import.meta.dirname, "../packages/shell-main/out/main/main.js");

let app: ElectronApplication;
let window: Page;

test.beforeEach(async () => {
  app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      FOREMAN_MOCK_PEER: "1",
      // Isolate userData (workspace, provisioning state) per run.
      FOREMAN_USER_DATA: mkdtempSync(join(tmpdir(), "foreman-e2e-")),
    },
  });
  window = await app.firstWindow();
});

test.afterEach(async () => {
  await app.close();
});

test("launch -> login -> form -> streamed run -> success (the Phase 4 acceptance flow)", async () => {
  // Mock peer boots signed out; its "user" completes OAuth instantly on login.
  await window.getByRole("button", { name: /Bejelentkezés ChatGPT/ }).click();

  // Home: the echo-demo launcher card.
  await window.getByRole("button", { name: /Visszhang futtatása/ }).click();

  // Param form from the manifest schema; required field gates the start button.
  const start = window.getByRole("button", { name: /Indítás/ });
  await expect(start).toBeDisabled();
  await window.getByRole("textbox", { name: /Üzenet/ }).fill("szia világ");
  await expect(start).toBeEnabled();
  await start.click();

  // Running view: the mock peer streams SPIKE_OK deltas, then completes.
  await expect(window.getByTestId("run-message")).toHaveText("SPIKE_OK");
  await expect(window.getByTestId("run-success")).toBeVisible();

  // Back to the launchers.
  await window.getByRole("button", { name: /Vissza/ }).click();
  await expect(window.getByRole("button", { name: /Visszhang futtatása/ })).toBeVisible();
});
