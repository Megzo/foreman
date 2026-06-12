import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import type { AgentAdapter, ServerRequestHandlers } from "./adapter.js";
import { TypedEventEmitter, type AdapterEventMap } from "./events.js";
import { JsonRpcConnection } from "./rpc.js";
import type {
  AccountReadResult,
  AgentInfo,
  CancelLoginResult,
  ClientInfo,
  InterruptTurnOptions,
  StartLoginOptions,
  StartLoginResult,
  StartThreadOptions,
  StartTurnOptions,
  SteerTurnOptions,
  ThreadRef,
  WindowsSandboxReadinessResult,
  WindowsSandboxSetupStartOptions,
  WindowsSandboxSetupStartResult,
} from "./types.js";

export const PINNED_CODEX_VERSION = "0.138.0";

export interface AdapterLogger {
  warn(message: string): void;
}

export interface CodexAdapterOptions {
  /** Override the spawned process; defaults to `codex app-server`. */
  command?: { bin: string; args?: string[] };
  /** App-specific CODEX_HOME (FR-3.5); when unset the child inherits the environment. */
  codexHome?: string;
  env?: Record<string, string>;
  clientInfo?: ClientInfo;
  /** Pinned codex version; a mismatch with the initialize result is logged, never fatal (FR-2.6). */
  expectedVersion?: string;
  logger?: AdapterLogger;
}

/** thread/start result shapes vary slightly across codex versions; mirror the spike's tolerant read. */
function extractThreadId(result: unknown, method: string): string {
  const r = result as { thread?: { id?: string }; threadId?: string; id?: string } | undefined;
  const threadId = r?.thread?.id ?? r?.threadId ?? r?.id;
  if (!threadId) {
    throw new Error(`${method}: response contained no thread id: ${JSON.stringify(result).slice(0, 200)}`);
  }
  return threadId;
}

const DEFAULT_CLIENT_INFO: ClientInfo = {
  name: "foreman",
  title: "Foreman shell",
  version: "0.0.1",
};

type AdapterState = "idle" | "starting" | "running" | "stopping" | "stopped";

export class CodexAdapter implements AgentAdapter {
  private readonly options: CodexAdapterOptions;
  private readonly logger: AdapterLogger;
  private readonly emitter = new TypedEventEmitter<AdapterEventMap>();
  private handlers: ServerRequestHandlers = {};
  private child: ChildProcess | undefined;
  private rpc: JsonRpcConnection | undefined;
  private state: AdapterState = "idle";
  private exited: Promise<void> = Promise.resolve();

  constructor(options: CodexAdapterOptions = {}) {
    this.options = options;
    this.logger = options.logger ?? { warn: (message) => console.warn(message) };
  }

  async start(): Promise<AgentInfo> {
    if (this.state !== "idle" && this.state !== "stopped") {
      throw new Error(`adapter already ${this.state}`);
    }
    this.state = "starting";

    const command = this.options.command ?? { bin: "codex", args: ["app-server"] };
    const env: NodeJS.ProcessEnv = { ...process.env, ...this.options.env };
    if (this.options.codexHome !== undefined) {
      // codex 0.138.0 on Windows exits 1 if CODEX_HOME does not exist (F-2);
      // the shell owns this directory (FR-3.5), so provision it.
      mkdirSync(this.options.codexHome, { recursive: true });
      env.CODEX_HOME = this.options.codexHome;
    }

    const child = spawn(command.bin, command.args ?? [], { stdio: ["pipe", "pipe", "pipe"], env });
    this.child = child;
    child.stderr?.on("data", (data: Buffer) => {
      this.logger.warn(`[codex stderr] ${data.toString("utf8").trimEnd()}`);
    });

    const rpc = new JsonRpcConnection(child.stdout!, child.stdin!, {
      onUnparseableLine: (line) =>
        this.logger.warn(`codex: skipped unparseable line: ${line.slice(0, 200)}`),
    });
    this.rpc = rpc;
    this.routeNotifications(rpc);
    this.routeServerRequests(rpc);

    this.exited = new Promise<void>((resolve) => {
      // Fires when the process cannot be spawned at all (e.g. ENOENT — on
      // Windows the npm-installed `codex` is a .cmd shim spawn() can't see).
      // Without this handler the 'error' event crashes the host process.
      child.on("error", (error) => {
        this.state = "stopped";
        rpc.failPending(
          new Error(`failed to spawn ${command.bin}: ${error.message}`),
        );
        resolve();
      });
      child.on("exit", (code, signal) => {
        const wasStopping = this.state === "stopping" || this.state === "stopped";
        this.state = "stopped";
        const error = new Error(
          `codex process exited unexpectedly (code=${code}, signal=${signal})`,
        );
        rpc.failPending(error);
        if (!wasStopping) {
          this.emitter.emit("error", { message: error.message, exitCode: code, signal });
        }
        resolve();
      });
    });

    const info = (await rpc.request("initialize", {
      clientInfo: this.options.clientInfo ?? DEFAULT_CLIENT_INFO,
      capabilities: { experimentalApi: true, optOutNotificationMethods: null },
    })) as AgentInfo;

    const expected = this.options.expectedVersion ?? PINNED_CODEX_VERSION;
    if (!info.userAgent.includes(expected)) {
      this.logger.warn(
        `codex version mismatch: expected ${expected}, server reports "${info.userAgent}"`,
      );
    }

    rpc.notify("initialized");
    this.state = "running";
    return info;
  }

