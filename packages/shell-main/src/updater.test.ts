import { describe, expect, test } from "vitest";
import { ShellUpdater, type AutoUpdaterLike, type UpdaterLogEntry } from "./updater.js";

// electron-updater can only be fully exercised on a packaged build (proven in
// Phase 11). Here we inject a fake AppUpdater and test the surrounding policy
// wiring: per-channel feed URL + apply-on-restart only + non-fatal errors.
class FakeAutoUpdater implements AutoUpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  feed?: { provider: "generic"; url: string };
  checkCalls = 0;
  quitAndInstallCalls = 0;
  private listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  rejectCheck = false;

  setFeedURL(options: { provider: "generic"; url: string }): void {
    this.feed = options;
  }
  async checkForUpdates(): Promise<unknown> {
    this.checkCalls++;
    if (this.rejectCheck) throw new Error("network down");
    return {};
  }
  quitAndInstall(): void {
    this.quitAndInstallCalls++;
  }
  on(event: string, listener: (...args: unknown[]) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const l of this.listeners.get(event) ?? []) l(...args);
  }
}

describe("ShellUpdater (electron-updater wiring, FR-8.2/8.6)", () => {
  test("start() points the updater at the per-channel feed and arms apply-on-restart", () => {
    const auto = new FakeAutoUpdater();
    new ShellUpdater({ autoUpdater: auto, feedUrl: "https://feed.example/stable" }).start();

    expect(auto.feed).toEqual({ provider: "generic", url: "https://feed.example/stable" });
    // Apply on next quit/restart, never mid-session (FR-8.2).
    expect(auto.autoInstallOnAppQuit).toBe(true);
    expect(auto.quitAndInstallCalls).toBe(0);
  });

  test("a downloaded update is never force-installed mid-session; it waits for quit", () => {
    const auto = new FakeAutoUpdater();
    const updater = new ShellUpdater({ autoUpdater: auto, feedUrl: "https://feed.example/stable" });
    updater.start();

    auto.emit("update-downloaded", { version: "9.9.9" });

    expect(updater.isUpdateReady()).toBe(true);
    expect(auto.quitAndInstallCalls).toBe(0);
  });

  test("a failed check is non-fatal and logged (FR-8.6)", async () => {
    const auto = new FakeAutoUpdater();
    auto.rejectCheck = true;
    const log: UpdaterLogEntry[] = [];
    const updater = new ShellUpdater({
      autoUpdater: auto,
      feedUrl: "https://feed.example/stable",
      log: (e) => log.push(e),
    });
    updater.start();

    const result = await updater.check();

    expect(result.status).toBe("error");
    expect(log.some((e) => e.event === "error")).toBe(true);
  });

  test("an updater 'error' event is logged rather than crashing the app (FR-8.6)", () => {
    const auto = new FakeAutoUpdater();
    const log: UpdaterLogEntry[] = [];
    new ShellUpdater({
      autoUpdater: auto,
      feedUrl: "https://feed.example/stable",
      log: (e) => log.push(e),
    }).start();

    auto.emit("error", new Error("signature mismatch"));

    expect(log.some((e) => e.event === "error" && e.message === "signature mismatch")).toBe(true);
  });
});
