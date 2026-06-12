// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

afterEach(cleanup);
import { App } from "./App.js";
import { makeFakeShell } from "./test-helpers.js";

describe("screen state machine over the IPC contract (Phase 3)", () => {
  test("a scripted signed-out -> pending -> signed-in sequence walks login -> pending -> home", async () => {
    const shell = makeFakeShell();
    render(<App api={shell.api} />);

    // Boot + initial "checking" state: no screen has committed yet.
    expect(await screen.findByTestId("screen-loading")).toBeTruthy();

    act(() => shell.pushAuth({ status: "signedOut" }));
    const loginButton = await screen.findByRole("button", {
      name: /Bejelentkezés ChatGPT-fiókkal/,
    });
    expect(loginButton).toBeTruthy();

    act(() =>
      shell.pushAuth({
        status: "loginPending",
        flow: { type: "chatgpt", authUrl: "https://auth.example.com/x" },
      }),
    );
    expect(await screen.findByTestId("login-pending")).toBeTruthy();

    act(() =>
      shell.pushAuth({
        status: "signedIn",
        account: { type: "chatgpt", email: "user@example.com" },
      }),
    );
    // Home: branding + the manifest's task launcher card (visible, not yet functional).
    expect(await screen.findByRole("heading", { name: "Echo Demo" })).toBeTruthy();
    expect(screen.getByText("Visszhang futtatása")).toBeTruthy();
  });

  test("a manifest validation failure renders the startup error naming the field (FR-1.2)", async () => {
    const shell = makeFakeShell({
      ok: false,
      error: "Invalid manifest field tasks[0].skill: expected an object",
    });
    render(<App api={shell.api} />);

    expect(await screen.findByTestId("screen-startup-error")).toBeTruthy();
    expect(screen.getByText(/tasks\[0\]\.skill/)).toBeTruthy();
  });

  test("clicking the login button asks main to start the chatgpt browser flow", async () => {
    const shell = makeFakeShell();
    render(<App api={shell.api} />);
    act(() => shell.pushAuth({ status: "signedOut" }));

    (await screen.findByRole("button", { name: /Bejelentkezés ChatGPT-fiókkal/ })).click();

    expect(shell.calls).toEqual(["startLogin:chatgpt"]);
  });

  test("a codex-process death shows a calm restart banner with one-click resume (FR-2.5)", async () => {
    const shell = makeFakeShell();
    render(<App api={shell.api} />);
    act(() =>
      shell.pushAuth({
        status: "agentError",
        message: "codex process exited unexpectedly (code=1)",
      }),
    );

    expect(await screen.findByTestId("restart-banner")).toBeTruthy();
    // Reassuring wording — never the raw crash line in the user's face.
    expect(screen.getByText(/háttérszolgáltatás/)).toBeTruthy();

    (await screen.findByRole("button", { name: /Folytatás/ })).click();
    expect(shell.calls).toContain("restartAgent");
  });
});
