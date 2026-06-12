/**
 * Hand-derived protocol types for the `codex app-server` messages Foreman uses.
 * Authoritative reference: t3code/packages/effect-codex-app-server/src/_generated/schema.gen.ts
 * (grep there before extending — do not guess shapes).
 */

export interface ClientInfo {
  name: string;
  title?: string;
  version: string;
}

/** `initialize` result (schema: InitializeResponse). */
export interface AgentInfo {
  userAgent: string;
  codexHome?: string;
  platformFamily?: string;
  platformOs?: string;
}

/** `account/read` result. `account` is null when signed out. */
export interface AccountReadResult {
  account: {
    type: string;
    email?: string;
    planType?: string;
  } | null;
  requiresOpenaiAuth?: boolean;
}

/** schema: LoginAccountParams, the variants Foreman uses (FR-3.2/3.3). */
export interface StartLoginOptions {
  type: "chatgpt" | "chatgptDeviceCode";
}

/** schema: LoginAccountResponse, the variants Foreman uses. */
export type StartLoginResult =
  | { type: "chatgpt"; authUrl: string; loginId: string }
  | { type: "chatgptDeviceCode"; loginId: string; userCode: string; verificationUrl: string };

/** schema: V2CancelLoginAccountResponse. */
export interface CancelLoginResult {
  status: "canceled" | "notFound";
}

/** schema: AccountLoginCompletedNotification. */
export interface LoginCompletedNotification {
  success: boolean;
  loginId?: string | null;
  error?: string | null;
}

/** schema: WindowsSandboxReadinessResponse. */
export interface WindowsSandboxReadinessResult {
  status: "ready" | "notConfigured" | "updateRequired";
}

/** schema: WindowsSandboxSetupStartParams. */
export interface WindowsSandboxSetupStartOptions {
  mode: "elevated" | "unelevated";
  cwd?: string;
}

/** schema: WindowsSandboxSetupStartResponse. */
export interface WindowsSandboxSetupStartResult {
  started: boolean;
}

/** schema: WindowsSandboxSetupCompletedNotification. */
export interface WindowsSandboxSetupCompletedNotification {
  success: boolean;
  mode: "elevated" | "unelevated";
  error?: string | null;
}

/** schema: SandboxMode (thread/start `sandbox`). */
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface StartThreadOptions {
  cwd: string;
  sandbox?: SandboxMode;
  model?: string;
}

export interface ThreadRef {
  threadId: string;
}

/** schema: V2TurnStartParams__UserInput, the variants Foreman sends. */
export type TurnInput =
  | { type: "text"; text: string }
  | { type: "skill"; name: string; path: string };

export interface StartTurnOptions {
  threadId: string;
  input: TurnInput[];
}

/** schema: V2TurnStartResponse — { turn: { id, status, ... } }. */
export interface TurnRef {
  turnId: string;
}

export interface SteerTurnOptions {
  threadId: string;
  expectedTurnId: string;
  input: TurnInput[];
}

/** schema: V2TurnInterruptParams — both fields are required. */
export interface InterruptTurnOptions {
  threadId: string;
  turnId: string;
}

/** Common addressing fields on item-scoped notifications. */
export interface ItemScope {
  threadId?: string;
  turnId?: string;
  itemId?: string;
}

export interface ItemNotification extends ItemScope {
  item?: { id?: string; type?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface AgentMessageDeltaNotification extends ItemScope {
  delta: string;
}

/** schema: V2TurnCompletedNotification__TurnStatus. */
export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

/** schema: V2TurnCompletedNotification — { threadId, turn: { id, status, error?, ... } }. */
export interface TurnCompletedNotification {
  threadId?: string;
  turn?: {
    id?: string;
    status?: TurnStatus;
    /** Only populated when status is "failed". */
    error?: { message: string; additionalDetails?: string | null } | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Terminal adapter failure (FR-2.5 detection half). */
export interface AdapterErrorEvent {
  message: string;
  exitCode?: number | null;
  signal?: string | null;
}

/**
 * schema: CommandExecutionApprovalDecision. Note: the generated schema uses
 * accept/decline wording while the PRD speaks of approved/denied — the adapter
 * passes whatever the registered callback returns through verbatim, so the
 * policy layer (Phase 5) owns picking the value the pinned codex accepts.
 */
export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface ApprovalResponse {
  decision: ApprovalDecision;
}

export interface CommandApprovalRequest extends ItemScope {
  command?: string[] | string;
  cwd?: string;
  [key: string]: unknown;
}

export interface FileChangeApprovalRequest extends ItemScope {
  [key: string]: unknown;
}

export interface UserInputQuestionOption {
  label: string;
  description?: string;
}

export interface UserInputQuestion {
  id: string;
  header?: string;
  question: string;
  options?: UserInputQuestionOption[];
}

export interface UserInputRequest extends ItemScope {
  questions?: UserInputQuestion[];
  [key: string]: unknown;
}

export interface UserInputResponse {
  answers: Record<string, { answers: string[] }>;
}
