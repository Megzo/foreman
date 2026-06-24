import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppSettings } from "./ipc.js";

/**
 * Local, file-based user settings (PRD State / FR-9.1): a single small JSON file
 * in app data. v1 carries only the locale override; the manifest's `locale`
 * supplies the default, and an explicit choice in the settings menu overrides
 * it and survives restarts. Synchronous and fail-soft like the other fs stores
 * — a missing or corrupt file degrades to the default, never blocking boot.
 */
export class SettingsStore {
  private readonly file: string;
  private data: SettingsFile;

  constructor(
    private readonly dir: string,
    private readonly defaults: AppSettings,
  ) {
    this.file = join(dir, "settings.json");
    this.data = this.read();
  }

  getSettings(): AppSettings {
    return { locale: this.data.locale ?? this.defaults.locale };
  }

  setLocale(locale: AppSettings["locale"]): void {
    this.data.locale = locale;
    this.write();
  }

  private read(): SettingsFile {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as SettingsFile;
      if (parsed.schemaVersion === SETTINGS_SCHEMA_VERSION) return parsed;
    } catch {
      // Missing or corrupt settings — fall back to defaults; a bad file must
      // never block startup (the only thing it held is a recoverable override).
    }
    return { schemaVersion: SETTINGS_SCHEMA_VERSION };
  }

  private write(): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}

const SETTINGS_SCHEMA_VERSION = 1 as const;

interface SettingsFile {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  locale?: AppSettings["locale"];
}
