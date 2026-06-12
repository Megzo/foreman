/**
 * The app manifest (FR-1.1) — the fields Phase 3 consumes (identity, branding,
 * locale, task launcher data). Later phases extend this (form schemas, policy,
 * secrets, binaries, update channels) and must extend validation with it.
 *
 * Node-free on purpose: the renderer type-imports these via the IPC contract.
 */

/** hu is the default locale (FR-9.1); en optional until Phase 9. */
export interface LocalizedString {
  hu: string;
  en?: string;
}

export interface ManifestBranding {
  productName: string;
  icon?: string;
  colors: {
    primary: string;
    background?: string;
    accent?: string;
  };
}

export interface ManifestSkillRef {
  name: string;
  path: string;
}

export interface ManifestTask {
  id: string;
  label: LocalizedString;
  description?: LocalizedString;
  skill: ManifestSkillRef;
}

export interface AppManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  locale?: "hu" | "en";
  branding: ManifestBranding;
  tasks: ManifestTask[];
}
