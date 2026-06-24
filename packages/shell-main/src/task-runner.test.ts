import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexAdapter } from "@foreman/codex-adapter";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TaskEvent } from "./ipc.js";
import type { AppManifest } from "./manifest-types.js";
import { SessionStore } from "./session-store.js";
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
const tempDirs: string[] = [];

/** A real on-disk workspace so the progress watcher and outputs copy can run. */
function makeWorkspace(): ProvisionedWorkspace {
  const dir = mkdtempSync(join(tmpdir(), "foreman-runner-ws-"));
  tempDirs.push(dir);
  return { workspaceDir: dir, skillPaths: { translate: join(dir, "SKILL.md") } };
}

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeRunner(
  scenario: string,
  manifest: AppManifest = MANIFEST,
  extra: Partial<ConstructorParameters<typeof TaskRunner>[0]> = {},
): { runner: TaskRunner; events: TaskEvent[] } {
  const adapter = new CodexAdapter({
    command: { bin: process.execPath, args: [MOCK_PEER, scenario] },
  });
  adapters.push(adapter);
  const runner = new TaskRunner({ adapter, manifest, workspace: WORKSPACE, ...extra });
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

const storeDirs: string[] = [];
function makeStore(): SessionStore {
  const dir = mkdtempSync(join(tmpdir(), "foreman-runner-sessions-"));
  storeDirs.push(dir);
  return new SessionStore(dir);
}

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.stop().catch(() => {})));
  for (const dir of storeDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A translate-book-shaped task: completion globs + a single "translate" skill. */
function translateManifest(): AppManifest {
  return {
    schemaVersion: 1,
    id: "translate-book",
    name: "Könyvfordító",
    version: "0.1.0",
    branding: { productName: "Könyvfordító", colors: { primary: "#7c3aed" } },
    sandbox: "workspace-write",
    tasks: [
      {
        id: "translate",
        label: { hu: "Fordítás" },
        skill: { name: "translate", path: "skill/SKILL.md" },
        completion: { outputs: ["**/*.epub", "**/*.pdf"] },
      },
    ],
  };
}

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

describe("TaskRunner in-task chat routing (FR-4.3, Phase 6)", () => {
  test("a chat message during an in-progress turn is delivered via turn/steer", async () => {
    const { runner, events } = makeRunner("steerable");
    await startAdapter();

    // launch resolves once turn/start is answered, so the turn is in progress.
    await runner.launch("echo", { message: "ok" });
    await runner.sendChat("legyél formális");
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    expect(finished(events)).toEqual({ type: "finished", status: "success" });
    // The steerable peer only accepts turn/steer (with the matching
    // expectedTurnId) while the turn is open, and echoes the steer input it
    // received — so the echoed text proves both the method and the payload.
    const echoed = events
      .filter((event) => event.type === "agentDelta")
      .map((event) => (event as { text: string }).text)
      .join("");
    expect(JSON.parse(echoed)).toEqual([{ type: "text", text: "legyél formális" }]);
  });

  test("a chat message when the turn is idle starts a follow-up turn on the same thread", async () => {
    const { runner, events } = makeRunner("echo-input");
    await startAdapter();

    await runner.launch("echo", { message: "ok" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());
    events.length = 0;

    // The run reached a terminal state; chat stays available for follow-ups.
    await runner.sendChat("köszönöm, még valami");
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    // echo-input echoes each turn/start's input — the follow-up went out as a
    // plain text turn (no skill ref) on the already-started thread.
    const echoed = events
      .filter((event) => event.type === "agentDelta")
      .map((event) => (event as { text: string }).text)
      .join("");
    expect(JSON.parse(echoed)).toEqual([{ type: "text", text: "köszönöm, még valami" }]);
  });

  test("chat with no run launched rejects instead of opening a blank conversation", async () => {
    const { runner } = makeRunner("happy");
    await startAdapter();

    await expect(runner.sendChat("hahó")).rejects.toThrow(/aktív|active/i);
  });
});

describe("TaskRunner cancel (FR-4.5/4.6, Phase 6)", () => {
  test("cancel interrupts the in-progress turn and the run ends in the cancelled state", async () => {
    const { runner, events } = makeRunner("steerable");
    await startAdapter();

    await runner.launch("echo", { message: "ok" });
    await runner.cancel();
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    // The steerable peer only honours turn/interrupt with the exact
    // {threadId, turnId} pair (schema: V2TurnInterruptParams) and then
    // completes the turn with status "interrupted".
    expect(finished(events)).toEqual({ type: "finished", status: "cancelled" });
  });

  test("cancel with no turn in progress rejects", async () => {
    const { runner, events } = makeRunner("happy");
    await startAdapter();

    await runner.launch("echo", { message: "ok" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    await expect(runner.cancel()).rejects.toThrow(/turn|futás/i);
  });
});

describe("TaskRunner user-input requests (FR-4.4, Phase 6)", () => {
  test("a requestUserInput is answered by the shell's handler and the answers reach the agent", async () => {
    const requests: unknown[] = [];
    const { runner, events } = makeRunner("user-input", MANIFEST, {
      onUserInput: async (request) => {
        requests.push(request);
        return { answers: { tone: { answers: ["Formális"] } } };
      },
    });
    await startAdapter();

    await runner.launch("echo", { message: "ok" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    expect(finished(events)).toEqual({ type: "finished", status: "success" });
    // The peer echoes the JSON-RPC response it received — the protocol-shaped
    // answer payload (schema: ToolRequestUserInputResponse) went back verbatim.
    const echoed = events
      .filter((event) => event.type === "agentDelta")
      .map((event) => (event as { text: string }).text)
      .join("");
    expect(JSON.parse(echoed)).toEqual({ answers: { tone: { answers: ["Formális"] } } });
    expect(requests[0]).toMatchObject({
      questions: [
        {
          id: "tone",
          question: "Formális vagy informális megszólítást használjak?",
          options: [
            { label: "Formális", description: "magázódás" },
            { label: "Informális", description: "tegeződés" },
          ],
        },
      ],
    });
  });

  test("without a handler the first option is answered, so a run can never hang on a hidden dialog", async () => {
    const { runner, events } = makeRunner("user-input");
    await startAdapter();

    await runner.launch("echo", { message: "ok" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    const echoed = events
      .filter((event) => event.type === "agentDelta")
      .map((event) => (event as { text: string }).text)
      .join("");
    expect(JSON.parse(echoed)).toEqual({ answers: { tone: { answers: ["Formális"] } } });
  });
});

describe("TaskRunner persistence and resume (FR-7.1/7.2, Phase 7)", () => {
  test("a launched run is recorded with its thread id, transcript and final status", async () => {
    const store = makeStore();
    const { runner, events } = makeRunner("happy", MANIFEST, { store });
    await startAdapter();

    await runner.launch("echo", { message: "ok" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    const runs = store.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      taskId: "echo",
      params: { message: "ok" },
      threadId: "thread-1",
      status: "success",
    });
    // The transcript captured the same stream the running view saw, in order.
    const transcript = store.readTranscript(runs[0]!.runId);
    expect(transcript[0]).toEqual({ type: "runStarted", taskId: "echo" });
    expect(transcript.some((event) => event.type === "agentDelta")).toBe(true);
    expect(transcript.at(-1)).toEqual({ type: "finished", status: "success" });
  });

  test("resume re-attaches the stored thread via thread/resume and continues into the same run record", async () => {
    const store = makeStore();
    // A prior app died after thread/start: the record stays "running" with its
    // thread id ("thread-1" is the mock peer's thread). The peer's thread/resume
    // rejects any other id, so a completed run proves the stored id went out.
    const stale = store.createRun({ taskId: "echo", params: { message: "ok" } });
    store.recordThread(stale.runId, "thread-1");

    const { runner, events } = makeRunner("happy", MANIFEST, { store });
    await startAdapter();

    await runner.resume(stale.runId);
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    expect(finished(events)).toEqual({ type: "finished", status: "success" });
    // Same record — no new run was created — and it is now terminal.
    expect(store.listRuns()).toHaveLength(1);
    expect(store.getRun(stale.runId)?.status).toBe("success");
  });

  test("resuming an unknown or thread-less run rejects instead of starting blind", async () => {
    const store = makeStore();
    const noThread = store.createRun({ taskId: "echo", params: {} });
    const { runner } = makeRunner("happy", MANIFEST, { store });
    await startAdapter();

    await expect(runner.resume("does-not-exist")).rejects.toThrow(/resum/i);
    await expect(runner.resume(noThread.runId)).rejects.toThrow(/resum/i);
  });
});

describe("TaskRunner approval policy (FR-5.1/5.3, Phase 5)", () => {
  // The mock peer's approval scenario asks to run ["bash", "-lc", "curl example.com"]
  // mid-turn and echoes the client's decision back as a delta, so the test can
  // assert the exact wire value the policy produced.
  function withPolicy(policy: AppManifest["policy"]): AppManifest {
    return { ...MANIFEST, policy };
  }

  test("an allowlisted command is answered accept on the wire and the run succeeds", async () => {
    const { runner, events } = makeRunner(
      "approval",
      withPolicy({ allowCommands: [["bash", "-lc"]] }),
    );
    await startAdapter();

    await runner.launch("echo", { message: "ok" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    expect(finished(events)).toEqual({ type: "finished", status: "success" });
    const echoed = events
      .filter((event) => event.type === "agentDelta")
      .map((event) => (event as { text: string }).text)
      .join("");
    expect(JSON.parse(echoed)).toEqual({ decision: "accept" });
    expect(events.some((event) => event.type === "actionDenied")).toBe(false);
  });

  test("an out-of-policy command is declined, a denial event is emitted, and the turn continues", async () => {
    const { runner, events } = makeRunner("approval", withPolicy({ allowCommands: [["python3"]] }));
    await startAdapter();

    await runner.launch("echo", { message: "ok" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    // "decline" (never "cancel") lets the turn run to completion (FR-5.3).
    expect(finished(events)).toEqual({ type: "finished", status: "success" });
    const echoed = events
      .filter((event) => event.type === "agentDelta")
      .map((event) => (event as { text: string }).text)
      .join("");
    expect(JSON.parse(echoed)).toEqual({ decision: "decline" });

    const denied = events.find((event) => event.type === "actionDenied");
    expect(denied).toEqual({ type: "actionDenied", kind: "commandExecution" });
    expect(events.indexOf(denied!)).toBeLessThan(events.indexOf(finished(events)!));
  });

  test("a file-change approval is accepted on the wire when the policy allows it", async () => {
    const { runner, events } = makeRunner("file-approval", withPolicy({ allowFileChanges: true }));
    await startAdapter();

    await runner.launch("echo", { message: "ok" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    const echoed = events
      .filter((event) => event.type === "agentDelta")
      .map((event) => (event as { text: string }).text)
      .join("");
    expect(JSON.parse(echoed)).toEqual({ decision: "accept" });
    expect(events.some((event) => event.type === "actionDenied")).toBe(false);
  });

  test("a file-change approval under the default policy is declined with a denial event", async () => {
    const { runner, events } = makeRunner("file-approval", withPolicy(undefined));
    await startAdapter();

    await runner.launch("echo", { message: "ok" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    expect(finished(events)).toEqual({ type: "finished", status: "success" });
    expect(events).toContainEqual({ type: "actionDenied", kind: "fileChange" });
  });
});

describe("TaskRunner progress + outputs (Phase 8)", () => {
  test("progress.json writes during a run surface as ordered progress events (PRD Open Q2)", async () => {
    const workspace = makeWorkspace();
    const adapter = new CodexAdapter({
      command: { bin: process.execPath, args: [MOCK_PEER, "steerable"] },
    });
    adapters.push(adapter);
    const runner = new TaskRunner({ adapter, manifest: translateManifest(), workspace });
    const events: TaskEvent[] = [];
    runner.onEvent((event) => events.push(event));
    await adapter.start();

    await runner.launch("translate", { file_path: "book.epub" });
    // The turn idles open (steerable), so the watcher is live; drive it.
    writeFileSync(join(workspace.workspaceDir, "progress.json"), '{"current":1,"total":3}');
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === "progress" && e.current === 1)).toBe(true),
    );
    writeFileSync(
      join(workspace.workspaceDir, "progress.json"),
      '{"current":2,"total":3,"label":"2. fejezet"}',
    );
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === "progress" && e.current === 2)).toBe(true),
    );

    const progress = events.filter((e) => e.type === "progress");
    expect(progress).toEqual([
      { type: "progress", current: 1, total: 3 },
      { type: "progress", current: 2, total: 3, label: "2. fejezet" },
    ]);
  });

  test("a successful run copies completion outputs to Documents and reports the folder (FR-6.3)", async () => {
    const workspace = makeWorkspace();
    const documentsDir = makeTempDir("foreman-runner-docs-");
    // The skill's outputs already sit in the workspace when the turn completes.
    writeFileSync(join(workspace.workspaceDir, "alice.epub"), "EPUB");
    writeFileSync(join(workspace.workspaceDir, "alice.pdf"), "PDF");

    const adapter = new CodexAdapter({
      command: { bin: process.execPath, args: [MOCK_PEER, "happy"] },
    });
    adapters.push(adapter);
    const runner = new TaskRunner({
      adapter,
      manifest: translateManifest(),
      workspace,
      documentsDir,
    });
    const events: TaskEvent[] = [];
    runner.onEvent((event) => events.push(event));
    await adapter.start();

    await runner.launch("translate", { export_name: "alice" });
    await vi.waitFor(() => expect(finished(events)).toBeTruthy());

    const done = finished(events)!;
    expect(done.status).toBe("success");
    expect(done.outputDir).toBe(join(documentsDir, "Könyvfordító", "alice"));
    expect(done.outputFiles?.sort()).toEqual(["alice.epub", "alice.pdf"]);
    // Copied, not moved.
    expect(existsSync(join(workspace.workspaceDir, "alice.epub"))).toBe(true);
    expect(readFileSync(join(done.outputDir!, "alice.epub"), "utf8")).toBe("EPUB");
  });
});
