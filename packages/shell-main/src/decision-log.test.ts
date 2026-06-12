import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DecisionLog } from "./decision-log.js";
import { PolicyEngine } from "./policy.js";

let dir: string;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("DecisionLog (FR-5.4)", () => {
  test("each policy decision appends one JSON line with request, matched rule, and decision", async () => {
    dir = await mkdtemp(join(tmpdir(), "foreman-log-"));
    const logFile = join(dir, "logs", "decisions.jsonl");
    const log = new DecisionLog(logFile);
    const engine = new PolicyEngine({
      policy: { allowCommands: [["python3"]] },
      workspaceDir: "/data/workspace",
      onDecision: (record) => log.append(record),
    });

    engine.decide("commandExecution", { command: ["python3", "main.py"] });
    engine.decide("commandExecution", { command: ["curl", "example.com"] });

    const lines = (await readFile(logFile, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "commandExecution",
      request: { command: "python3 main.py" },
      matchedRule: "allowCommands: python3",
      decision: "accept",
    });
    expect(JSON.parse(lines[1]!)).toMatchObject({
      matchedRule: null,
      decision: "decline",
    });
    expect(typeof JSON.parse(lines[0]!).time).toBe("string");
  });
});
