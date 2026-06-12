import { fileURLToPath } from "node:url";
import { CodexAdapter } from "@foreman/codex-adapter";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AuthController } from "./auth-controller.js";

const MOCK_PEER = fileURLToPath(
  new URL("../../codex-adapter/test/fixtures/mock-peer.mjs", import.meta.url),
);

const adapters: CodexAdapter[] = [];

function makeAdapter(scenario: string) {
  const adapter = new CodexAdapter({
    command: { bin: process.execPath, args: [MOCK_PEER, scenario] },
  });
  adapters.push(adapter);
  return adapter;
}

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.stop().catch(() => {})));
});

describe("AuthController (FR-3.1/3.2/3.4): adapter -> AuthState stream", () => {
  test("full lifecycle: signedOut -> loginPending (browser opened) -> signedIn -> logout -> signedOut", async () => {
    const adapter = makeAdapter("signed-out");
    const opened: string[] = [];
    const controller = new AuthController({ adapter, openExternal: (url) => opened.push(url) });
    const states: string[] = [];
    controller.onChange((state) => states.push(state.status));

    await adapter.start();
    await controller.initialize();
    expect(controller.current.status).toBe("signedOut");

    await controller.startLogin("chatgpt");
    // The mock peer's "user" completes OAuth instantly; signedIn arrives via
    // the loginCompleted notification followed by a fresh account/read.
    await vi.waitFor(() => expect(controller.current.status).toBe("signedIn"));
    expect(opened).toEqual(["https://auth.example.com/mock-oauth"]);
    expect(controller.current).toMatchObject({ account: { email: "mock@example.com" } });

    await controller.logout();
    expect(controller.current.status).toBe("signedOut");

    expect(states).toEqual(["signedOut", "loginPending", "signedIn", "signedOut"]);
  });

  test("an already-signed-in account is reported on initialize (FR-3.1)", async () => {
    const adapter = makeAdapter("happy");
    const controller = new AuthController({ adapter, openExternal: () => {} });

    await adapter.start();
    await controller.initialize();

    expect(controller.current).toMatchObject({
      status: "signedIn",
      account: { email: "mock@example.com" },
    });
  });

  test("agent death surfaces as the agentError state", async () => {
    const adapter = makeAdapter("die-mid-turn");
    const controller = new AuthController({ adapter, openExternal: () => {} });

    await adapter.start();
    await controller.initialize();
    const thread = await adapter.startThread({ cwd: "/tmp" });
    await adapter.startTurn({ threadId: thread.threadId, input: [{ type: "text", text: "go" }] });

    await vi.waitFor(() => expect(controller.current.status).toBe("agentError"));
  });
});
