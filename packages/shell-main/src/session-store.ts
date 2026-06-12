import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { RunRecord, RunTerminalStatus, TaskEvent, TaskParamValues } from "./ipc.js";

/**
 * Local, file-based session persistence (PRD State / FR-7.1): a JSON index of
 * run records plus one append-only JSONL transcript file per run. The public
 * surface is run-centric — createRun/recordThread/appendEvent/finishRun and the
 * read side listRuns/getRun/findResumable/readTranscript — so the storage
 * backend (today: fs; a SQLite index later) stays an implementation detail.
 *
 * Synchronous like DecisionLog: writes are infrequent (lifecycle transitions
 * and the transcript stream) and the record must be on disk before a crash, so
 * the index can never lag behind what actually ran.
 */
export class SessionStore {
  private readonly indexFile: string;
  private readonly index: RunIndex;

  constructor(private readonly dir: string) {
    this.indexFile = join(dir, "index.json");
    this.index = this.readIndex();
  }

  createRun(input: { taskId: string; params: TaskParamValues; threadId?: string }): RunRecord {
    const now = new Date().toISOString();
    const record: RunRecord = {
      runId: randomUUID(),
      taskId: input.taskId,
      threadId: input.threadId,
      params: input.params,
      status: "running",
      createdAt: now,
      updatedAt: now,
    };
    this.index.runs.push(record);
    this.writeIndex();
    return record;
  }

  /** Bind the Codex thread once thread/start returns, so the run can be resumed. */
  recordThread(runId: string, threadId: string): void {
    this.update(runId, (run) => {
      run.threadId = threadId;
    });
  }

  finishRun(runId: string, status: RunTerminalStatus, errorMessage?: string): void {
    this.update(runId, (run) => {
      run.status = status;
      if (errorMessage !== undefined) run.errorMessage = errorMessage;
    });
  }

  /** Append one rendered event to the run's transcript (append-only, like the decision log). */
  appendEvent(runId: string, event: TaskEvent): void {
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(this.transcriptFile(runId), `${JSON.stringify(event)}\n`);
  }

  /** Replay a run's transcript in append order; empty for an unknown run. */
  readTranscript(runId: string): TaskEvent[] {
    try {
      return readFileSync(this.transcriptFile(runId), "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as TaskEvent);
    } catch {
      return [];
    }
  }

  getRun(runId: string): RunRecord | undefined {
    return this.index.runs.find((run) => run.runId === runId);
  }

  /** Past runs, newest first — the history list (FR-7.3). */
  listRuns(): RunRecord[] {
    return [...this.index.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * The most recent run still "running" that has a thread to resume onto — the
   * startup resume offer (FR-7.2). A run with no threadId died before
   * thread/start returned, so there is nothing to `thread/resume` against.
   */
  findResumable(): RunRecord | undefined {
    return this.listRuns().find((run) => run.status === "running" && run.threadId !== undefined);
  }

  private transcriptFile(runId: string): string {
    return join(this.dir, `${runId}.jsonl`);
  }

  private update(runId: string, mutate: (run: RunRecord) => void): void {
    const run = this.index.runs.find((candidate) => candidate.runId === runId);
    if (!run) return;
    mutate(run);
    run.updatedAt = new Date().toISOString();
    this.writeIndex();
  }

  private readIndex(): RunIndex {
    try {
      const raw = readFileSync(this.indexFile, "utf8");
      const parsed = JSON.parse(raw) as RunIndex;
      if (parsed.schemaVersion === INDEX_SCHEMA_VERSION && Array.isArray(parsed.runs)) {
        return parsed;
      }
    } catch {
      // Missing or unreadable index — start fresh; a corrupt file must not
      // block the app (the runs it described are unrecoverable anyway).
    }
    return { schemaVersion: INDEX_SCHEMA_VERSION, runs: [] };
  }

  private writeIndex(): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.indexFile, JSON.stringify(this.index, null, 2));
  }
}

const INDEX_SCHEMA_VERSION = 1 as const;

interface RunIndex {
  schemaVersion: typeof INDEX_SCHEMA_VERSION;
  runs: RunRecord[];
}
