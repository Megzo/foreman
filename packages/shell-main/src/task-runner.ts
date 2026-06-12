import type { AgentAdapter } from "@foreman/codex-adapter";
import type { TaskEvent, TaskParamValues } from "./ipc.js";
import type { AppManifest } from "./manifest-types.js";
import type { ProvisionedWorkspace } from "./workspace.js";

export interface TaskRunnerOptions {
  adapter: AgentAdapter;
  manifest: AppManifest;
  workspace: ProvisionedWorkspace;
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
 * Until the Phase 5 PolicyEngine, every approval is auto-denied and user-input
 * requests get the first option, so a run can never hang on a hidden dialog.
 */
export class TaskRunner {
  private readonly adapter: AgentAdapter;
  private readonly manifest: AppManifest;
  private readonly workspace: ProvisionedWorkspace;
  private readonly handlers = new Set<(event: TaskEvent) => void>();
  private running = false;

  constructor(options: TaskRunnerOptions) {
    this.adapter = options.adapter;
    this.manifest = options.manifest;
    this.workspace = options.workspace;

    this.adapter.setServerRequestHandlers({
      commandExecutionApproval: () => ({ decision: "decline" }),
      fileChangeApproval: () => ({ decision: "decline" }),
      userInput: (request) => ({
        answers: Object.fromEntries(
          (request.questions ?? []).map((question) => [
            question.id,
            { answers: question.options?.length ? [question.options[0]!.label] : ["ok"] },
          ]),
        ),
      }),
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
      await this.adapter.startTurn({
        threadId: thread.threadId,
        input: [
          { type: "skill", name: task.skill.name, path: skillPath },
          { type: "text", text: paramsText(params) },
        ],
      });
    } catch (error) {
      this.finish({ type: "finished", status: "failed", errorMessage: (error as Error).message });
      throw error;
    }
  }

  private whileRunning(event: TaskEvent): void {
    if (this.running) this.emit(event);
  }

  private finish(event: Extract<TaskEvent, { type: "finished" }>): void {
    this.running = false;
    this.emit(event);
  }

  private emit(event: TaskEvent): void {
    for (const handler of this.handlers) handler(event);
  }
}
