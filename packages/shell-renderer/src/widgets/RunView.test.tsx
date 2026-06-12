// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

afterEach(cleanup);
import type { ManifestTask, TaskEvent } from "@foreman/shell-main/ipc";
import { RunView } from "./RunView.js";

const TASK: ManifestTask = {
  id: "echo",
  label: { hu: "Visszhang futtatása" },
  skill: { name: "echo", path: "skill/SKILL.md" },
};

function renderRun(events: TaskEvent[]) {
  render(<RunView task={TASK} events={events} />);
}

describe("RunView renders from a recorded event stream (Phase 4)", () => {
  test("a run in progress shows the status line and the streamed message so far", () => {
    renderRun([
      { type: "runStarted", taskId: "echo" },
      { type: "itemStarted", itemType: "agentMessage" },
      { type: "agentDelta", text: "Szia " },
      { type: "agentDelta", text: "világ" },
    ]);

    expect(screen.getByTestId("run-status").textContent).toMatch(/Folyamatban/);
    expect(screen.getByTestId("run-message").textContent).toBe("Szia világ");
  });

  test("item events appear as human-readable feed lines, never raw item types (UX requirement)", () => {
    renderRun([
      { type: "runStarted", taskId: "echo" },
      { type: "itemStarted", itemType: "commandExecution" },
      { type: "itemCompleted", itemType: "commandExecution" },
    ]);

    const feed = screen.getByTestId("run-feed");
    expect(feed.textContent).toMatch(/Lépés végrehajtása/);
    expect(feed.textContent).not.toMatch(/commandExecution/);
  });

  test("reasoning items collapse to a thinking indicator, with no reasoning content (FR-4.7)", () => {
    renderRun([
      { type: "runStarted", taskId: "echo" },
      { type: "itemStarted", itemType: "reasoning" },
      { type: "itemStarted", itemType: "reasoning" },
    ]);

    expect(screen.getAllByText(/Gondolkodik/)).toHaveLength(1);
    expect(screen.queryByText(/reasoning/)).toBeNull();
  });

  test("a successful run shows the success terminal state (FR-4.6)", () => {
    renderRun([
      { type: "runStarted", taskId: "echo" },
      { type: "agentDelta", text: "done" },
      { type: "finished", status: "success" },
    ]);

    expect(screen.getByTestId("run-success")).toBeTruthy();
    expect(screen.queryByTestId("run-failed")).toBeNull();
  });

  test("a policy denial appears as a friendly localized feed line and the run stays live (FR-5.3)", () => {
    renderRun([
      { type: "runStarted", taskId: "echo" },
      { type: "itemStarted", itemType: "commandExecution" },
      { type: "actionDenied", kind: "commandExecution" },
    ]);

    const feed = screen.getByTestId("run-feed");
    expect(feed.textContent).toMatch(/nem engedélyezi/);
    expect(feed.textContent).not.toMatch(/decline|denied|commandExecution/);
    expect(screen.getByTestId("run-status").textContent).toMatch(/Folyamatban/);
  });

  test("a failed run shows the failed state with a friendly cause line (FR-4.6)", () => {
    renderRun([
      { type: "runStarted", taskId: "echo" },
      { type: "finished", status: "failed", errorMessage: "mock model exploded" },
    ]);

    expect(screen.getByTestId("run-failed").textContent).toMatch(/mock model exploded/);
    expect(screen.queryByTestId("run-success")).toBeNull();
  });
});
