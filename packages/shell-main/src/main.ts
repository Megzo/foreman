import { dirname, join, resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { CodexAdapter, type AgentAdapter } from "@foreman/codex-adapter";
import { AuthController } from "./auth-controller.js";
import { checkBinaries } from "./binary-health.js";
import { codexHomePath } from "./codex-home.js";
import { DecisionLog } from "./decision-log.js";
import type {
  AuthState,
  BootState,
  TaskParamValues,
  UserInputAnswers,
  UserInputRequestPayload,
} from "./ipc.js";
import { ManifestLoader } from "./manifest.js";
import { SessionStore } from "./session-store.js";
import { SettingsStore } from "./settings-store.js";
import { TaskRunner } from "./task-runner.js";
import { WorkspaceProvisioner } from "./workspace.js";

/**
 * Electron main entry. Boot order (FR-1.1/1.2, FR-3.1):
 *   load manifest -> (on failure: error window) -> spawn adapter with the
 *   app-scoped CODEX_HOME -> read account -> stream auth state to renderer.
 *
 * Dev knobs:
 *   FOREMAN_MANIFEST       path to the app manifest (default: apps/echo-demo)
 *   FOREMAN_MOCK_PEER      "1" runs the scripted mock peer instead of real
 *                          codex, so UI work is fully offline and burns no tokens.
 *   FOREMAN_MOCK_SCENARIO  mock-peer scenario (default "signed-out"); E2E uses
 *                          "steerable"/"user-input" for the Phase 6 flows.
 *   FOREMAN_USER_DATA      override the userData dir (E2E isolation).
 */

// WSL/headless Linux has no D-Bus session bus or dconf daemon, so GLib/GIO
// (which shell.openPath and GTK go through) floods stderr with
// "failed to commit changes to dconf" on every file-manager call. Point GSettings
// at the in-memory backend and skip the accessibility bridge so dev on WSL is
// quiet. Linux-only and a no-op on the Windows/macOS targets, where these
// integrations exist for real.
if (process.platform === "linux") {
  process.env.GSETTINGS_BACKEND ??= "memory";
  process.env.NO_AT_BRIDGE ??= "1";
}

if (process.env.FOREMAN_USER_DATA) {
  app.setPath("userData", process.env.FOREMAN_USER_DATA);
}

// Resolve dev fixtures relative to the bundled entry (<pkg>/out/main/), which
// is stable across `electron-vite dev` and a direct `electron out/main/main.js`
// launch (E2E) — app.getAppPath() is not.
function manifestPath(): string {
  return (
    process.env.FOREMAN_MANIFEST ??
    resolve(import.meta.dirname, "../../../../apps/echo-demo/manifest.json")
  );
}

function makeAdapter(): AgentAdapter {
  if (process.env.FOREMAN_MOCK_PEER === "1") {
    const mockPeer = resolve(
      import.meta.dirname,
      "../../../codex-adapter/test/fixtures/mock-peer.mjs",
    );
    return new CodexAdapter({
      command: {
        bin: process.execPath,
        args: [mockPeer, process.env.FOREMAN_MOCK_SCENARIO ?? "signed-out"],
      },
      // In Electron, execPath is the Electron binary; run the peer as plain Node.
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
  }
  return new CodexAdapter({ codexHome: codexHomePath(app.getPath("userData")) });
}

async function boot(): Promise<void> {
  let bootState: BootState;
  try {
    const manifest = await new ManifestLoader().load(manifestPath());
    // The manifest's bundled tools must be on PATH or the app can't work
    // (PRD Integration); a miss blocks startup with a friendly repair message.
    const health = await checkBinaries(manifest.binaries ?? []);
    bootState = health.ok
      ? { ok: true, manifest, shellVersion: app.getVersion() }
      : { ok: false, error: health.message ?? "missing required tools" };
  } catch (error) {
    bootState = { ok: false, error: (error as Error).message };
  }

  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    title: bootState.ok ? bootState.manifest.branding.productName : "Foreman",
    // Warm paper to match the renderer's first paint (no cold flash); the brand
    // atmosphere layers on top in CSS.
    backgroundColor: "#f1ebe0",
    // Hide the desktop menu bar (Alt reveals it) — keeps edit accelerators but
    // drops the coding-tool chrome; this is a consumer app (PRD UX).
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      // ESM preload scripts require an unsandboxed renderer (Electron docs);
      // contextIsolation stays on, and the renderer never gets Node access.
      sandbox: false,
    },
  });

  ipcMain.handle("shell:getBootState", () => bootState);

  // Persisted settings (FR-9.1): the manifest's locale is the default; an
  // explicit choice in the settings menu overrides it and survives restarts.
  // Registered regardless of boot success so the renderer's first paint can
  // always read a locale.
  const settings = new SettingsStore(app.getPath("userData"), {
    locale: bootState.ok ? (bootState.manifest.locale ?? "hu") : "hu",
  });
  ipcMain.handle("shell:getSettings", () => settings.getSettings());
  ipcMain.handle("shell:setLocale", (_event, locale: "hu" | "en") => settings.setLocale(locale));

  if (bootState.ok) {
    const adapter = makeAdapter();
    const auth = new AuthController({
      adapter,
      // Return the promise so a rejection (no browser, e.g. WSL/headless) flows
      // through to browserOpened:false and the renderer shows the URL to copy.
      openExternal: (url) => shell.openExternal(url),
    });
    auth.onChange((state) => window.webContents.send("shell:authState", state));
    ipcMain.handle("shell:getAuthState", () => auth.current);
    ipcMain.handle("shell:startLogin", (_event, type: "chatgpt" | "chatgptDeviceCode") =>
      auth.startLogin(type),
    );
    ipcMain.handle("shell:cancelLogin", () => auth.cancelLogin());
    ipcMain.handle("shell:logout", () => auth.logout());

    // Task launch path (FR-4.1/4.2): provision once, lazily, before the first
    // launch; the runner then streams TaskEvents to the renderer.
    const manifest = bootState.manifest;
    const decisionLog = new DecisionLog(
      join(app.getPath("userData"), "logs", "policy-decisions.jsonl"),
    );
    // Persisted run history + resume index (FR-7.1). Survives restarts; a run
    // left "running" by an app crash is offered for resume on next launch.
    const sessionStore = new SessionStore(join(app.getPath("userData"), "sessions"));
    // requestUserInput correlation (FR-4.4): each agent question goes to the
    // renderer with a requestId; the modal's answer resolves the pending
    // promise, which becomes the JSON-RPC response back to codex.
    let nextUserInputId = 1;
    const pendingUserInputs = new Map<number, (answers: UserInputAnswers) => void>();
    let runnerPromise: Promise<TaskRunner> | undefined;
    const ensureRunner = () =>
      (runnerPromise ??= new WorkspaceProvisioner()
        .provision({
          manifest,
          appDir: dirname(manifestPath()),
          dataDir: app.getPath("userData"),
          codexHome: codexHomePath(app.getPath("userData")),
        })
        .then((workspace) => {
          const runner = new TaskRunner({
            adapter,
            manifest,
            workspace,
            store: sessionStore,
            // Finished outputs land in the user's Documents (FR-6.3).
            documentsDir: app.getPath("documents"),
            onPolicyDecision: (record) => decisionLog.append(record),
            onUserInput: (request) =>
              new Promise((resolve) => {
                const requestId = nextUserInputId++;
                pendingUserInputs.set(requestId, (answers) => resolve({ answers }));
                window.webContents.send("shell:userInputRequest", {
                  requestId,
                  questions: request.questions ?? [],
                } satisfies UserInputRequestPayload);
              }),
          });
          runner.onEvent((event) => window.webContents.send("shell:taskEvent", event));
          return runner;
        }));
    ipcMain.handle("shell:launchTask", async (_event, taskId: string, params: TaskParamValues) => {
      const runner = await ensureRunner();
      await runner.launch(taskId, params);
    });
    ipcMain.handle("shell:sendChat", async (_event, text: string) => {
      const runner = await ensureRunner();
      await runner.sendChat(text);
    });
    ipcMain.handle("shell:cancelTask", async () => {
      const runner = await ensureRunner();
      await runner.cancel();
    });
    ipcMain.handle(
      "shell:answerUserInput",
      (_event, requestId: number, answers: UserInputAnswers) => {
        const pending = pendingUserInputs.get(requestId);
        pendingUserInputs.delete(requestId);
        pending?.(answers);
      },
    );
    // "Open folder" on the success state opens the Documents output dir (FR-6.3).
    ipcMain.handle("shell:openOutputDir", (_event, dir: string) => shell.openPath(dir));
    ipcMain.handle("shell:pickFile", async (_event, extensions?: string[]) => {
      const result = await dialog.showOpenDialog(window, {
        properties: ["openFile"],
        filters: extensions?.length ? [{ name: "*", extensions }] : undefined,
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    });

    // Sessions, history and resume (FR-7.2/7.3).
    ipcMain.handle("shell:listRuns", () => sessionStore.listRuns());
    ipcMain.handle("shell:findResumable", () => sessionStore.findResumable() ?? null);
    ipcMain.handle("shell:resumeRun", async (_event, runId: string) => {
      const runner = await ensureRunner();
      await runner.resume(runId);
    });
    // Declining the offer finalizes the stale run so it is not re-offered.
    ipcMain.handle("shell:dismissResume", (_event, runId: string) =>
      sessionStore.finishRun(runId, "cancelled"),
    );
    // FR-2.5 one-click restart: re-spawn codex, restore the signed-in UI, then
    // resume the run the death interrupted via thread/resume.
    ipcMain.handle("shell:restartAgent", async () => {
      await adapter.start();
      await auth.initialize();
      const runner = await ensureRunner();
      const runId = runner.activeRunId();
      if (runId) await runner.resume(runId);
    });

    // A codex death after boot surfaces as the restart banner (FR-2.5 UI half).
    adapter.on("error", (payload) => {
      window.webContents.send("shell:authState", {
        status: "agentError",
        message: payload.message,
      } satisfies AuthState);
    });

    app.on("before-quit", () => void adapter.stop().catch(() => {}));

    try {
      await adapter.start();
      await auth.initialize();
    } catch (error) {
      window.webContents.send("shell:authState", {
        status: "agentError",
        message: (error as Error).message,
      } satisfies AuthState);
    }
  } else {
    ipcMain.handle("shell:getAuthState", (): AuthState => ({ status: "checking" }));
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(boot);
app.on("window-all-closed", () => app.quit());
