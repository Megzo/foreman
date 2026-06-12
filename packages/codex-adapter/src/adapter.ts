import type { AdapterEventMap } from "./events.js";
import type {
  AccountReadResult,
  AgentInfo,
  ApprovalResponse,
  CancelLoginResult,
  CommandApprovalRequest,
  FileChangeApprovalRequest,
  InterruptTurnOptions,
  StartLoginOptions,
  StartLoginResult,
  StartThreadOptions,
  StartTurnOptions,
  SteerTurnOptions,
  ThreadRef,
  UserInputRequest,
  UserInputResponse,
} from "./types.js";

/**
 * Callbacks the shell registers to answer server->client requests (FR-2.1).
 * Whatever they return is sent back verbatim as the JSON-RPC response.
 */
export interface ServerRequestHandlers {
  commandExecutionApproval?: (
    request: CommandApprovalRequest,
  ) => ApprovalResponse | Promise<ApprovalResponse>;
  fileChangeApproval?: (
    request: FileChangeApprovalRequest,
  ) => ApprovalResponse | Promise<ApprovalResponse>;
  userInput?: (request: UserInputRequest) => UserInputResponse | Promise<UserInputResponse>;
}

/**
 * The agent-backend seam (FR-2.1). CodexAdapter is the v1 implementation;
 * an OpenCode adapter must be addable behind this interface without UI changes.
 */
export interface AgentAdapter {
  /** Spawn the agent process and complete its handshake. */
  start(): Promise<AgentInfo>;
  stop(): Promise<void>;
  isRunning(): boolean;

  readAccount(): Promise<AccountReadResult>;
  /** Begin a login; completion arrives as the `loginCompleted` event. */
  startLogin(options: StartLoginOptions): Promise<StartLoginResult>;
  cancelLogin(loginId: string): Promise<CancelLoginResult>;
  logout(): Promise<void>;

  startThread(options: StartThreadOptions): Promise<ThreadRef>;
  resumeThread(threadId: string): Promise<ThreadRef>;
  startTurn(options: StartTurnOptions): Promise<void>;
  steerTurn(options: SteerTurnOptions): Promise<void>;
  interruptTurn(options: InterruptTurnOptions): Promise<void>;

  on<K extends keyof AdapterEventMap>(
    event: K,
    handler: (payload: AdapterEventMap[K]) => void,
  ): void;
  off<K extends keyof AdapterEventMap>(
    event: K,
    handler: (payload: AdapterEventMap[K]) => void,
  ): void;

  setServerRequestHandlers(handlers: ServerRequestHandlers): void;
}
