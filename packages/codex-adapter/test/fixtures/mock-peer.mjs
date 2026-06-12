// Scripted fake `codex app-server` peer for adapter tests: JSON-RPC 2.0,
// one JSON object per line over stdio. Plain Node, zero dependencies
// (pattern borrowed from t3code's codex-app-server-mock-peer, minus Effect).
//
// Usage: node mock-peer.mjs [scenario]
//   happy        handshake -> account -> thread -> turn streaming "SPIKE_OK" deltas
//   approval     turn sends a commandExecution approval request, echoes the
//                client's decision back as a delta, then completes the turn
//   die-mid-turn turn emits one delta, then the process exits 1
//   sandbox-setup windowsSandbox/readiness reports notConfigured until
//                setupStart runs, then ready (otherwise happy)
//   crlf         happy, but every line is CRLF-terminated (codex.exe wire risk)
//   signed-out   happy, but account/read reports no account until a login runs
//
// The peer enforces protocol order: any request before `initialize` +
// `initialized` (or an initialize without experimentalApi) gets an error
// response, so a client with a broken handshake observably fails.

const scenario = process.argv[2] ?? "happy";

let initializeSeen = false;
let initialized = false;
let signedIn = scenario !== "signed-out";
let pendingLoginId = null;
let sandboxConfigured = scenario !== "sandbox-setup";
let nextServerRequestId = 9000;
const pendingServerRequests = new Map();

const EOL = scenario === "crlf" ? "\r\n" : "\n";
const write = (msg, callback) => process.stdout.write(`${JSON.stringify(msg)}${EOL}`, callback);
const respond = (id, result) => write({ jsonrpc: "2.0", id, result });
const respondError = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });
const notify = (method, params) => write({ jsonrpc: "2.0", method, params });

const sendServerRequest = (method, params, onResponse) => {
  const id = nextServerRequestId++;
  pendingServerRequests.set(id, onResponse);
  write({ jsonrpc: "2.0", id, method, params });
};

const SCOPE = { threadId: "thread-1", turnId: "turn-1", itemId: "item-1" };

function runTurn() {
  notify("item/started", { ...SCOPE, item: { id: SCOPE.itemId, type: "agentMessage" } });

  if (scenario === "die-mid-turn") {
    // Flush the delta before dying so the death is observably mid-turn.
    write({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: { ...SCOPE, delta: "partial " } }, () => {
      process.exit(1);
    });
    return;
  }

  if (scenario === "approval") {
    sendServerRequest(
      "item/commandExecution/requestApproval",
      { ...SCOPE, command: ["bash", "-lc", "curl example.com"], cwd: "/tmp" },
      (response) => {
        if (response.error) {
          notify("mock/approvalError", response.error);
        } else {
          notify("item/agentMessage/delta", { ...SCOPE, delta: JSON.stringify(response.result) });
        }
        notify("turn/completed", { threadId: SCOPE.threadId, turnId: SCOPE.turnId });
      },
    );
    return;
  }

  for (const delta of ["SPIKE", "_", "OK"]) {
    notify("item/agentMessage/delta", { ...SCOPE, delta });
  }
  notify("item/completed", { ...SCOPE, item: { id: SCOPE.itemId, type: "agentMessage", text: "SPIKE_OK" } });
  notify("turn/completed", {
    threadId: SCOPE.threadId,
    turnId: SCOPE.turnId,
    usage: { inputTokens: 1, outputTokens: 2 },
  });
}

function handleRequest({ id, method, params }) {
  if (method === "initialize") {
    if (initializeSeen) return respondError(id, -32600, "initialize sent twice");
    initializeSeen = true;
    if (params?.capabilities?.experimentalApi !== true) {
      return respondError(id, -32600, "initialize requires capabilities.experimentalApi: true");
    }
    return respond(id, {
      userAgent: "mock-codex-app-server/9.9.9",
      codexHome: process.env.CODEX_HOME ?? "",
      platformFamily: "unix",
      platformOs: "linux",
    });
  }
  if (!initialized) {
    return respondError(id, -32002, `request before handshake completed: ${method}`);
  }
  switch (method) {
    case "account/login/start":
      pendingLoginId = "login-1";
      respond(id, {
        type: "chatgpt",
        authUrl: "https://auth.example.com/mock-oauth",
        loginId: "login-1",
      });
      // The real server notifies once the OAuth dance finishes; the mock's
      // "user" signs in instantly.
      signedIn = true;
      notify("account/login/completed", { success: true, loginId: "login-1" });
      return;
    case "account/login/cancel":
      if (params?.loginId === pendingLoginId) {
        pendingLoginId = null;
        return respond(id, { status: "canceled" });
      }
      return respond(id, { status: "notFound" });
    case "account/logout":
      signedIn = false;
      return respond(id, {});
    case "windowsSandbox/readiness":
      return respond(id, { status: sandboxConfigured ? "ready" : "notConfigured" });
    case "windowsSandbox/setupStart":
      respond(id, { started: true });
      sandboxConfigured = true;
      notify("windowsSandbox/setupCompleted", { success: true, mode: params?.mode ?? "unelevated" });
      return;
    case "account/read":
      return respond(id, {
        account: signedIn
          ? { type: "chatgpt", email: "mock@example.com", planType: "plus" }
          : null,
        requiresOpenaiAuth: !signedIn,
      });
    case "thread/start":
      return respond(id, { thread: { id: SCOPE.threadId } });
    case "turn/start":
      respond(id, { turn: { id: SCOPE.turnId } });
      runTurn();
      return;
    default:
      return respondError(id, -32601, `mock peer: unhandled method ${method}`);
  }
}

function handleNotification({ method }) {
  if (method === "initialized") {
    if (initializeSeen) initialized = true;
  }
}

function handleResponse(message) {
  const callback = pendingServerRequests.get(message.id);
  if (!callback) return;
  pendingServerRequests.delete(message.id);
  callback(message);
}

let remainder = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  remainder += chunk;
  const lines = remainder.split("\n");
  remainder = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method !== undefined && message.id !== undefined) handleRequest(message);
    else if (message.method !== undefined) handleNotification(message);
    else if (message.id !== undefined) handleResponse(message);
  }
});

process.stdin.on("end", () => process.exit(0));
