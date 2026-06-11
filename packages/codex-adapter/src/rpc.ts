import type { Readable, Writable } from "node:stream";

export interface JsonRpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

export type NotificationHandler = (params: unknown) => void;
export type ServerRequestHandler = (params: unknown) => unknown | Promise<unknown>;

export interface JsonRpcConnectionOptions {
  onUnparseableLine?: (line: string) => void;
}

interface PendingRequest {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

interface IncomingMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcErrorShape;
}

/**
 * JSON-RPC 2.0 over newline-delimited JSON on a stream pair
 * (the `codex app-server` wire format).
 */
export class JsonRpcConnection {
  private nextId = 1;
  private readonly pending = new Map<number | string, PendingRequest>();
  private readonly notificationHandlers = new Map<string, NotificationHandler>();
  private readonly serverRequestHandlers = new Map<string, ServerRequestHandler>();
  private readonly onUnparseableLine: (line: string) => void;
  private buffer = "";

  constructor(
    input: Readable,
    private readonly output: Writable,
    options: JsonRpcConnectionOptions = {},
  ) {
    this.onUnparseableLine = options.onUnparseableLine ?? (() => {});
    input.on("data", (chunk: Buffer | string) => {
      this.buffer += chunk.toString("utf8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) this.handleLine(line);
      }
    });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { method, resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  onServerRequest(method: string, handler: ServerRequestHandler): void {
    this.serverRequestHandlers.set(method, handler);
  }

  /** Reject every in-flight request (e.g. the peer process died). */
  failPending(error: Error): void {
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
  }

  private send(message: unknown): void {
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: IncomingMessage;
    try {
      message = JSON.parse(line) as IncomingMessage;
    } catch {
      this.onUnparseableLine(line);
      return;
    }

    if (message.id !== undefined && message.method === undefined) {
      this.handleResponse(message);
    } else if (message.id !== undefined && message.method !== undefined) {
      this.handleServerRequest(message as IncomingMessage & { id: number | string; method: string });
    } else if (message.method !== undefined) {
      this.notificationHandlers.get(message.method)?.(message.params);
    }
  }

  private handleResponse(message: IncomingMessage): void {
    const entry = this.pending.get(message.id!);
    if (!entry) return;
    this.pending.delete(message.id!);
    if (message.error) {
      entry.reject(
        new Error(`${entry.method}: ${message.error.message} (code ${message.error.code})`),
      );
    } else {
      entry.resolve(message.result);
    }
  }

  private handleServerRequest(
    message: IncomingMessage & { id: number | string; method: string },
  ): void {
    const handler = this.serverRequestHandlers.get(message.method);
    if (!handler) {
      this.send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `no handler for ${message.method}` },
      });
      return;
    }
    Promise.resolve(handler(message.params)).then(
      (result) => this.send({ jsonrpc: "2.0", id: message.id, result }),
      (error: unknown) =>
        this.send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        }),
    );
  }
}
