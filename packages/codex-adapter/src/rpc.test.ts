import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { JsonRpcConnection } from "./rpc.js";

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** An in-process fake peer: two streams plus a parsed log of what the client wrote. */
function makePeer(options?: { onUnparseableLine?: (line: string) => void }) {
  const fromPeer = new PassThrough();
  const toPeer = new PassThrough();
  const conn = new JsonRpcConnection(fromPeer, toPeer, options);

  const sent: JsonRpcMessage[] = [];
  let buf = "";
  toPeer.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) sent.push(JSON.parse(line) as JsonRpcMessage);
    }
  });

  const receive = (msg: JsonRpcMessage) => {
    fromPeer.write(`${JSON.stringify(msg)}\n`);
  };
  const receiveRaw = (text: string) => {
    fromPeer.write(text);
  };
  const sentCount = async (n: number) => {
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(n));
    return sent;
  };

  return { conn, sent, receive, receiveRaw, sentCount };
}

describe("request/response correlation", () => {
  test("interleaved responses resolve the matching requests", async () => {
    const peer = makePeer();

    const first = peer.conn.request("thread/start", { cwd: "/tmp/a" });
    const second = peer.conn.request("account/read", {});
    const [reqA, reqB] = await peer.sentCount(2);

    expect(reqA?.method).toBe("thread/start");
    expect(reqB?.method).toBe("account/read");
    expect(reqA?.id).not.toBe(reqB?.id);

    // Respond out of order: second request first.
    peer.receive({ id: reqB!.id, result: { account: null } });
    peer.receive({ id: reqA!.id, result: { thread: { id: "t-1" } } });

    await expect(second).resolves.toEqual({ account: null });
    await expect(first).resolves.toEqual({ thread: { id: "t-1" } });
  });

  test("error response rejects with the method name and error message", async () => {
    const peer = makePeer();

    const pending = peer.conn.request("turn/start", { threadId: "nope" });
    const [req] = await peer.sentCount(1);

    peer.receive({ id: req!.id, error: { code: -32600, message: "no such thread" } });

    await expect(pending).rejects.toThrow(/turn\/start/);
    await expect(pending).rejects.toThrow(/no such thread/);
  });
});

describe("malformed input", () => {
  test("an unparseable line is reported and skipped without breaking the connection", async () => {
    const badLines: string[] = [];
    const peer = makePeer({ onUnparseableLine: (line) => badLines.push(line) });

    const pending = peer.conn.request("account/read", {});
    const [req] = await peer.sentCount(1);

    peer.receiveRaw("this is not json\n");
    peer.receive({ id: req!.id, result: { account: null } });

    await expect(pending).resolves.toEqual({ account: null });
    expect(badLines).toEqual(["this is not json"]);
  });
});

describe("server -> client requests", () => {
  test("registered handler's value is sent back as the response with the same id", async () => {
    const peer = makePeer();
    const seenParams: unknown[] = [];
    peer.conn.onServerRequest("item/commandExecution/requestApproval", (params) => {
      seenParams.push(params);
      return { decision: "decline" };
    });

    peer.receive({
      id: 9001,
      method: "item/commandExecution/requestApproval",
      params: { command: ["rm", "-rf", "/"] },
    });

    const [response] = await peer.sentCount(1);
    expect(response).toEqual({ jsonrpc: "2.0", id: 9001, result: { decision: "decline" } });
    expect(seenParams).toEqual([{ command: ["rm", "-rf", "/"] }]);
  });

  test("a server request with no registered handler gets a JSON-RPC error back", async () => {
    const peer = makePeer();

    peer.receive({ id: 9002, method: "some/unknown/request", params: {} });

    const [response] = await peer.sentCount(1);
    expect(response?.id).toBe(9002);
    expect(response?.error?.code).toBe(-32601);
  });
});

describe("notifications", () => {
  test("scripted delta notifications arrive in order and concatenate to the full message", async () => {
    const peer = makePeer();
    let assembled = "";
    peer.conn.onNotification("item/agentMessage/delta", (params) => {
      assembled += (params as { delta: string }).delta;
    });

    for (const delta of ["Hel", "lo ", "world"]) {
      peer.receive({ method: "item/agentMessage/delta", params: { delta } });
    }
    // A request/response after the deltas guarantees they have been flushed through.
    const pending = peer.conn.request("account/read", {});
    const sent = await peer.sentCount(1);
    peer.receive({ id: sent[0]!.id, result: {} });
    await pending;

    expect(assembled).toBe("Hello world");
  });
});
