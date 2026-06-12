import type { AgentAdapter } from "@foreman/codex-adapter";
import type { AccountInfo, AuthState } from "./ipc.js";

export interface AuthControllerOptions {
  adapter: AgentAdapter;
  /** Opens the OAuth authUrl in the system browser (Electron: shell.openExternal). */
  openExternal: (url: string) => void;
}

/**
 * Owns the auth half of the IPC contract: turns AgentAdapter calls and events
 * into the AuthState stream the renderer subscribes to (FR-3.1/3.2/3.3/3.4).
 * Never touches tokens — credential storage stays in codex's home (FR-3.5).
 */
export class AuthController {
  private readonly adapter: AgentAdapter;
  private readonly openExternal: (url: string) => void;
  private readonly handlers = new Set<(state: AuthState) => void>();
  private state: AuthState = { status: "checking" };
  private pendingLoginId: string | undefined;

  constructor(options: AuthControllerOptions) {
    this.adapter = options.adapter;
    this.openExternal = options.openExternal;
    this.adapter.on("loginCompleted", (payload) => {
      this.pendingLoginId = undefined;
      if (payload.success) {
        void this.refreshAccount();
      } else {
        this.setState({
          status: "loginFailed",
          message: payload.error ?? "login did not complete",
        });
      }
    });
    this.adapter.on("error", (payload) => {
      this.setState({ status: "agentError", message: payload.message });
    });
  }

  get current(): AuthState {
    return this.state;
  }

  onChange(handler: (state: AuthState) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Initial account/read on startup (FR-3.1). */
  async initialize(): Promise<void> {
    await this.refreshAccount();
  }

  async startLogin(type: "chatgpt" | "chatgptDeviceCode"): Promise<void> {
    try {
      const login = await this.adapter.startLogin({ type });
      this.pendingLoginId = login.loginId;
      if (login.type === "chatgpt") {
        this.setState({ status: "loginPending", flow: { type: "chatgpt", authUrl: login.authUrl } });
        this.openExternal(login.authUrl);
      } else {
        this.setState({
          status: "loginPending",
          flow: {
            type: "chatgptDeviceCode",
            userCode: login.userCode,
            verificationUrl: login.verificationUrl,
          },
        });
      }
    } catch (error) {
      this.setState({ status: "loginFailed", message: (error as Error).message });
    }
  }

  /** Cancels a pending login and falls back to the signed-out choice screen. */
  async cancelLogin(): Promise<void> {
    const loginId = this.pendingLoginId;
    this.pendingLoginId = undefined;
    if (loginId) {
      await this.adapter.cancelLogin(loginId).catch(() => {
        // Already completed or unknown — account refresh below settles the state.
      });
    }
    await this.refreshAccount();
  }

  async logout(): Promise<void> {
    await this.adapter.logout();
    await this.refreshAccount();
  }

  private async refreshAccount(): Promise<void> {
    try {
      const result = await this.adapter.readAccount();
      this.setState(
        result.account
          ? { status: "signedIn", account: result.account as AccountInfo }
          : { status: "signedOut" },
      );
    } catch (error) {
      this.setState({ status: "agentError", message: (error as Error).message });
    }
  }

  private setState(state: AuthState): void {
    this.state = state;
    for (const handler of this.handlers) handler(state);
  }
}
