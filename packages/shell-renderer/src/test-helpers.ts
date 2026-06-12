import type {
  AppManifest,
  AuthState,
  BootState,
  ShellApi,
  TaskEvent,
} from "@foreman/shell-main/ipc";

export const TEST_MANIFEST: AppManifest = {
  schemaVersion: 1,
  id: "echo-demo",
  name: "Echo Demo",
  version: "0.1.0",
  locale: "hu",
  branding: {
    productName: "Echo Demo",
    colors: { primary: "#1f6feb", background: "#f6f8fa" },
  },
  tasks: [
    {
      id: "echo",
      label: { hu: "Visszhang futtatása", en: "Run echo" },
      description: { hu: "Kiír egy üzenetet.", en: "Echoes a message." },
      skill: { name: "echo", path: "skill/SKILL.md" },
      params: [{ id: "message", type: "text", label: { hu: "Üzenet" }, required: true }],
    },
  ],
};

export interface FakeShell {
  api: ShellApi;
  /** Push an auth state to the subscribed renderer, as main would over IPC. */
  pushAuth(state: AuthState): void;
  /** Push a task event to the subscribed renderer, as main would over IPC. */
  pushTask(event: TaskEvent): void;
  /** Method invocations the UI made, e.g. "startLogin:chatgpt", "logout". */
  calls: string[];
  /** Params of each launchTask call, in order. */
  launches: Array<{ taskId: string; params: Record<string, string | number | boolean> }>;
}

export function makeFakeShell(boot: BootState = { ok: true, manifest: TEST_MANIFEST, shellVersion: "0.0.1" }): FakeShell {
  const handlers = new Set<(state: AuthState) => void>();
  const taskHandlers = new Set<(event: TaskEvent) => void>();
  let current: AuthState = { status: "checking" };
  const calls: string[] = [];
  const launches: FakeShell["launches"] = [];
  return {
    calls,
    launches,
    pushAuth(state) {
      current = state;
      for (const handler of handlers) handler(state);
    },
    pushTask(event) {
      for (const handler of taskHandlers) handler(event);
    },
    api: {
      getBootState: async () => boot,
      onAuthState(handler) {
        handlers.add(handler);
        handler(current);
        return () => handlers.delete(handler);
      },
      startLogin: async (type) => {
        calls.push(`startLogin:${type}`);
      },
      cancelLogin: async () => {
        calls.push("cancelLogin");
      },
      logout: async () => {
        calls.push("logout");
      },
      launchTask: async (taskId, params) => {
        calls.push(`launchTask:${taskId}`);
        launches.push({ taskId, params });
      },
      onTaskEvent(handler) {
        taskHandlers.add(handler);
        return () => taskHandlers.delete(handler);
      },
      pickFile: async () => "/home/user/picked.epub",
    },
  };
}
