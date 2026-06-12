/**
 * i18n stub (Phase 3): hardcoded Hungarian routed through one function so the
 * Phase 9 i18n sweep is mechanical. Every user-facing string must pass through
 * here — never inline literals in components.
 */
export function t(hu: string): string {
  return hu;
}

/** Picks a manifest-localized string; hu is the default locale (FR-9.1). */
export function localized(value: { hu: string; en?: string }): string {
  return value.hu;
}
