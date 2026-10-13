/**
 * The shell-binary update layer (FR-8.2/8.6). electron-updater drives the actual
 * download+install, but it only runs against a packaged, code-signed build, so
 * this wrapper owns the *policy* — per-channel feed URL, apply-on-restart only,
 * failures non-fatal — and is fully unit-tested against an injected fake. main.ts
 * passes the real electron-updater `autoUpdater`; Phase 11 proves it end to end
 * on Windows.
 */

/** The slice of electron-updater's AppUpdater this wrapper drives. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL(options: { provider: "generic"; url: string }): void;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: string, listener: (...args: any[]) => void): void;
}

export type UpdaterEvent = "available" | "ready" | "error";

export interface UpdaterLogEntry {
  event: UpdaterEvent;
  version?: string;
  message?: string;
}

export interface ShellUpdaterOptions {
  autoUpdater: AutoUpdaterLike;
  /** Per-channel static feed URL (provisioner-selected channel). */
  feedUrl: string;
  log?: (entry: UpdaterLogEntry) => void;
}

export class ShellUpdater {
  private ready = false;

  constructor(private readonly options: ShellUpdaterOptions) {}

  /** Configure the feed + apply-on-restart policy and wire event logging. */
  start(): void {
    const { autoUpdater, feedUrl } = this.options;
    autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
    // Download in the background, but never interrupt the session — the new
    // binary installs when the user next quits (FR-8.2).
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("update-available", (info: { version?: string }) =>
      this.options.log?.({ event: "available", version: info?.version }),
    );
    autoUpdater.on("update-downloaded", (info: { version?: string }) => {
      this.ready = true;
      this.options.log?.({ event: "ready", version: info?.version });
    });
    autoUpdater.on("error", (error: Error) =>
      this.options.log?.({ event: "error", message: error?.message ?? String(error) }),
    );
  }

  /** Trigger a check; non-fatal — a failure logs and returns an error result. */
  async check(): Promise<{ status: "checking" | "error" }> {
    try {
      await this.options.autoUpdater.checkForUpdates();
      return { status: "checking" };
    } catch (error) {
      this.options.log?.({ event: "error", message: (error as Error).message });
      return { status: "error" };
    }
  }

  /** True once a new binary is downloaded and queued to install on restart. */
  isUpdateReady(): boolean {
    return this.ready;
  }
}
