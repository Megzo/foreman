import { join } from "node:path";

/**
 * The app-scoped CODEX_HOME (FR-3.5): always a subdirectory of the app's
 * user-data dir, so Foreman apps never share or disturb a developer's ~/.codex.
 * CodexAdapter creates the directory before spawn (Phase 2 finding F-2).
 */
export function codexHomePath(userDataDir: string): string {
  return join(userDataDir, "codex-home");
}
