// Spike: drive `codex app-server` over JSON-RPC (newline-delimited JSON on stdio)
// from plain Node, no dependencies. Validates the protocol chain the shell needs:
// initialize -> auth state -> skills discovery -> thread/start -> turn/start -> streamed deltas.
//
// Usage: node probe.mjs [--skill-cwd /path/to/skill-project] [--prompt "..."]

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const SKILL_CWD = arg("--skill-cwd", "/home/megyo/projects/translate-book");
const PROMPT = arg("--prompt", "Reply with exactly: SPIKE_OK. Do not use any tools.");
const CODEX_BIN = process.env.CODEX_BIN ?? "codex";

const workCwd = mkdtempSync(join(tmpdir(), "codex-spike-"));
const child = spawn(CODEX_BIN, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
child.stderr.on("data", (d) => process.stderr.write(`[codex stderr] ${d}`));
child.on("exit", (code, sig) => log(`codex exited code=${code} sig=${sig}`));

let nextId = 1;
const pending = new Map();
const notificationHandlers = new Map();
const serverRequestHandlers = new Map();

const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");

const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, method });
    send({ jsonrpc: "2.0", id, method, params });
  });
const notify = (method, params) => send({ jsonrpc: "2.0", method, params });

let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log("UNPARSEABLE:", line.slice(0, 200));
      continue;
    }
    handleMessage(msg);
  }
});

function handleMessage(msg) {
  // response to our request
  if (msg.id !== undefined && msg.method === undefined) {
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(`${entry.method}: ${JSON.stringify(msg.error)}`));
    else entry.resolve(msg.result);
    return;
  }
  // server -> client request (approvals, user input)
  if (msg.id !== undefined && msg.method !== undefined) {
    const handler = serverRequestHandlers.get(msg.method);
    log(`<= server request: ${msg.method}`, JSON.stringify(msg.params).slice(0, 300));
    if (handler) {
      Promise.resolve(handler(msg.params)).then((result) =>
        send({ jsonrpc: "2.0", id: msg.id, result }),
      );
    } else {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `spike: no handler for ${msg.method}` },
      });
    }
    return;
  }
  // notification
  const handler = notificationHandlers.get(msg.method);
  if (handler) handler(msg.params);
  else if (!/delta/.test(msg.method ?? "")) {
    log(`<= notif: ${msg.method}`, JSON.stringify(msg.params ?? {}).slice(0, 200));
  }
}

// --- spike policy: deny any approval (turn should not need tools), answer user-input with first option
serverRequestHandlers.set("item/commandExecution/requestApproval", () => ({ decision: "denied" }));
serverRequestHandlers.set("item/fileChange/requestApproval", () => ({ decision: "denied" }));
serverRequestHandlers.set("item/tool/requestUserInput", (p) => ({
  answers: Object.fromEntries(
    (p.questions ?? []).map((q) => [q.id, { answers: q.options?.length ? [q.options[0].label] : ["ok"] }]),
  ),
}));

// --- streaming display
let streamed = "";
notificationHandlers.set("item/agentMessage/delta", (p) => {
  streamed += p?.delta ?? "";
  process.stdout.write(p?.delta ?? "");
});
notificationHandlers.set("item/started", (p) => log(`<= item/started: ${p?.item?.type ?? "?"}`));
notificationHandlers.set("item/completed", (p) => log(`\n<= item/completed: ${p?.item?.type ?? "?"}`));

const turnDone = new Promise((resolve) => {
  notificationHandlers.set("turn/completed", (p) => resolve(p));
});

// --- main sequence
const deadline = setTimeout(() => {
  log("TIMEOUT after 120s");
  child.kill();
  process.exit(2);
}, 120_000);

try {
  const init = await request("initialize", {
    clientInfo: { name: "shell-spike", title: "Vertical Shell Spike", version: "0.0.1" },
    capabilities: { experimentalApi: true, optOutNotificationMethods: null },
  });
  log("initialize OK:", JSON.stringify(init).slice(0, 300));
  notify("initialized", undefined);

  const account = await request("account/read", {});
  log("account/read:", JSON.stringify(account).slice(0, 400));

  const skills = await request("skills/list", { cwds: [SKILL_CWD] });
  log("skills/list:", JSON.stringify(skills).slice(0, 600));

  const models = await request("model/list", {}).catch((e) => `model/list failed: ${e.message}`);
  log("model/list:", JSON.stringify(models).slice(0, 400));

  const thread = await request("thread/start", {
    cwd: workCwd,
    sandbox: "read-only",
    sessionStartSource: null,
  });
  const threadId = thread?.thread?.id ?? thread?.threadId ?? thread?.id;
  log("thread/start OK, threadId =", threadId);

  log(`=> turn/start: "${PROMPT}"`);
  const turn = await request("turn/start", {
    threadId,
    input: [{ type: "text", text: PROMPT }],
  });
  log("turn/start accepted:", JSON.stringify(turn).slice(0, 300));

  const completed = await turnDone;
  log("turn/completed:", JSON.stringify(completed).slice(0, 400));
  log(`\n--- SPIKE RESULT ---`);
  log(`streamed message: ${JSON.stringify(streamed.trim()).slice(0, 200)}`);
  log(`PASS: ${streamed.includes("SPIKE_OK") ? "yes" : "no (check output above)"}`);
} catch (err) {
  log("SPIKE FAILED:", err.message);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  child.kill();
}
