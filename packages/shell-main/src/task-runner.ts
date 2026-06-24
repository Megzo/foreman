import { basename, join } from "node:path";
import type {
  AgentAdapter,
  ApprovalResponse,
  UserInputRequest,
  UserInputResponse,
} from "@foreman/codex-adapter";
import type { TaskEvent, TaskParamValues } from "./ipc.js";
import type { AppManifest } from "./manifest-types.js";
import { copyOutputs } from "./outputs.js";
import { PolicyEngine, type PolicyDecisionRecord } from "./policy.js";
import { ProgressWatcher } from "./progress-watch.js";
import type { SessionStore } from "./session-store.js";
import type { ProvisionedWorkspace } from "./workspace.js";

/** The progress.json file the skill writes at the workspace root (PRD Open Q2). */
const PROGRESS_FILE = "progress.json";

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
  /**
   * Persists the run lifecycle and transcript (FR-7.1). Optional so headless
   * tests can drive the runner without a store; when present, every run is
   * recorded and becomes resumable after a crash (FR-7.2).
   */
  store?: SessionStore;
  /**
   * Base Documents dir (app.getPath("documents")). When set, a task with a
   * completion definition copies its outputs here on success (FR-6.3); without
   * it (headless tests) the success state simply carries no output folder.
   */
  documentsDir?: string;
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

/**
 * The per-run Documents output folder name (FR-6.3): a user-supplied export
 * name wins, else the input file's stem, else the task id — sanitized so it is
 * a safe single path segment.
 */
function deriveJobName(task: AppManifest["tasks"][number], params: TaskParamValues): string {
  const exportName = params.export_name;
  if (typeof exportName === "string" && exportName.trim()) return sanitizeSegment(exportName);
  const filePath = params.file_path;
  if (typeof filePath === "string" && filePath.trim()) {
    return sanitizeSegment(basename(filePath).replace(/\.[^.]+$/, ""));
  }
  return task.id;
}

