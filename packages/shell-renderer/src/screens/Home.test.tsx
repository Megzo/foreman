// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type { RunRecord } from "@foreman/shell-main/ipc";

afterEach(cleanup);
import { App } from "../App.js";
import { makeFakeShell, type FakeShell } from "../test-helpers.js";

function renderSignedInHome() {
  const shell = makeFakeShell();
  render(<App api={shell.api} />);
  act(() =>
    shell.pushAuth({
      status: "signedIn",
      account: { type: "chatgpt", email: "user@example.com", planType: "plus" },
    }),
  );
  return shell;
}

function signIn(shell: FakeShell) {
  render(<App api={shell.api} />);
  act(() => shell.pushAuth({ status: "signedIn", account: { type: "chatgpt" } }));
}

function makeRun(overrides: Partial<RunRecord>): RunRecord {
  return {
    runId: "r1",
    taskId: "echo",
    params: {},
    status: "success",
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:01:00.000Z",
    ...overrides,
  };
}

describe("task launch flow (Phase 4: launcher -> form -> run -> terminal state)", () => {
  test("clicking the launcher card opens the task's param form", async () => {
    renderSignedInHome();

    fireEvent.click(await screen.findByRole("button", { name: /Visszhang futtatása/ }));

    expect(await screen.findByRole("textbox", { name: /Üzenet/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Indítás/ })).toBeTruthy();
  });

  test("submitting the form launches the task and streams events into the running view", async () => {
    const shell = renderSignedInHome();

    fireEvent.click(await screen.findByRole("button", { name: /Visszhang futtatása/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: /Üzenet/ }), {
      target: { value: "szia" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Indítás/ }));

    expect(shell.launches).toEqual([{ taskId: "echo", params: { message: "szia" } }]);

    act(() => {
      shell.pushTask({ type: "runStarted", taskId: "echo" });
      shell.pushTask({ type: "agentDelta", text: "kész" });
    });
    expect((await screen.findByTestId("run-message")).textContent).toBe("kész");

    act(() => shell.pushTask({ type: "finished", status: "success" }));
    expect(await screen.findByTestId("run-success")).toBeTruthy();
  });

  test("after a finished run a back button returns to the launcher home", async () => {
    const shell = renderSignedInHome();

    fireEvent.click(await screen.findByRole("button", { name: /Visszhang futtatása/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: /Üzenet/ }), {
      target: { value: "szia" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Indítás/ }));
    act(() => shell.pushTask({ type: "finished", status: "success" }));

    fireEvent.click(await screen.findByRole("button", { name: /Vissza/ }));

    expect(await screen.findByRole("button", { name: /Visszhang futtatása/ })).toBeTruthy();
  });
});

describe("home history list (FR-7.3)", () => {
  test("past runs appear in the history list with their localized status", async () => {
    const shell = makeFakeShell();
    shell.runs = [
      makeRun({ runId: "r1", status: "success" }),
      makeRun({ runId: "r2", status: "failed", createdAt: "2026-06-12T09:00:00.000Z" }),
    ];
    signIn(shell);

    const history = await screen.findByTestId("run-history");
    expect(history.textContent).toMatch(/Visszhang futtatása/); // task label, not raw id
    expect(history.textContent).toMatch(/Kész/); // success
    expect(history.textContent).toMatch(/Sikertelen/); // failed
  });

  test("an empty history shows a friendly explanation, not a blank panel", async () => {
    const shell = makeFakeShell();
    signIn(shell);

    expect(await screen.findByTestId("history-empty")).toBeTruthy();
  });
});

describe("home resume offer (FR-7.2)", () => {
  test("a crashed in-progress run is offered for resume; Folytatás resumes it into the run view", async () => {
    const shell = makeFakeShell();
    shell.resumable = makeRun({ runId: "stale-1", taskId: "echo", status: "running", threadId: "t1" });
    signIn(shell);

    fireEvent.click(await screen.findByRole("button", { name: /Folytatás/ }));

    expect(shell.calls).toContain("resumeRun:stale-1");
    // The run view (not the param form) renders — the resumed turn streams in.
    expect(await screen.findByTestId("run-status")).toBeTruthy();
  });

  test("Új indítása declines the offer so the stale run is finalized and not re-offered", async () => {
    const shell = makeFakeShell();
    shell.resumable = makeRun({ runId: "stale-1", taskId: "echo", status: "running", threadId: "t1" });
    signIn(shell);

    fireEvent.click(await screen.findByRole("button", { name: /Új indítása/ }));

    expect(shell.calls).toContain("dismissResume:stale-1");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Folytatás/ })).toBeNull(),
    );
  });
});

describe("home settings menu (FR-3.4)", () => {
  test("shows the signed-in account and the shell version", async () => {
    renderSignedInHome();

    fireEvent.click(await screen.findByRole("button", { name: /Beállítások/ }));

    expect(await screen.findByText("user@example.com")).toBeTruthy();
    expect(screen.getByText(/0\.0\.1/)).toBeTruthy();
  });

  test("logout asks main to log out", async () => {
    const shell = renderSignedInHome();

    fireEvent.click(await screen.findByRole("button", { name: /Beállítások/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Kijelentkezés/ }));

    expect(shell.calls).toEqual(["logout"]);
  });
});
