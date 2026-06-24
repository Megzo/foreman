import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

/**
 * Shell flows end to end against the mock peer (no tokens, no network).
 * Phase 4: branded login -> home -> launcher -> param form -> streamed run
 * view -> success state. Phase 6: chat steering, cancel-with-confirmation and
 * the requestUserInput modal. Phase 7: kill mid-run -> relaunch -> resume.
 * Requires `electron-vite build` output (pnpm e2e does this) and a display
 * (WSLg/X11).
 */

const MAIN_ENTRY = resolve(import.meta.dirname, "../packages/shell-main/out/main/main.js");

let app: ElectronApplication;
let window: Page;

/** Launch; pass a userData dir to share state across relaunch (else isolated). */
async function launch(scenario?: string, userData?: string): Promise<string> {
  const dir = userData ?? mkdtempSync(join(tmpdir(), "foreman-e2e-"));
  app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      FOREMAN_MOCK_PEER: "1",
      ...(scenario ? { FOREMAN_MOCK_SCENARIO: scenario } : {}),
      FOREMAN_USER_DATA: dir,
    },
  });
  window = await app.firstWindow();
  return dir;
}

/** Home -> launcher -> form -> running view (scenarios that boot signed in). */
async function startEchoRun(message: string): Promise<void> {
  await window.getByRole("button", { name: /Visszhang futtatása/ }).click();
  await window.getByRole("textbox", { name: /Üzenet/ }).fill(message);
  await window.getByRole("button", { name: /Indítás/ }).click();
}

test.afterEach(async () => {
  await app.close();
});

test("launch -> login -> form -> streamed run -> success (the Phase 4 acceptance flow)", async () => {
  await launch();

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

test("chat mid-run appears in the transcript and steers the turn (Phase 6, FR-4.3)", async () => {
  // The steerable peer keeps the turn open until a turn/steer arrives, then
  // echoes the steer input back as the agent message and completes.
  await launch("steerable");
  await startEchoRun("szia");

  await expect(window.getByTestId("run-status")).toHaveText(/Folyamatban/);
  await window.getByRole("textbox", { name: /Üzenet a feladatnak/ }).fill("használj magázódást");
  await window.getByRole("button", { name: /Üzenet küldése/ }).click();

  // The user's message shows in the task-scoped transcript...
  await expect(window.getByTestId("chat-transcript")).toContainText("használj magázódást");
  // ...and the peer's echo proves it arrived via turn/steer on the open turn.
  await expect(window.getByTestId("run-message")).toContainText("használj magázódást");
  await expect(window.getByTestId("run-success")).toBeVisible();
});

test("cancel asks for confirmation and lands in the cancelled state (Phase 6, FR-4.5/4.6)", async () => {
  await launch("steerable");
  await startEchoRun("szia");

  await window.getByRole("button", { name: /Megszakítás/ }).click();
  await expect(window.getByText(/Biztosan megszakítod/)).toBeVisible();
  await window.getByRole("button", { name: /Igen, megszakítom/ }).click();

  await expect(window.getByTestId("run-cancelled")).toBeVisible();
});

test("an agent question renders as a native form and the answer reaches the skill (Phase 6, FR-4.4)", async () => {
  // The user-input peer asks a question mid-turn and echoes the client's
  // answers back as the agent message before completing.
  await launch("user-input");
  await startEchoRun("szia");

  await window.getByRole("radio", { name: /Informális/ }).check();
  await window.getByRole("button", { name: /Küldés/ }).click();

  await expect(window.getByTestId("run-message")).toContainText("Informális");
  await expect(window.getByTestId("run-success")).toBeVisible();
});

test("switching the locale persists across relaunch (Phase 9, FR-9.1)", async () => {
  // Boot in the hu default, sign in, then switch to English from the settings menu.
  const userData = await launch();
  await window.getByRole("button", { name: /Bejelentkezés ChatGPT/ }).click();
  await window.getByRole("button", { name: "Beállítások" }).click();
  await window.getByRole("button", { name: "English" }).click();

  // The whole UI re-renders in English immediately.
  await expect(window.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(window.getByText("Recent tasks")).toBeVisible();
  await app.close();

  // Relaunch on the SAME userData: the persisted locale is applied at boot, so
  // even the login screen comes up in English (FR-9.1).
  await launch(undefined, userData);
  await window.getByRole("button", { name: /Sign in with your ChatGPT account/ }).click();
  await expect(window.getByRole("button", { name: "Settings" })).toBeVisible();
});

test("kill mid-run, relaunch, resume continues to success and the run is in history (Phase 7, FR-7.2/7.3)", async () => {
  // First boot: start a run whose turn stays open (steerable), so killing the
  // app leaves a persisted "running" record with its thread id — exactly the
  // crash the resume offer recovers from.
  const userData = await launch("steerable");
  await startEchoRun("szia");

  // Wait for the persisted record to carry its thread id (FR-7.1 artifact) —
  // the resume precondition — then hard-kill the app, mid-run.
  const indexFile = join(userData, "sessions", "index.json");
  await expect
    .poll(() => {
      try {
        const index = JSON.parse(readFileSync(indexFile, "utf8")) as {
          runs: Array<{ status: string; threadId?: string }>;
        };
        return index.runs.some((run) => run.status === "running" && run.threadId !== undefined);
      } catch {
        return false;
      }
    })
    .toBe(true);
  await app.close();

  // Relaunch on the SAME userData. The peer now completes turns ("happy"), so
  // the resumed turn runs to success.
  await launch("happy", userData);

  // The crashed run is offered for resume; accepting continues it to success.
  await window.getByRole("button", { name: /Folytatás/ }).click();
  await expect(window.getByTestId("run-message")).toHaveText("SPIKE_OK");
  await expect(window.getByTestId("run-success")).toBeVisible();

  // Back on the home screen the run now appears in history as finished.
  await window.getByRole("button", { name: /Vissza/ }).click();
  await expect(window.getByTestId("run-history")).toContainText("Kész");
});
