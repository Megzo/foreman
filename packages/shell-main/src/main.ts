import { join, resolve } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { CodexAdapter, type AgentAdapter } from "@foreman/codex-adapter";
import { AuthController } from "./auth-controller.js";
import { codexHomePath } from "./codex-home.js";
import type { AuthState, BootState } from "./ipc.js";
import { ManifestLoader } from "./manifest.js";

/**
 * Electron main entry. Boot order (FR-1.1/1.2, FR-3.1):
 *   load manifest -> (on failure: error window) -> spawn adapter with the
 *   app-scoped CODEX_HOME -> read account -> stream auth state to renderer.
 *
 * Dev knobs:
 *   FOREMAN_MANIFEST   path to the app manifest (default: apps/echo-demo)
 *   FOREMAN_MOCK_PEER  "1" runs the scripted mock peer instead of real codex,
 *                      so UI work is fully offline and burns no tokens.
 */

function manifestPath(): string {
  return (
    process.env.FOREMAN_MANIFEST ??
    resolve(app.getAppPath(), "../../apps/echo-demo/manifest.json")
  );
}

function makeAdapter(): AgentAdapter {
  if (process.env.FOREMAN_MOCK_PEER === "1") {
    const mockPeer = resolve(
      app.getAppPath(),
      "../codex-adapter/test/fixtures/mock-peer.mjs",
    );
    return new CodexAdapter({
      command: { bin: process.execPath, args: [mockPeer, "signed-out"] },
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
    bootState = { ok: true, manifest, shellVersion: app.getVersion() };
  } catch (error) {
    bootState = { ok: false, error: (error as Error).message };
  }

  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    title: bootState.ok ? bootState.manifest.branding.productName : "Foreman",
    backgroundColor: bootState.ok
      ? (bootState.manifest.branding.colors.background ?? "#ffffff")
      : "#ffffff",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      // ESM preload scripts require an unsandboxed renderer (Electron docs);
      // contextIsolation stays on, and the renderer never gets Node access.
      sandbox: false,
    },
  });

  ipcMain.handle("shell:getBootState", () => bootState);

  if (bootState.ok) {
    const adapter = makeAdapter();
    const auth = new AuthController({
      adapter,
      openExternal: (url) => void shell.openExternal(url),
    });
    auth.onChange((state) => window.webContents.send("shell:authState", state));
    ipcMain.handle("shell:getAuthState", () => auth.current);
    ipcMain.handle("shell:startLogin", (_event, type: "chatgpt" | "chatgptDeviceCode") =>
      auth.startLogin(type),
    );
    ipcMain.handle("shell:cancelLogin", () => auth.cancelLogin());
    ipcMain.handle("shell:logout", () => auth.logout());
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
