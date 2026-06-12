import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { TaskEvent } from "./ipc.js";
import { SessionStore } from "./session-store.js";

// A fresh SessionStore on the same directory is the simulated app relaunch:
// nothing is shared in memory, so anything readable proves it hit disk.
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "foreman-sessions-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("SessionStore run lifecycle (FR-7.1)", () => {
  test("a created then finished run survives a restart and lists with its final status", () => {
    const run = new SessionStore(dir).createRun({ taskId: "echo", params: { message: "szia" } });
    new SessionStore(dir).finishRun(run.runId, "success");

    const runs = new SessionStore(dir).listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: run.runId,
      taskId: "echo",
      params: { message: "szia" },
      status: "success",
    });
  });

  test("an interrupted in-progress run is offered for resume with its thread id (FR-7.2)", () => {
    const first = new SessionStore(dir);
    const stale = first.createRun({ taskId: "echo", params: {} });
    first.recordThread(stale.runId, "thread-42");
    // The app is killed here — finishRun never runs, so the record stays "running".

    const resumable = new SessionStore(dir).findResumable();
    expect(resumable).toMatchObject({ runId: stale.runId, threadId: "thread-42", status: "running" });
  });

  test("a finished run is not resumable, and a running run without a thread id cannot resume", () => {
    const store = new SessionStore(dir);
    const done = store.createRun({ taskId: "echo", params: {} });
    store.recordThread(done.runId, "thread-1");
    store.finishRun(done.runId, "success");
    // Started but died before thread/start returned — nothing to resume onto.
    store.createRun({ taskId: "echo", params: {} });

    expect(new SessionStore(dir).findResumable()).toBeUndefined();
  });
});

describe("SessionStore transcript (FR-7.1: the rendered chat transcript persists)", () => {
  test("appended events replay in order across a restart, scoped to their run", () => {
    const store = new SessionStore(dir);
    const a = store.createRun({ taskId: "echo", params: {} });
    const b = store.createRun({ taskId: "echo", params: {} });

    const events: TaskEvent[] = [
      { type: "runStarted", taskId: "echo" },
      { type: "itemStarted", itemType: "agentMessage" },
      { type: "agentDelta", text: "Szia " },
      { type: "agentDelta", text: "világ" },
      { type: "finished", status: "success" },
    ];
    for (const event of events) store.appendEvent(a.runId, event);
    store.appendEvent(b.runId, { type: "runStarted", taskId: "echo" });

    const reopened = new SessionStore(dir);
    expect(reopened.readTranscript(a.runId)).toEqual(events);
    expect(reopened.readTranscript(b.runId)).toEqual([{ type: "runStarted", taskId: "echo" }]);
  });

  test("the transcript of an unknown run is empty, not an error", () => {
    expect(new SessionStore(dir).readTranscript("does-not-exist")).toEqual([]);
  });
});
