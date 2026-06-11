// Foreman dev CLI — drives the codex adapter from a terminal (Phase 1 tracer bullet).
//
//   pnpm foreman-dev chat "Reply with exactly: SPIKE_OK"   stream a turn, exit 0 on turn/completed
//   pnpm foreman-dev auth-status                           print the account/read snapshot
//
// Env: CODEX_BIN (default "codex"), FOREMAN_CODEX_HOME (sets CODEX_HOME for the
// spawned codex; default: inherit, i.e. the developer's own login).

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAdapter } from "@foreman/codex-adapter";

const TURN_TIMEOUT_MS = 120_000;

function makeAdapter(): CodexAdapter {
  const codexHome = process.env.FOREMAN_CODEX_HOME;
  return new CodexAdapter({
    command: { bin: process.env.CODEX_BIN ?? "codex", args: ["app-server"] },
    ...(codexHome ? { codexHome } : {}),
    logger: { warn: (message) => console.error(`[foreman-dev] ${message}`) },
  });
}

async function authStatus(): Promise<number> {
  const adapter = makeAdapter();
  try {
    const info = await adapter.start();
    const account = await adapter.readAccount();
    console.log(JSON.stringify({ server: info.userAgent, ...account }, null, 2));
    return 0;
  } finally {
    await adapter.stop();
  }
}

async function chat(prompt: string): Promise<number> {
  const adapter = makeAdapter();

  // Phase 1: no policy engine yet — the dev CLI auto-denies every approval
  // and answers user-input requests with the first option, like the spike.
  adapter.setServerRequestHandlers({
    commandExecutionApproval: () => ({ decision: "decline" }),
    fileChangeApproval: () => ({ decision: "decline" }),
    userInput: (request) => ({
      answers: Object.fromEntries(
        (request.questions ?? []).map((q) => [
          q.id,
          { answers: q.options?.length ? [q.options[0]!.label] : ["ok"] },
        ]),
      ),
    }),
  });

  adapter.on("agentMessageDelta", (payload) => process.stdout.write(payload.delta));

  const outcome = new Promise<number>((resolve) => {
    adapter.on("turnCompleted", () => {
      process.stdout.write("\n");
      resolve(0);
    });
    adapter.on("error", (payload) => {
      console.error(`\n[foreman-dev] ${payload.message}`);
      resolve(1);
    });
  });

  const timeout = setTimeout(() => {
    console.error(`\n[foreman-dev] timed out after ${TURN_TIMEOUT_MS / 1000}s`);
    process.exit(2);
  }, TURN_TIMEOUT_MS);

  try {
    await adapter.start();
    const thread = await adapter.startThread({
      cwd: mkdtempSync(join(tmpdir(), "foreman-dev-")),
      sandbox: "read-only",
    });
    await adapter.startTurn({ threadId: thread.threadId, input: [{ type: "text", text: prompt }] });
    return await outcome;
  } finally {
    clearTimeout(timeout);
    await adapter.stop();
  }
}

const [command, ...rest] = process.argv.slice(2);

let exitCode: number;
switch (command) {
  case "auth-status":
    exitCode = await authStatus();
    break;
  case "chat": {
    const prompt = rest.join(" ").trim();
    if (!prompt) {
      console.error('usage: foreman-dev chat "<prompt>"');
      exitCode = 64;
      break;
    }
    exitCode = await chat(prompt);
    break;
  }
  default:
    console.error("usage: foreman-dev <chat|auth-status>");
    exitCode = 64;
}
process.exit(exitCode);