  async stop(): Promise<void> {
    if (!this.child || this.state === "stopped") {
      this.state = "stopped";
      return;
    }
    this.state = "stopping";
    this.child.kill();
    await this.exited;
  }

  isRunning(): boolean {
    return this.state === "running";
  }

  async readAccount(): Promise<AccountReadResult> {
    return (await this.connection().request("account/read", {})) as AccountReadResult;
  }

  async startLogin(options: StartLoginOptions): Promise<StartLoginResult> {
    return (await this.connection().request("account/login/start", {
      type: options.type,
    })) as StartLoginResult;
  }

  async cancelLogin(loginId: string): Promise<CancelLoginResult> {
    return (await this.connection().request("account/login/cancel", {
      loginId,
    })) as CancelLoginResult;
  }

  async logout(): Promise<void> {
    await this.connection().request("account/logout", null);
  }

  /** Codex-specific (not on AgentAdapter): native Windows sandbox probe (Phase 2 / Open Q1). */
  async windowsSandboxReadiness(): Promise<WindowsSandboxReadinessResult> {
    return (await this.connection().request(
      "windowsSandbox/readiness",
      null,
    )) as WindowsSandboxReadinessResult;
  }

  /** Codex-specific: drive Windows sandbox setup; completion arrives as `windowsSandboxSetupCompleted`. */
  async windowsSandboxSetupStart(
    options: WindowsSandboxSetupStartOptions,
  ): Promise<WindowsSandboxSetupStartResult> {
    return (await this.connection().request("windowsSandbox/setupStart", {
      mode: options.mode,
      cwd: options.cwd ?? null,
    })) as WindowsSandboxSetupStartResult;
  }

  async startThread(options: StartThreadOptions): Promise<ThreadRef> {
    const result = await this.connection().request("thread/start", {
      cwd: options.cwd,
      sandbox: options.sandbox ?? null,
      model: options.model ?? null,
      sessionStartSource: null,
    });
    return { threadId: extractThreadId(result, "thread/start") };
  }

  async resumeThread(threadId: string): Promise<ThreadRef> {
    const result = await this.connection().request("thread/resume", { threadId });
    return { threadId: extractThreadId(result, "thread/resume") ?? threadId };
  }

  async startTurn(options: StartTurnOptions): Promise<void> {
    await this.connection().request("turn/start", {
      threadId: options.threadId,
      input: options.input,
    });
  }

  async steerTurn(options: SteerTurnOptions): Promise<void> {
    await this.connection().request("turn/steer", {
      threadId: options.threadId,
      expectedTurnId: options.expectedTurnId,
      input: options.input,
    });
  }

  async interruptTurn(options: InterruptTurnOptions): Promise<void> {
    await this.connection().request("turn/interrupt", {
      threadId: options.threadId,
      turnId: options.turnId,
    });
  }

  on<K extends keyof AdapterEventMap>(
    event: K,
    handler: (payload: AdapterEventMap[K]) => void,
  ): void {
    this.emitter.on(event, handler);
  }

  off<K extends keyof AdapterEventMap>(
    event: K,
    handler: (payload: AdapterEventMap[K]) => void,
  ): void {
    this.emitter.off(event, handler);
  }

  setServerRequestHandlers(handlers: ServerRequestHandlers): void {
    this.handlers = handlers;
  }

  private connection(): JsonRpcConnection {
    if (!this.rpc || this.state !== "running") {
      throw new Error("adapter not started: call start() and await the handshake first");
    }
    return this.rpc;
  }

  private routeNotifications(rpc: JsonRpcConnection): void {
    rpc.onNotification("item/started", (params) =>
      this.emitter.emit("itemStarted", params as AdapterEventMap["itemStarted"]),
    );
    rpc.onNotification("item/agentMessage/delta", (params) =>
      this.emitter.emit("agentMessageDelta", params as AdapterEventMap["agentMessageDelta"]),
    );
    rpc.onNotification("item/completed", (params) =>
      this.emitter.emit("itemCompleted", params as AdapterEventMap["itemCompleted"]),
    );
    rpc.onNotification("turn/completed", (params) =>
      this.emitter.emit("turnCompleted", params as AdapterEventMap["turnCompleted"]),
    );
    rpc.onNotification("account/login/completed", (params) =>
      this.emitter.emit("loginCompleted", params as AdapterEventMap["loginCompleted"]),
    );
    rpc.onNotification("windowsSandbox/setupCompleted", (params) =>
      this.emitter.emit(
        "windowsSandboxSetupCompleted",
        params as AdapterEventMap["windowsSandboxSetupCompleted"],
      ),
    );
  }

  private routeServerRequests(rpc: JsonRpcConnection): void {
    const bridge = (name: keyof ServerRequestHandlers, method: string) => {
      rpc.onServerRequest(method, (params) => {
        const handler = this.handlers[name];
        if (!handler) {
          throw new Error(`no ${name} handler registered for ${method}`);
        }
        return handler(params as never);
      });
    };
    bridge("commandExecutionApproval", "item/commandExecution/requestApproval");
    bridge("fileChangeApproval", "item/fileChange/requestApproval");
    bridge("userInput", "item/tool/requestUserInput");
  }
}
