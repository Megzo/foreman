import { fileURLToPath } from "node:url";
import { CodexAdapter } from "@foreman/codex-adapter";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TaskEvent } from "./ipc.js";
import type { AppManifest } from "./manifest-types.js";
import { TaskRunner } from "./task-runner.js";
import type { ProvisionedWorkspace } from "./workspace.js";

const MOCK_PEER = fileURLToPath(
  new URL("../../codex-adapter/test/fixtures/mock-peer.mjs", import.meta.url),
);

const MANIFEST: AppManifest = {
  schemaVersion: 1,
  id: "echo-demo",
  name: "Echo Demo",
  version: "0.1.0",
  branding: { productName: "Echo Demo", colors: { primary: "#1f6feb" } },
  sandbox: "workspace-write",
  tasks: [
    {
      id: "echo",
      label: { hu: "Visszhang" },
      skill: { name: "echo", path: "skill/SKILL.md" },
      params: [{ id: "message", type: "text", label: { hu: "Üzenet" }, required: true }],
    },
  ],
};

const WORKSPACE: ProvisionedWorkspace = {
  workspaceDir: "/tmp/foreman-test-workspace",
  skillPaths: { echo: "/tmp/foreman-test-home/skills/echo/SKILL.md" },
};

const adapters: CodexAdapter[] = [];

function makeRunner(scenario: string): { runner: TaskRunner; events: TaskEvent[] } {
  const adapter = new CodexAdapter({
    command: { bin: process.execPath, args: [MOCK_PEER, scenario] },
  });
  adapters.push(adapter);
  const runner = new TaskRunner({ adapter, manifest: MANIFEST, workspace: WORKSPACE });
  const events: TaskEvent[] = [];
  runner.onEvent((event) => events.push(event));
  return { runner, events };
}

async function startAdapter(): Promise<void> {
  await adapters[adapters.length - 1]!.start();
}

function finished(events: TaskEvent[]) {
  return events.find((event) => event.type === "finished") as
    | Extract<TaskEvent, { type: "finished" }>
    | undefined;
}

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.stop().catch(() => {})));
});

describe("TaskRunner launch path (FR-4.1)", () => {
  test("launch starts a thread then a turn whose input is the skill ref plus a params text item", async () => {
    const { runner, events } = makeRunner("echo-input");
    await startAdapter();

    await runner.launch("echo", { message: "szia világ" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    // The echo-input peer streams back exactly what the client sent in
    // turn/start — and only answers turn/start after thread/start, so a
    // completed run proves the call order too.
    const sent = JSON.parse(
      events
        .filter((event) => event.type === "agentDelta")
        .map((event) => (event as { text: string }).text)
        .join(""),
    ) as Array<Record<string, unknown>>;
    expect(sent[0]).toEqual({
      type: "skill",
      name: "echo",
      path: "/tmp/foreman-test-home/skills/echo/SKILL.md",
    });
    expect(sent[1]?.type).toBe("text");
    expect(sent[1]?.text).toContain("szia világ");
    expect(sent[1]?.text).toContain("message");
  });

  test("a normal turn end yields the success terminal state (FR-4.6)", async () => {
    const { runner, events } = makeRunner("happy");
    await startAdapter();

    await runner.launch("echo", { message: "ok" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    expect(finished(events)).toEqual({ type: "finished", status: "success" });
    // The running view's feed sees the item lifecycle and the streamed text.
    expect(events[0]).toEqual({ type: "runStarted", taskId: "echo" });
    expect(events.some((event) => event.type === "itemStarted")).toBe(true);
    expect(
      events
        .filter((event) => event.type === "agentDelta")
        .map((event) => (event as { text: string }).text)
        .join(""),
    ).toBe("SPIKE_OK");
  });

  test("an unknown task id rejects without touching the agent", async () => {
    const { runner } = makeRunner("happy");
    await startAdapter();

    await expect(runner.launch("nope", {})).rejects.toThrow(/nope/);
  });

  test("only one run at a time: a second launch mid-run rejects", async () => {
    const { runner, events } = makeRunner("happy");
    await startAdapter();

    const first = runner.launch("echo", { message: "ok" });
    await expect(runner.launch("echo", { message: "again" })).rejects.toThrow(/futás|run/i);
    await first;
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());
  });
});

describe("TaskRunner terminal states (FR-4.6)", () => {
  test("a turn completing with status failed yields the failed state with the error message", async () => {
    const { runner, events } = makeRunner("turn-fails");
    await startAdapter();

    await runner.launch("echo", { message: "ok" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    expect(finished(events)).toMatchObject({
      status: "failed",
      errorMessage: "mock model exploded",
    });
  });

  test("the agent process dying mid-turn yields the failed state (FR-2.5 detection half)", async () => {
    const { runner, events } = makeRunner("die-mid-turn");
    await startAdapter();

    await runner.launch("echo", { message: "ok" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    expect(finished(events)).toMatchObject({ status: "failed" });
    expect(finished(events)?.errorMessage).toMatch(/exited unexpectedly/);
  });

  test("after a finished run the runner accepts the next launch", async () => {
    const { runner, events } = makeRunner("happy");
    await startAdapter();

    await runner.launch("echo", { message: "first" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());
    events.length = 0;

    await runner.launch("echo", { message: "second" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());
    expect(finished(events)).toEqual({ type: "finished", status: "success" });
  });
});
