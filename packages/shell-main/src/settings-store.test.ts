import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SettingsStore } from "./settings-store.js";

// A fresh SettingsStore on the same directory is the simulated app relaunch
// (PRD State: settings are plain JSON in app data); anything readable hit disk.
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "foreman-settings-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("SettingsStore locale persistence (Phase 9, FR-9.1)", () => {
  test("a fresh store reports the supplied default locale", () => {
    expect(new SettingsStore(dir, { locale: "hu" }).getSettings()).toEqual({ locale: "hu" });
  });

  test("the manifest default carries through when nothing is persisted", () => {
    expect(new SettingsStore(dir, { locale: "en" }).getSettings()).toEqual({ locale: "en" });
  });

  test("a set locale survives a restart and overrides the default", () => {
    new SettingsStore(dir, { locale: "hu" }).setLocale("en");

    expect(new SettingsStore(dir, { locale: "hu" }).getSettings()).toEqual({ locale: "en" });
  });

  test("a corrupt settings file falls back to the default rather than throwing", () => {
    writeFileSync(join(dir, "settings.json"), "{ not valid json");
    expect(new SettingsStore(dir, { locale: "hu" }).getSettings()).toEqual({ locale: "hu" });
  });
});
