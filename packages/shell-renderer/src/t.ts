/**
 * The renderer i18n layer (Phase 9, FR-9.1): hu default, en on switch. The
 * active locale is a process-global the whole component tree reads through
 * `t`/`localized`; `App` sets it from persisted settings on boot and on the
 * settings-menu language switch, then re-renders the tree so every call site
 * re-reads it. Boring on purpose: a JSON catalog and a lookup, no runtime
 * translation service.
 */
import { en } from "./messages.js";

export type Locale = "hu" | "en";

let activeLocale: Locale = "hu";

/** Set the active UI locale; the next render reads it (App drives this). */
export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

export function getActiveLocale(): Locale {
  return activeLocale;
}

/**
 * Translate a Hungarian source literal. Under hu the literal is returned as-is
 * (it is both key and value); under en the catalog entry is used, falling back
 * to the hu literal when a key is missing so a gap degrades to Hungarian rather
 * than a blank or a raw marker.
 */
export function t(hu: string): string {
  if (activeLocale === "en") return en[hu] ?? hu;
  return hu;
}

/** Picks a manifest-localized string for the active locale; hu is the fallback (FR-9.1). */
export function localized(value: { hu: string; en?: string }): string {
  if (activeLocale === "en") return value.en ?? value.hu;
  return value.hu;
}