function sanitizeSegment(value: string): string {
  return value.trim().replace(/[/\\:*?"<>|]+/g, "_") || "run";
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
  private readonly store: SessionStore | undefined;
  private readonly documentsDir: string | undefined;
  private readonly handlers = new Set<(event: TaskEvent) => void>();
  private running = false;
  /** The active run's thread; outlives the turn so follow-up chat can reuse it. */
  private threadId: string | undefined;
  /** Set while a turn is in progress — chat steers it; cleared on turn end. */
  private turnId: string | undefined;
  /** The persisted run id, set on launch/resume; events append to its transcript. */
  private runId: string | undefined;
  /** The task running right now — drives outputs copy at success (FR-6.3). */
  private activeTask: AppManifest["tasks"][number] | undefined;
  /** Watches the workspace progress.json while a run is live (PRD Open Q2). */
  private progressWatcher: ProgressWatcher | undefined;
  /** Job name for the Documents output folder, derived from the run's params. */
  private jobName = "";

  constructor(options: TaskRunnerOptions) {
    this.adapter = options.adapter;
    this.manifest = options.manifest;
    this.workspace = options.workspace;
    this.store = options.store;
    this.documentsDir = options.documentsDir;

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
        void this.finishSuccess();
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

  /** The run the shell would resume after a codex-process death (FR-2.5). */
  activeRunId(): string | undefined {
    return this.runId;
  }

  async launch(taskId: string, params: TaskParamValues): Promise<void> {
    if (this.running) {
      throw new Error("a task run is already in progress (egy futás már folyamatban van)");
    }
    const { task, skillPath } = this.resolveTask(taskId);

    this.running = true;
    this.activeTask = task;
    this.jobName = deriveJobName(task, params);
    this.runId = this.store?.createRun({ taskId, params }).runId;
    this.emit({ type: "runStarted", taskId });
    this.startProgressWatch();
    try {
      const thread = await this.adapter.startThread({
        cwd: this.workspace.workspaceDir,
        sandbox: this.manifest.sandbox ?? "workspace-write",
      });
      this.bindThread(thread.threadId);
      const turn = await this.adapter.startTurn({
        threadId: thread.threadId,
        input: this.skillInput(task, skillPath, params),
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
   * Resume a crashed run (FR-7.2): re-attach its stored thread via thread/resume
   * and re-invoke the skill turn on it. The skill's own checkpointing makes the
   * re-run cheap (it skips finished work); the events stream into the same run
   * record so history and the transcript stay continuous.
   */
  async resume(runId: string): Promise<void> {
    if (this.running) {
      throw new Error("a task run is already in progress (egy futás már folyamatban van)");
    }
    const record = this.store?.getRun(runId);
    if (!record?.threadId) {
      throw new Error(`run not resumable (nem folytatható): ${runId}`);
    }
    const { task, skillPath } = this.resolveTask(record.taskId);

    this.running = true;
    this.activeTask = task;
    this.jobName = deriveJobName(task, record.params);
    this.runId = runId;
    this.emit({ type: "runStarted", taskId: record.taskId });
    this.startProgressWatch();
    try {
      const thread = await this.adapter.resumeThread(record.threadId);
      this.bindThread(thread.threadId);
      const turn = await this.adapter.startTurn({
        threadId: thread.threadId,
        input: this.skillInput(task, skillPath, record.params),
      });
      if (this.running) this.turnId = turn.turnId;
    } catch (error) {
      this.finish({ type: "finished", status: "failed", errorMessage: (error as Error).message });
      throw error;
    }
  }

  private resolveTask(taskId: string): { task: AppManifest["tasks"][number]; skillPath: string } {
    const task = this.manifest.tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error(`unknown task id: ${taskId}`);
    }
    const skillPath = this.workspace.skillPaths[task.skill.name];
    if (!skillPath) {
      throw new Error(`skill not provisioned: ${task.skill.name}`);
    }
    return { task, skillPath };
  }

  private skillInput(
    task: AppManifest["tasks"][number],
    skillPath: string,
    params: TaskParamValues,
  ) {
    return [
      { type: "skill" as const, name: task.skill.name, path: skillPath },
      { type: "text" as const, text: paramsText(params) },
    ];
  }

  /** Record the run's thread, both in memory and (for resume) in the store. */
  private bindThread(threadId: string): void {
    this.threadId = threadId;
    if (this.runId) this.store?.recordThread(this.runId, threadId);
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

  /** Start (or restart) watching the workspace progress.json for this run. */
  private startProgressWatch(): void {
    this.progressWatcher?.stop();
    this.progressWatcher = new ProgressWatcher(
      join(this.workspace.workspaceDir, PROGRESS_FILE),
      (update) => this.whileRunning({ type: "progress", ...update }),
    );
    this.progressWatcher.start();
  }

  /**
   * Success terminal state with the FR-6.3 outputs copy: when the task declares
   * a completion definition and a Documents dir is configured, copy the matching
   * workspace files out and report the folder for the "Open folder" button. A
   * copy failure never demotes the run — the files stay in the workspace.
   */
  private async finishSuccess(): Promise<void> {
    // Close the run before the (async) copy so no late event leaks through.
    this.running = false;
    const task = this.activeTask;
    let outputs: { outputDir: string; outputFiles: string[] } | undefined;
    if (this.documentsDir && task?.completion) {
      try {
        const result = await copyOutputs({
          workspaceDir: this.workspace.workspaceDir,
          outputs: task.completion.outputs,
          documentsDir: this.documentsDir,
          appName: this.manifest.branding.productName,
          jobName: this.jobName,
        });
        outputs = { outputDir: result.outputDir, outputFiles: result.files };
      } catch {
        // Outputs are a presentation nicety; a copy error must not lose work.
      }
    }
    this.finish({ type: "finished", status: "success", ...outputs });
  }

  private whileRunning(event: TaskEvent): void {
    if (this.running) this.emit(event);
  }

  private finish(event: Extract<TaskEvent, { type: "finished" }>): void {
    this.running = false;
    this.turnId = undefined;
    this.progressWatcher?.stop();
    this.progressWatcher = undefined;
    if (this.runId) this.store?.finishRun(this.runId, event.status, event.errorMessage);
    this.emit(event);
  }

  private emit(event: TaskEvent): void {
    // Notify the UI first, then persist — the transcript must never gate the
    // sub-100ms delta latency (FR-2.4); a delta lost to a crash before its
    // append is cosmetic, since resume replays the skill anyway.
    for (const handler of this.handlers) handler(event);
    if (this.runId) this.store?.appendEvent(this.runId, event);
  }
}
