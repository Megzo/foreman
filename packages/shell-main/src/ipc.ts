/**
 * The typed main<->renderer IPC contract — the seam between the Electron main
 * process (which owns the manifest and the AgentAdapter) and the React
 * renderer (which only ever sees this surface). Event-streamy by design: the
 * task event stream of later phases rides the same shape.
 *
 * Node-free on purpose: the renderer type-imports this module
 * (`@foreman/shell-main/ipc`); the preload script implements it.
 */

import type { AppManifest } from "./manifest-types.js";

export type * from "./manifest-types.js";

/** Last-known `account/read` snapshot, for instant UI rendering (PRD State). */
export interface AccountInfo {
  type: string;
  email?: string;
  planType?: string;
}

/** The pending login flow as the login screen needs to render it (FR-3.2/3.3). */
export type LoginFlow =
  | { type: "chatgpt"; authUrl: string }
  | { type: "chatgptDeviceCode"; userCode: string; verificationUrl: string };

/** Screen-driving auth state, pushed from main to renderer. */
export type AuthState =
  | { status: "checking" }
  | { status: "signedOut" }
  | { status: "loginPending"; flow: LoginFlow }
  | { status: "loginFailed"; message: string }
  | { status: "signedIn"; account: AccountInfo }
  /** The codex process died or failed to start (FR-2.5 UI half lands in Phase 7). */
  | { status: "agentError"; message: string };

/** What the renderer needs at boot. Manifest failures arrive as ok:false (FR-1.2). */
export type BootState =
  | { ok: true; manifest: AppManifest; shellVersion: string }
  | { ok: false; error: string };

/** The values a submitted param form collects, keyed by field id (FR-1.3). */
export type TaskParamValues = Record<string, string | number | boolean>;

/** A run's terminal state (FR-4.6 — "cancelled" joins in Phase 6). */
export type RunTerminalStatus = "success" | "failed";

/** The task-run event stream the running view renders (Phase 4). */
export type TaskEvent =
  | { type: "runStarted"; taskId: string }
  | { type: "itemStarted"; itemType: string }
  | { type: "itemCompleted"; itemType: string }
  | { type: "agentDelta"; text: string }
  /** The policy denied an agent action; the run continues (FR-5.3). */
  | { type: "actionDenied"; kind: "commandExecution" | "fileChange" }
  | { type: "finished"; status: RunTerminalStatus; errorMessage?: string };

export interface ShellApi {
  getBootState(): Promise<BootState>;
  /** Subscribe to auth-state changes; the current state is replayed on subscribe. */
  onAuthState(handler: (state: AuthState) => void): () => void;
  /** Begin a login; main opens the authUrl in the system browser for the chatgpt flow. */
  startLogin(type: "chatgpt" | "chatgptDeviceCode"): Promise<void>;
  cancelLogin(): Promise<void>;
  logout(): Promise<void>;
  /** Provision (if needed) and start the task's skill turn (FR-4.1). */
  launchTask(taskId: string, params: TaskParamValues): Promise<void>;
  /** Subscribe to the task-run event stream. */
  onTaskEvent(handler: (event: TaskEvent) => void): () => void;
  /** Native file-picker for "file" form fields; null when the user cancels. */
  pickFile(extensions?: string[]): Promise<string | null>;
}
