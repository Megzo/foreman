// Foreman dev CLI — drives the codex adapter from a terminal (Phase 1 tracer bullet).
//
//   pnpm foreman-dev chat "Reply with exactly: SPIKE_OK"   stream a turn, exit 0 on turn/completed
//   pnpm foreman-dev auth-status                           print the account/read snapshot
//   pnpm foreman-dev login                                 ChatGPT OAuth: print authUrl, await completion
//   pnpm foreman-dev sandbox-check                         probe windowsSandbox/readiness, run setup if needed
//
// Env: CODEX_BIN (default "codex"), FOREMAN_CODEX_HOME (sets CODEX_HOME for the
// spawned codex; default: inherit, i.e. the developer's own login).

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAdapter, resolveCodexBin } from "@foreman/codex-adapter";

const TURN_TIMEOUT_MS = 120_000;
const LOGIN_TIMEOUT_MS = 300_000; // the user has to finish an OAuth dance in a browser
const SANDBOX_SETUP_TIMEOUT_MS = 300_000;

function makeAdapter(): CodexAdapter {
  const codexHome = process.env.FOREMAN_CODEX_HOME;
  const bin = resolveCodexBin({
    platform: process.platform,
    env: process.env,
    fileExists: existsSync,
  });
  return new CodexAdapter({
    command: { bin, args: ["app-server"] },
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

async function login(): Promise<number> {
  const adapter = makeAdapter();
  try {
    await adapter.start();

    const existing = await adapter.readAccount();
    if (existing.account) {
      console.log(`already signed in as ${existing.account.email ?? existing.account.type}`);
      return 0;
    }

    const completed = new Promise<number>((resolve) => {
      adapter.on("loginCompleted", (payload) => {
        if (payload.success) {
          console.log("login completed");
          resolve(0);
        } else {
          console.error(`[foreman-dev] login failed: ${payload.error ?? "unknown error"}`);
          resolve(1);
        }
      });
      adapter.on("error", (payload) => {
        console.error(`[foreman-dev] ${payload.message}`);
        resolve(1);
      });
    });
    const timeout = setTimeout(() => {
      console.error(`[foreman-dev] login timed out after ${LOGIN_TIMEOUT_MS / 1000}s`);
      process.exit(2);
    }, LOGIN_TIMEOUT_MS);

    const start = await adapter.startLogin({ type: "chatgpt" });
    if (start.type !== "chatgpt") {
      console.error(`[foreman-dev] unexpected login flow: ${start.type}`);
      return 1;
    }
    console.log("Open this URL in a browser to sign in with ChatGPT:");
    console.log(`\n  ${start.authUrl}\n`);
    console.log("waiting for account/login/completed ...");

    const code = await completed;
    clearTimeout(timeout);
    if (code === 0) {
      const account = await adapter.readAccount();
      console.log(JSON.stringify(account, null, 2));
    }
    return code;
  } finally {
    await adapter.stop();
  }
}

async function sandboxCheck(): Promise<number> {
  const adapter = makeAdapter();
  try {
    const info = await adapter.start();
    console.log(`server: ${info.userAgent}`);
    console.log(`platform: ${info.platformOs ?? "?"} (${info.platformFamily ?? "?"})`);

    let readiness;
    try {
      readiness = await adapter.windowsSandboxReadiness();
    } catch (error) {
      // Expected on non-Windows codex builds — record it, that IS the probe result.
      console.log(`windowsSandbox/readiness: not available (${(error as Error).message})`);
      return 1;
    }
    console.log(`windowsSandbox/readiness: ${readiness.status}`);
    if (readiness.status === "ready") return 0;

    console.log("running windowsSandbox/setupStart (mode: unelevated) ...");
    const setupCompleted = new Promise<number>((resolve) => {
      adapter.on("windowsSandboxSetupCompleted", (payload) => {
        if (payload.success) {
          console.log(`setup completed (mode: ${payload.mode})`);
          resolve(0);
        } else {
          console.error(`[foreman-dev] setup failed: ${payload.error ?? "unknown error"}`);
          resolve(1);
        }
      });
      adapter.on("error", (payload) => {
        console.error(`[foreman-dev] ${payload.message}`);
        resolve(1);
      });
    });
    const timeout = setTimeout(() => {
      console.error(`[foreman-dev] sandbox setup timed out after ${SANDBOX_SETUP_TIMEOUT_MS / 1000}s`);
      process.exit(2);
    }, SANDBOX_SETUP_TIMEOUT_MS);

    const setup = await adapter.windowsSandboxSetupStart({ mode: "unelevated" });
    console.log(`setupStart acknowledged (started: ${setup.started})`);
    const code = await setupCompleted;
    clearTimeout(timeout);

    const after = await adapter.windowsSandboxReadiness();
    console.log(`windowsSandbox/readiness after setup: ${after.status}`);
    return code === 0 && after.status === "ready" ? 0 : 1;
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
  case "login":
    exitCode = await login();
    break;
  case "sandbox-check":
    exitCode = await sandboxCheck();
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
    console.error("usage: foreman-dev <chat|auth-status|login|sandbox-check>");
    exitCode = 64;
}
process.exit(exitCode);
