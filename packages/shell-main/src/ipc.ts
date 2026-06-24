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

/** Persisted user settings (PRD State: locale override, plain JSON in app data). */
export interface AppSettings {
  locale: "hu" | "en";
}

/** Last-known `account/read` snapshot, for instant UI rendering (PRD State). */
export interface AccountInfo {
  type: string;
  email?: string;
  planType?: string;
}

/** The pending login flow as the login screen needs to render it (FR-3.2/3.3). */
export type LoginFlow =
  | {
      type: "chatgpt";
      authUrl: string;
      /** Whether shell.openExternal actually launched a browser; false on WSL/headless. */
      browserOpened?: boolean;
    }
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

/** A run's persisted status: still running, or one of the terminal states (FR-7.1). */
export type RunStatus = "running" | RunTerminalStatus;

/**
 * A persisted task run (FR-7.1) — the unit of the history list and the resume
 * offer. The rendered transcript is stored separately (one JSONL file per run)
 * and replayed via the store; this record is the index entry.
 */
export interface RunRecord {
  runId: string;
  taskId: string;
  /** The Codex thread, recorded once thread/start returns — required to resume (FR-7.2). */
  threadId?: string;
  params: TaskParamValues;
  status: RunStatus;
  /** ISO timestamps; createdAt drives the newest-first history ordering. */
  createdAt: string;
  updatedAt: string;
  /** Populated when status is "failed". */
  errorMessage?: string;
}

/** The task-run event stream the running view renders (Phase 4). */
export type TaskEvent =
  | { type: "runStarted"; taskId: string }
  | { type: "itemStarted"; itemType: string }
  | { type: "itemCompleted"; itemType: string }
  | { type: "agentDelta"; text: string }
  /** Chunk-N-of-M progress from the skill's progress.json (PRD Open Q2). */
  | { type: "progress"; current: number; total: number; phase?: string; label?: string }
  /** The policy denied an agent action; the run continues (FR-5.3). */
  | { type: "actionDenied"; kind: "commandExecution" | "fileChange" }
  | {
      type: "finished";
      status: RunTerminalStatus;
      errorMessage?: string;
      /** On success, the Documents folder the outputs were copied to (FR-6.3). */
      outputDir?: string;
      /** Copied output files, relative to outputDir, for the success summary. */
      outputFiles?: string[];
    };

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
  /** Persisted settings (locale) for the first paint; the manifest supplies the default (FR-9.1). */
  getSettings(): Promise<AppSettings>;
  /** Persist the user's locale choice from the settings menu (FR-9.1). */
  setLocale(locale: AppSettings["locale"]): Promise<void>;
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
  /** Past runs for the history list, newest first (FR-7.3). */
  listRuns(): Promise<RunRecord[]>;
  /** The in-progress run to offer for resume on startup, if any (FR-7.2). */
  findResumable(): Promise<RunRecord | undefined>;
  /** Resume a crashed run via thread/resume, streaming into the same run (FR-7.2). */
  resumeRun(runId: string): Promise<void>;
  /** Decline the resume offer; the stale run is finalized so it is not re-offered. */
  dismissResume(runId: string): Promise<void>;
  /** One-click agent restart after a codex-process death; resumes the active run (FR-2.5). */
  restartAgent(): Promise<void>;
  /** Open a finished run's Documents output folder in the OS file manager (FR-6.3). */
  openOutputDir(dir: string): Promise<void>;
}
