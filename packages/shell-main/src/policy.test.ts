import { describe, expect, test } from "vitest";
import { PolicyEngine, type PolicyDecisionRecord } from "./policy.js";

function engine(policy: ConstructorParameters<typeof PolicyEngine>[0]["policy"]) {
  return new PolicyEngine({ policy, workspaceDir: "/data/workspace" });
}

describe("PolicyEngine.decide — command execution (FR-5.1/5.2/5.3)", () => {
  test("a command matching no allowlist rule is declined, not cancelled (default deny)", () => {
    const decision = engine({}).decide("commandExecution", {
      command: ["curl", "example.com"],
      cwd: "/data/workspace",
    });
    // Exact wire value per schema.gen.ts: "decline" lets the turn continue
    // (FR-5.3); "cancel" would abort it and must never be produced.
    expect(decision).toEqual({ decision: "decline" });
  });

  test("a command matching an allowlist argv prefix is accepted", () => {
    const policy = { allowCommands: [["python3"], ["pandoc"]] };
    expect(
      engine(policy).decide("commandExecution", {
        command: ["python3", "scripts/translate.py", "--chunk", "4"],
      }),
    ).toEqual({ decision: "accept" });
    // The prefix is anchored: a hit elsewhere in the argv must not match.
    expect(
      engine(policy).decide("commandExecution", {
        command: ["bash", "-lc", "python3 evil.py"],
      }),
    ).toEqual({ decision: "decline" });
  });

  test("a command matching a session-scoped pattern is accepted for the session (hot path)", () => {
    expect(
      engine({
        allowCommands: [["pandoc"]],
        allowCommandsForSession: [["python3"]],
      }).decide("commandExecution", { command: ["python3", "main.py"] }),
    ).toEqual({ decision: "acceptForSession" });
  });

  test("a string command (the schema wire shape) is tokenized and matched", () => {
    const policy = { allowCommands: [["pandoc", "--from"]] };
    expect(
      engine(policy).decide("commandExecution", {
        command: "pandoc --from epub book.epub",
      }),
    ).toEqual({ decision: "accept" });
    expect(
      engine(policy).decide("commandExecution", { command: "curl example.com" }),
    ).toEqual({ decision: "decline" });
  });

  test("a malformed request without a command is declined (fail closed)", () => {
    expect(engine({ allowCommands: [["python3"]] }).decide("commandExecution", {})).toEqual({
      decision: "decline",
    });
    expect(
      engine({ allowCommands: [["python3"]] }).decide("commandExecution", {
        command: 42 as unknown as string,
      }),
    ).toEqual({ decision: "decline" });
  });
});

describe("PolicyEngine.decide — file changes (FR-5.1/5.2)", () => {
  test("file changes are declined unless the policy allows them", () => {
    expect(engine({}).decide("fileChange", { itemId: "item-1" })).toEqual({
      decision: "decline",
    });
    expect(
      engine({ allowFileChanges: true }).decide("fileChange", { itemId: "item-1" }),
    ).toEqual({ decision: "accept" });
  });

  test("a grant root outside the workspace is declined even when file changes are allowed", () => {
    const allowed = engine({ allowFileChanges: true });
    expect(
      allowed.decide("fileChange", { itemId: "item-1", grantRoot: "/data/workspace/out" }),
    ).toEqual({ decision: "accept" });
    expect(
      allowed.decide("fileChange", { itemId: "item-1", grantRoot: "/home/user/.ssh" }),
    ).toEqual({ decision: "decline" });
    // Prefix trickery: /data/workspace-evil is not inside /data/workspace.
    expect(
      allowed.decide("fileChange", { itemId: "item-1", grantRoot: "/data/workspace-evil" }),
    ).toEqual({ decision: "decline" });
  });
});

describe("Translate-Book policy table (FR-5.5, Phase 8)", () => {
  // The exact allowlist apps/translate-book bakes into its manifest.
  const TRANSLATE_BOOK = {
    allowCommands: [["python3"], ["pandoc"], ["ebook-convert"]],
    allowFileChanges: true,
  };

  test.each([
    [["python3", "scripts/convert.py", "book.epub"], "accept"],
    [["pandoc", "--from", "epub", "--to", "html", "book.epub"], "accept"],
    [["ebook-convert", "book.html", "book.epub"], "accept"],
  ])("its bundled tools are allowed: %j", (command, decision) => {
    expect(engine(TRANSLATE_BOOK).decide("commandExecution", { command })).toEqual({ decision });
  });

  test.each([
    [["curl", "https://example.com"]], // network is off (FR-5.5)
    [["rm", "-rf", "/"]],
    [["bash", "-lc", "python3 evil.py"]], // anchored prefix: python3 must be argv[0]
    [["pip", "install", "requests"]],
  ])("everything else is denied (default deny, network off): %j", (command) => {
    expect(engine(TRANSLATE_BOOK).decide("commandExecution", { command })).toEqual({
      decision: "decline",
    });
  });

  test("file changes within the workspace are accepted (workspace-write)", () => {
    expect(
      engine(TRANSLATE_BOOK).decide("fileChange", {
        itemId: "i1",
        grantRoot: "/data/workspace/alice_temp",
      }),
    ).toEqual({ decision: "accept" });
  });
});

describe("PolicyEngine decision trail (FR-5.4)", () => {
  test("every decision reports the request, the matched rule, and the decision", () => {
    const records: PolicyDecisionRecord[] = [];
    const logged = new PolicyEngine({
      policy: { allowCommands: [["python3"]], allowFileChanges: true },
      workspaceDir: "/data/workspace",
      onDecision: (record) => records.push(record),
    });

    logged.decide("commandExecution", { command: ["python3", "main.py"], cwd: "/data/workspace" });
    logged.decide("commandExecution", { command: ["curl", "example.com"] });
    logged.decide("fileChange", { itemId: "item-1" });

    expect(records).toEqual([
      {
        kind: "commandExecution",
        request: { command: "python3 main.py", cwd: "/data/workspace" },
        matchedRule: "allowCommands: python3",
        decision: "accept",
      },
      {
        kind: "commandExecution",
        request: { command: "curl example.com" },
        matchedRule: null,
        decision: "decline",
      },
      {
        kind: "fileChange",
        request: {},
        matchedRule: "allowFileChanges",
        decision: "accept",
      },
    ]);
  });
});
