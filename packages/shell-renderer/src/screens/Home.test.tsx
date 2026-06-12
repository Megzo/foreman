// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

afterEach(cleanup);
import { App } from "../App.js";
import { makeFakeShell } from "../test-helpers.js";

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
