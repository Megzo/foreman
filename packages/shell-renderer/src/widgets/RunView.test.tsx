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

  test("progress events render a chunk N-of-M bar reflecting the latest update (Phase 8)", () => {
    renderRun([
      { type: "runStarted", taskId: "echo" },
      { type: "progress", current: 10, total: 120 },
      { type: "progress", current: 47, total: 120, label: "3. fejezet" },
    ]);

    const bar = screen.getByTestId("run-progress");
    // Latest update wins; the user sees a count, never raw item events.
    expect(bar.textContent).toMatch(/47.*120/);
    expect(bar.textContent).toMatch(/3\. fejezet/);
    const meter = bar.querySelector("progress");
    expect(meter?.getAttribute("value")).toBe("47");
    expect(meter?.getAttribute("max")).toBe("120");
  });

  test("with no progress event there is no progress bar", () => {
    renderRun([
      { type: "runStarted", taskId: "echo" },
      { type: "agentDelta", text: "working" },
    ]);
    expect(screen.queryByTestId("run-progress")).toBeNull();
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

  test("a successful run with outputs lists the files and offers an Open-folder button (FR-6.3)", () => {
    const opened: string[] = [];
    render(
      <RunView
        task={TASK}
        events={[
          { type: "runStarted", taskId: "echo" },
          {
            type: "finished",
            status: "success",
            outputDir: "/home/u/Documents/App/alice",
            outputFiles: ["alice.epub", "alice.pdf"],
          },
        ]}
        onOpenOutput={(dir) => opened.push(dir)}
      />,
    );

    const success = screen.getByTestId("run-success");
    expect(success.textContent).toMatch(/alice\.epub/);
    expect(success.textContent).toMatch(/alice\.pdf/);
    const openButton = screen.getByRole("button", { name: /mappa megnyitása/i });
    openButton.click();
    expect(opened).toEqual(["/home/u/Documents/App/alice"]);
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

  test("a cancelled run shows the cancelled terminal state (FR-4.6, Phase 6)", () => {
    renderRun([
      { type: "runStarted", taskId: "echo" },
      { type: "finished", status: "cancelled" },
    ]);

    expect(screen.getByTestId("run-cancelled").textContent).toMatch(/megszakítva/i);
    expect(screen.queryByTestId("run-success")).toBeNull();
    expect(screen.queryByTestId("run-failed")).toBeNull();
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
