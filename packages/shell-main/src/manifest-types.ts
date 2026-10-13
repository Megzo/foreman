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

/** The five param-form field types (FR-1.3). */
export type ManifestFieldType = "file" | "text" | "number" | "select" | "checkbox";

export interface ManifestFieldOption {
  value: string;
  label: LocalizedString;
}

export interface ManifestFormField {
  id: string;
  type: ManifestFieldType;
  label: LocalizedString;
  required?: boolean;
  default?: string | number | boolean;
  /** select only: the choices (required for select). */
  options?: ManifestFieldOption[];
  /** file only: extension filter without dots, e.g. ["pdf", "epub"]. */
  extensions?: string[];
}

/**
 * What a finished run presents (FR-1.3, FR-6.3): glob patterns, relative to the
 * workspace, selecting the output files copied to Documents on success.
 */
export interface ManifestCompletion {
  outputs: string[];
}

export interface ManifestTask {
  id: string;
  label: LocalizedString;
  description?: LocalizedString;
  skill: ManifestSkillRef;
  params?: ManifestFormField[];
  completion?: ManifestCompletion;
}

/** Sandbox mode for thread/start (FR-5.2, first leg of the policy). */
export type ManifestSandboxMode = "read-only" | "workspace-write";

/**
 * Baked approval policy (FR-5.2): anchored argv-prefix allowlists for command
 * approvals, a flag for file-change approvals. Everything unmatched is denied
 * (fail closed) — there is no way to express "allow everything".
 */
export interface ManifestPolicy {
  /** Patterns answered "accept": each is an argv prefix, e.g. ["python3"]. */
  allowCommands?: string[][];
  /** Hot-path patterns answered "acceptForSession" (one approval per session). */
  allowCommandsForSession?: string[][];
  /** When true, file-change requests scoped to the workspace are accepted. */
  allowFileChanges?: boolean;
}

/** One alternate update channel a provisioner can opt a machine into (FR-12). */
export interface ManifestChannel {
  /** App-bundle feed.json URL for this channel. */
  bundleFeedUrl?: string;
  /** Shell-binary (electron-updater) feed base URL for this channel. */
  shellFeedUrl?: string;
}

/**
 * Two-layer update config (FR-1.1, FR-8): the default channel's feed URLs plus
 * the Ed25519 public key bundles are verified against (FR-8.4 — in production
 * this key is compiled into the shell; the manifest carries it for dev/test).
 * Named `channels` let a provisioner pin a machine to e.g. "beta" via the local
 * update-channel config file, so an untested update never lands in production.
 */
export interface ManifestUpdates extends ManifestChannel {
  /** SPKI PEM public key used to verify downloaded app bundles (FR-8.4). */
  publicKey?: string;
  channels?: Record<string, ManifestChannel>;
}

export interface AppManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  locale?: "hu" | "en";
  branding: ManifestBranding;
  sandbox?: ManifestSandboxMode;
  policy?: ManifestPolicy;
  /** Executables that must be on PATH for the app to work (FR-1.1; health-checked at boot). */
  binaries?: string[];
  /** Update channel URLs + bundle verification key (FR-1.1, FR-8). */
  updates?: ManifestUpdates;
  tasks: ManifestTask[];
}
