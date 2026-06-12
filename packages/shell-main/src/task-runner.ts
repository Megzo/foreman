import type {
  AgentAdapter,
  ApprovalResponse,
  UserInputRequest,
  UserInputResponse,
} from "@foreman/codex-adapter";
import type { TaskEvent, TaskParamValues } from "./ipc.js";
import type { AppManifest } from "./manifest-types.js";
import { PolicyEngine, type PolicyDecisionRecord } from "./policy.js";
import type { ProvisionedWorkspace } from "./workspace.js";

export interface TaskRunnerOptions {
  adapter: AgentAdapter;
  manifest: AppManifest;
  workspace: ProvisionedWorkspace;
  /** Decision-trail sink, wired to the DecisionLog by the shell (FR-5.4). */
  onPolicyDecision?: (record: PolicyDecisionRecord) => void;
  /**
   * Answers `item/tool/requestUserInput` — the shell wires this to the native
   * modal form (FR-4.4). Without it the first option is picked, so a headless
   * runner can never hang on a hidden dialog.
   */
  onUserInput?: (request: UserInputRequest) => UserInputResponse | Promise<UserInputResponse>;
}

/** The no-handler fallback: first option (or "ok" for free-text questions). */
function firstOptionAnswers(request: UserInputRequest): UserInputResponse {
  return {
    answers: Object.fromEntries(
      (request.questions ?? []).map((question) => [
        question.id,
        { answers: question.options?.length ? [question.options[0]!.label] : ["ok"] },
      ]),
    ),
  };
}

/** The params text item accompanying the skill input (FR-4.1). */
function paramsText(params: TaskParamValues): string {
  return `Run this task with the following parameters (JSON, keyed by field id):\n${JSON.stringify(params)}`;
}

/**
 * Owns the task half of the IPC contract: turns a launcher submit into the
 * thread/start -> turn/start skill invocation and the adapter's event stream
 * into TaskEvents for the running view. One active run at a time (Phase 4) —
 * in-memory state only, persistence lands in Phase 7.
 *
 * Approvals are answered by the manifest-baked PolicyEngine (FR-5.1) and
 * user-input requests get the first option, so a run can never hang on a
 * hidden dialog. A denial becomes an actionDenied event for the feed (FR-5.3).
 */
export class TaskRunner {
  private readonly adapter: AgentAdapter;
  private readonly manifest: AppManifest;
  private readonly workspace: ProvisionedWorkspace;
  private readonly handlers = new Set<(event: TaskEvent) => void>();
  private running = false;
  /** The active run's thread; outlives the turn so follow-up chat can reuse it. */
  private threadId: string | undefined;
  /** Set while a turn is in progress — chat steers it; cleared on turn end. */
  private turnId: string | undefined;

  constructor(options: TaskRunnerOptions) {
    this.adapter = options.adapter;
    this.manifest = options.manifest;
    this.workspace = options.workspace;

    const policy = new PolicyEngine({
      policy: this.manifest.policy,
      workspaceDir: this.workspace.workspaceDir,
      onDecision: options.onPolicyDecision,
    });
    const decided = (kind: "commandExecution" | "fileChange", response: ApprovalResponse) => {
      if (response.decision === "decline") {
        this.whileRunning({ type: "actionDenied", kind });
      }
      return response;
    };

    this.adapter.setServerRequestHandlers({
      commandExecutionApproval: (request) =>
        decided("commandExecution", policy.decide("commandExecution", request)),
      fileChangeApproval: (request) => decided("fileChange", policy.decide("fileChange", request)),
      userInput: (request) => (options.onUserInput ?? firstOptionAnswers)(request),
    });

    this.adapter.on("itemStarted", (payload) =>
      this.whileRunning({ type: "itemStarted", itemType: payload.item?.type ?? "unknown" }),
    );
    this.adapter.on("itemCompleted", (payload) =>
      this.whileRunning({ type: "itemCompleted", itemType: payload.item?.type ?? "unknown" }),
    );
    this.adapter.on("agentMessageDelta", (payload) =>
      this.whileRunning({ type: "agentDelta", text: payload.delta }),
    );
    this.adapter.on("turnCompleted", (payload) => {
      if (!this.running) return;
      if (payload.turn?.status === "completed") {
        this.finish({ type: "finished", status: "success" });
      } else if (payload.turn?.status === "interrupted") {
        // The user cancelled (turn/interrupt) — FR-4.6's third terminal state.
        this.finish({ type: "finished", status: "cancelled" });
      } else {
        this.finish({
          type: "finished",
          status: "failed",
          errorMessage: payload.turn?.error?.message ?? `turn ended as ${payload.turn?.status}`,
        });
      }
    });
    this.adapter.on("error", (payload) => {
      if (!this.running) return;
      this.finish({ type: "finished", status: "failed", errorMessage: payload.message });
    });
  }

  onEvent(handler: (event: TaskEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  isRunning(): boolean {
    return this.running;
  }

  async launch(taskId: string, params: TaskParamValues): Promise<void> {
    if (this.running) {
      throw new Error("a task run is already in progress (egy futás már folyamatban van)");
    }
    const task = this.manifest.tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error(`unknown task id: ${taskId}`);
    }
    const skillPath = this.workspace.skillPaths[task.skill.name];
    if (!skillPath) {
      throw new Error(`skill not provisioned: ${task.skill.name}`);
    }

    this.running = true;
    this.emit({ type: "runStarted", taskId });
    try {
      const thread = await this.adapter.startThread({
        cwd: this.workspace.workspaceDir,
        sandbox: this.manifest.sandbox ?? "workspace-write",
      });
      this.threadId = thread.threadId;
      const turn = await this.adapter.startTurn({
        threadId: thread.threadId,
        input: [
          { type: "skill", name: task.skill.name, path: skillPath },
          { type: "text", text: paramsText(params) },
        ],
      });
      // turn/completed may already have been processed while awaiting the
      // turn/start response (both can arrive in one stdio chunk) — don't
      // resurrect a turn that finish() has already closed.
      if (this.running) this.turnId = turn.turnId;
    } catch (error) {
      this.finish({ type: "finished", status: "failed", errorMessage: (error as Error).message });
      throw error;
    }
  }

  /**
   * Task-scoped chat (FR-4.3): steer the in-progress turn, or start a new turn
   * on the run's thread when idle (follow-up after a terminal state).
   */
  async sendChat(text: string): Promise<void> {
    if (!this.threadId) {
      throw new Error("no active task to chat with (nincs aktív feladat)");
    }
    const input = [{ type: "text", text } as const];
    if (this.turnId) {
      await this.adapter.steerTurn({
        threadId: this.threadId,
        expectedTurnId: this.turnId,
        input,
      });
    } else {
      this.running = true;
      const turn = await this.adapter.startTurn({ threadId: this.threadId, input });
      // Same single-chunk race as in launch(): only track a still-open turn.
      if (this.running) this.turnId = turn.turnId;
    }
  }

  /** Cancel the in-progress turn (FR-4.5); the confirmation dialog is the UI's job. */
  async cancel(): Promise<void> {
    if (!this.threadId || !this.turnId) {
      throw new Error("no turn in progress to cancel (nincs megszakítható futás)");
    }
    await this.adapter.interruptTurn({ threadId: this.threadId, turnId: this.turnId });
  }

  private whileRunning(event: TaskEvent): void {
    if (this.running) this.emit(event);
  }

  private finish(event: Extract<TaskEvent, { type: "finished" }>): void {
    this.running = false;
    this.turnId = undefined;
    this.emit(event);
  }

  private emit(event: TaskEvent): void {
    for (const handler of this.handlers) handler(event);
  }
}
