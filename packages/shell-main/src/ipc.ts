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

/** A run's terminal state (FR-4.6). */
export type RunTerminalStatus = "success" | "failed" | "cancelled";

/** The task-run event stream the running view renders (Phase 4). */
export type TaskEvent =
  | { type: "runStarted"; taskId: string }
  | { type: "itemStarted"; itemType: string }
  | { type: "itemCompleted"; itemType: string }
  | { type: "agentDelta"; text: string }
  /** The policy denied an agent action; the run continues (FR-5.3). */
  | { type: "actionDenied"; kind: "commandExecution" | "fileChange" }
  | { type: "finished"; status: RunTerminalStatus; errorMessage?: string };

/** One selectable option of a user-input question (schema: ToolRequestUserInputOption). */
export interface UserInputOption {
  label: string;
  description?: string;
}

/** One `item/tool/requestUserInput` question as the modal renders it (FR-4.4). */
export interface UserInputQuestion {
  id: string;
  header?: string;
  question: string;
  options?: UserInputOption[] | null;
}

/** Protocol-shaped answers, keyed by question id (schema: ToolRequestUserInputResponse). */
export type UserInputAnswers = Record<string, { answers: string[] }>;

/** A pending user-input request pushed from main; answered via answerUserInput. */
export interface UserInputRequestPayload {
  requestId: number;
  questions: UserInputQuestion[];
}

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
  /** Task-scoped chat: steers the in-progress turn, follow-up turn when idle (FR-4.3). */
  sendChat(text: string): Promise<void>;
  /** Cancel the running task via turn/interrupt (FR-4.5); the renderer confirms first. */
  cancelTask(): Promise<void>;
  /** Subscribe to agent user-input requests; answer each via answerUserInput (FR-4.4). */
  onUserInputRequest(handler: (request: UserInputRequestPayload) => void): () => void;
  answerUserInput(requestId: number, answers: UserInputAnswers): Promise<void>;
  /** Native file-picker for "file" form fields; null when the user cancels. */
  pickFile(extensions?: string[]): Promise<string | null>;
}
