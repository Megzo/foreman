import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { CodexAdapter } from "./codex.js";

const MOCK_PEER = fileURLToPath(new URL("../test/fixtures/mock-peer.mjs", import.meta.url));

const adapters: CodexAdapter[] = [];

function makeAdapter(scenario = "happy", options: Record<string, unknown> = {}) {
  const adapter = new CodexAdapter({
    command: { bin: process.execPath, args: [MOCK_PEER, scenario] },
    ...options,
  });
  adapters.push(adapter);
  return adapter;
}

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.stop().catch(() => {})));
});

describe("handshake (FR-2.3)", () => {
  test("start() completes initialize/initialized before any other request", async () => {
    const adapter = makeAdapter();

    const info = await adapter.start();
    expect(info.userAgent).toContain("mock-codex-app-server");

    // The mock peer rejects any request arriving before the full handshake
    // (and any initialize without experimentalApi), so this resolving proves
    // the ordering and the capability flag.
    const account = await adapter.readAccount();
    expect(account.account?.email).toBe("mock@example.com");
  });

  test("requests before start() reject instead of hanging", async () => {
    const adapter = makeAdapter();

    await expect(adapter.readAccount()).rejects.toThrow(/not started/i);
  });

  test("version mismatch is logged via the logger, not fatal (FR-2.6)", async () => {
    const warnings: string[] = [];
    const adapter = makeAdapter("happy", {
      expectedVersion: "0.138.0",
      logger: { warn: (message: string) => warnings.push(message) },
    });

    await adapter.start();

    expect(warnings.join("\n")).toContain("0.138.0");
    expect(warnings.join("\n")).toContain("mock-codex-app-server/9.9.9");
  });
});

describe("turn streaming (FR-2.4)", () => {
  test("a turn streams deltas in order and ends with turnCompleted", async () => {
    const adapter = makeAdapter();
    const deltas: string[] = [];
    const eventOrder: string[] = [];
    adapter.on("itemStarted", () => eventOrder.push("itemStarted"));
    adapter.on("agentMessageDelta", (payload) => {
      deltas.push(payload.delta);
      eventOrder.push("delta");
    });
    adapter.on("itemCompleted", () => eventOrder.push("itemCompleted"));
    const turnCompleted = new Promise<void>((resolve) => {
      adapter.on("turnCompleted", () => {
        eventOrder.push("turnCompleted");
        resolve();
      });
    });

    await adapter.start();
    const thread = await adapter.startThread({ cwd: "/tmp", sandbox: "read-only" });
    expect(thread.threadId).toBe("thread-1");
    await adapter.startTurn({
      threadId: thread.threadId,
      input: [{ type: "text", text: "Reply with exactly: SPIKE_OK" }],
    });
    await turnCompleted;

    expect(deltas).toEqual(["SPIKE", "_", "OK"]);
    expect(deltas.join("")).toBe("SPIKE_OK");
    expect(eventOrder).toEqual(["itemStarted", "delta", "delta", "delta", "itemCompleted", "turnCompleted"]);
  });
});

describe("server-request callbacks (FR-2.1)", () => {
  test("the approval callback's value is returned to the server, which proceeds with the turn", async () => {
    const adapter = makeAdapter("approval");
    const requests: unknown[] = [];
    adapter.setServerRequestHandlers({
      commandExecutionApproval: (request) => {
        requests.push(request);
        return { decision: "decline" };
      },
    });
    const deltas: string[] = [];
    adapter.on("agentMessageDelta", (payload) => deltas.push(payload.delta));
    const turnCompleted = new Promise<void>((resolve) => {
      adapter.on("turnCompleted", () => resolve());
    });

    await adapter.start();
    const thread = await adapter.startThread({ cwd: "/tmp" });
    await adapter.startTurn({ threadId: thread.threadId, input: [{ type: "text", text: "go" }] });
    await turnCompleted;

    // The mock peer echoes the JSON-RPC response result it received (matched
    // by request id) back as a delta — proving the round-trip.
    expect(deltas.join("")).toBe(JSON.stringify({ decision: "decline" }));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ command: ["bash", "-lc", "curl example.com"] });
  });
});

