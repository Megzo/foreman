// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

afterEach(cleanup);
import { TaskScreen } from "./Task.js";
import { makeFakeShell, TEST_MANIFEST } from "../test-helpers.js";

function renderLaunchedTask() {
  const shell = makeFakeShell();
  render(<TaskScreen task={TEST_MANIFEST.tasks[0]!} api={shell.api} onBack={() => {}} />);

  // Through the param form into the running view, like a real user.
  fireEvent.change(screen.getByRole("textbox", { name: /Üzenet/ }), {
    target: { value: "szia" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Indítás/ }));
  act(() => shell.pushTask({ type: "runStarted", taskId: "echo" }));
  return shell;
}

describe("TaskScreen in-task chat (FR-4.3, Phase 6)", () => {
  test("a chat message mid-run is sent over IPC and appears in the transcript", () => {
    const shell = renderLaunchedTask();

    fireEvent.change(screen.getByRole("textbox", { name: /Üzenet a feladatnak/ }), {
      target: { value: "használj magázódást" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Üzenet küldése/ }));

    expect(shell.calls).toContain("sendChat:használj magázódást");
    expect(screen.getByTestId("chat-transcript").textContent).toContain("használj magázódást");
  });

  test("the chat stays available after a successful run for follow-ups (UX requirement)", () => {
    const shell = renderLaunchedTask();

    act(() => shell.pushTask({ type: "finished", status: "success" }));

    expect(screen.getByRole("textbox", { name: /Üzenet a feladatnak/ })).toBeTruthy();
  });
});

describe("TaskScreen cancel flow (FR-4.5, Phase 6)", () => {
  test("cancel asks for confirmation and only interrupts once confirmed", () => {
    const shell = renderLaunchedTask();

    fireEvent.click(screen.getByRole("button", { name: /Megszakítás/ }));
    expect(shell.calls).not.toContain("cancelTask");
    expect(screen.getByText(/Biztosan megszakítod/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Igen, megszakítom/ }));
    expect(shell.calls).toContain("cancelTask");
  });

  test("declining the confirmation keeps the run going", () => {
    const shell = renderLaunchedTask();

    fireEvent.click(screen.getByRole("button", { name: /Megszakítás/ }));
    fireEvent.click(screen.getByRole("button", { name: /Nem/ }));

    expect(shell.calls).not.toContain("cancelTask");
    expect(screen.queryByText(/Biztosan megszakítod/)).toBeNull();
  });

  test("a finished run offers no cancel button", () => {
    const shell = renderLaunchedTask();

    act(() => shell.pushTask({ type: "finished", status: "cancelled" }));

    expect(screen.queryByRole("button", { name: /Megszakítás/ })).toBeNull();
    expect(screen.getByTestId("run-cancelled")).toBeTruthy();
  });
});

describe("TaskScreen user-input modal (FR-4.4, Phase 6)", () => {
  test("an agent question pops the modal and the answer returns with the request id", () => {
    const shell = renderLaunchedTask();

    act(() =>
      shell.pushUserInput({
        requestId: 7,
        questions: [
          {
            id: "tone",
            header: "Megszólítás",
            question: "Formális vagy informális megszólítást használjak?",
            options: [
              { label: "Formális", description: "magázódás" },
              { label: "Informális", description: "tegeződés" },
            ],
          },
        ],
      }),
    );

    fireEvent.click(screen.getByRole("radio", { name: /Formális/ }));
    fireEvent.click(screen.getByRole("button", { name: /Küldés/ }));

    expect(shell.userInputAnswers).toEqual([
      { requestId: 7, answers: { tone: { answers: ["Formális"] } } },
    ]);
    // Answered: the modal is gone.
    expect(screen.queryByRole("radio", { name: /Formális/ })).toBeNull();
  });
});