describe("login (FR-3.2, Phase 2 CLI support)", () => {
  test("startLogin returns the authUrl and loginId from account/login/start", async () => {
    const adapter = makeAdapter();

    await adapter.start();
    const login = await adapter.startLogin({ type: "chatgpt" });

    expect(login).toEqual({
      type: "chatgpt",
      authUrl: "https://auth.example.com/mock-oauth",
      loginId: "login-1",
    });
  });

  test("logout calls account/logout and the account then reads as signed out (FR-3.4)", async () => {
    const adapter = makeAdapter();

    await adapter.start();
    expect((await adapter.readAccount()).account).not.toBeNull();

    await adapter.logout();

    expect((await adapter.readAccount()).account).toBeNull();
  });

  test("cancelLogin cancels a pending login by loginId", async () => {
    const adapter = makeAdapter();

    await adapter.start();
    const login = await adapter.startLogin({ type: "chatgpt" });

    expect(await adapter.cancelLogin(login.loginId)).toEqual({ status: "canceled" });
  });

  test("account/login/completed is emitted as the loginCompleted event", async () => {
    const adapter = makeAdapter();
    const completed = new Promise<{ success: boolean; loginId?: string | null }>((resolve) => {
      adapter.on("loginCompleted", resolve);
    });

    await adapter.start();
    await adapter.startLogin({ type: "chatgpt" });

    expect(await completed).toEqual({ success: true, loginId: "login-1" });
  });
});

describe("windows sandbox probe (Phase 2 checkpoint support)", () => {
  test("windowsSandboxReadiness returns the probed status", async () => {
    const adapter = makeAdapter();

    await adapter.start();

    expect(await adapter.windowsSandboxReadiness()).toEqual({ status: "ready" });
  });

  test("setupStart reports started and completion arrives as an event", async () => {
    const adapter = makeAdapter("sandbox-setup");
    const completed = new Promise<{ success: boolean; mode: string }>((resolve) => {
      adapter.on("windowsSandboxSetupCompleted", resolve);
    });

    await adapter.start();
    expect(await adapter.windowsSandboxReadiness()).toEqual({ status: "notConfigured" });
    const setup = await adapter.windowsSandboxSetupStart({ mode: "unelevated" });

    expect(setup).toEqual({ started: true });
    expect(await completed).toEqual({ success: true, mode: "unelevated" });
  });
});

describe("codexHome provisioning (Phase 2 finding F-2: codex exits if the dir is missing)", () => {
  test("a missing codexHome directory is created before spawn and reaches the child", async () => {
    const home = join(mkdtempSync(join(tmpdir(), "foreman-home-")), "nested", "codex-home");
    const adapter = makeAdapter("happy", { codexHome: home });

    const info = await adapter.start();

    expect(existsSync(home)).toBe(true);
    // The mock peer reports the CODEX_HOME env it received in its initialize result.
    expect(info.codexHome).toBe(home);
  });
});

describe("spawn failure (Phase 2 finding: npm .cmd shim ENOENT on win32)", () => {
  test("a nonexistent binary rejects start() instead of crashing the process", async () => {
    const adapter = new CodexAdapter({
      command: { bin: "definitely-not-a-real-binary-foreman", args: ["app-server"] },
    });
    adapters.push(adapter);

    await expect(adapter.start()).rejects.toThrow(/failed to spawn/i);
    expect(adapter.isRunning()).toBe(false);
  });
});

describe("wire-format tolerance (Phase 2 Windows risk)", () => {
  test("CRLF-terminated server lines parse identically to LF", async () => {
    const adapter = makeAdapter("crlf");
    const deltas: string[] = [];
    adapter.on("agentMessageDelta", (payload) => deltas.push(payload.delta));
    const turnCompleted = new Promise<void>((resolve) => {
      adapter.on("turnCompleted", () => resolve());
    });

    await adapter.start();
    const thread = await adapter.startThread({ cwd: "/tmp", sandbox: "read-only" });
    await adapter.startTurn({ threadId: thread.threadId, input: [{ type: "text", text: "go" }] });
    await turnCompleted;

    expect(deltas.join("")).toBe("SPIKE_OK");
  });
});

describe("process death (FR-2.5, detection half)", () => {
  test("codex dying mid-turn emits a terminal error event and fails later requests", async () => {
    const adapter = makeAdapter("die-mid-turn");
    const deltas: string[] = [];
    adapter.on("agentMessageDelta", (payload) => deltas.push(payload.delta));
    const errorEvent = new Promise<{ message: string; exitCode?: number | null }>((resolve) => {
      adapter.on("error", resolve);
    });

    await adapter.start();
    const thread = await adapter.startThread({ cwd: "/tmp" });
    await adapter.startTurn({ threadId: thread.threadId, input: [{ type: "text", text: "go" }] });

    const error = await errorEvent;
    expect(error.message).toMatch(/exited unexpectedly/);
    expect(error.exitCode).toBe(1);
    expect(deltas).toEqual(["partial "]); // death happened observably mid-turn
    expect(adapter.isRunning()).toBe(false);
    await expect(adapter.readAccount()).rejects.toThrow(/not started/i);
  });

  test("a clean stop() does not emit an error event", async () => {
    const adapter = makeAdapter();
    const errors: unknown[] = [];
    adapter.on("error", (payload) => errors.push(payload));

    await adapter.start();
    await adapter.stop();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(errors).toEqual([]);
  });
});
