import { relative, isAbsolute } from "node:path";
import type {
  ApprovalResponse,
  CommandApprovalRequest,
  FileChangeApprovalRequest,
} from "@foreman/codex-adapter";
import type { ManifestPolicy } from "./manifest-types.js";

export type ApprovalKind = "commandExecution" | "fileChange";

/** One line of the decision trail (FR-5.4): request, matched rule, decision. */
export interface PolicyDecisionRecord {
  kind: ApprovalKind;
  request: { command?: string; cwd?: string; grantRoot?: string; reason?: string };
  /** The rule that produced the decision; null means default deny. */
  matchedRule: string | null;
  decision: ApprovalResponse["decision"];
}

export interface PolicyEngineOptions {
  policy?: ManifestPolicy;
  /** The provisioned workspace dir — the only root file changes may target. */
  workspaceDir: string;
  /** Decision-trail sink (FR-5.4); wired to the local log file by the shell. */
  onDecision?: (record: PolicyDecisionRecord) => void;
}

/**
 * Answers every approval request from the manifest policy, never a dialog
 * (FR-5.1). Decisions are the exact wire values codex 0.138.0 accepts
 * (schema.gen.ts CommandExecutionApprovalDecision): "accept",
 * "acceptForSession", or "decline" — never "cancel", which would abort the
 * turn instead of letting it continue past the denial (FR-5.3).
 */
export class PolicyEngine {
  private readonly policy: ManifestPolicy;
  private readonly workspaceDir: string;
  private readonly onDecision: (record: PolicyDecisionRecord) => void;

  constructor(options: PolicyEngineOptions) {
    this.policy = options.policy ?? {};
    this.workspaceDir = options.workspaceDir;
    this.onDecision = options.onDecision ?? (() => {});
  }

  decide(kind: "commandExecution", request: CommandApprovalRequest): ApprovalResponse;
  decide(kind: "fileChange", request: FileChangeApprovalRequest): ApprovalResponse;
  decide(
    kind: ApprovalKind,
    request: CommandApprovalRequest | FileChangeApprovalRequest,
  ): ApprovalResponse {
    const record =
      kind === "commandExecution"
        ? this.decideCommand(request as CommandApprovalRequest)
        : this.decideFileChange(request as FileChangeApprovalRequest);
    this.onDecision(record);
    return { decision: record.decision };
  }

  private decideCommand(request: CommandApprovalRequest): PolicyDecisionRecord {
    const argv = commandArgv(request.command);
    const summary: PolicyDecisionRecord["request"] = {};
    if (argv) summary.command = argv.join(" ");
    if (typeof request.cwd === "string") summary.cwd = request.cwd;

    const base = { kind: "commandExecution" as const, request: summary };
    if (!argv) {
      return { ...base, matchedRule: null, decision: "decline" };
    }
    // Session patterns first: they are the more deliberate authoring choice
    // (one approval covers the whole session) when a command matches both.
    const sessionRule = matchPrefix(this.policy.allowCommandsForSession, argv);
    if (sessionRule) {
      return {
        ...base,
        matchedRule: `allowCommandsForSession: ${sessionRule.join(" ")}`,
        decision: "acceptForSession",
      };
    }
    const rule = matchPrefix(this.policy.allowCommands, argv);
    if (rule) {
      return { ...base, matchedRule: `allowCommands: ${rule.join(" ")}`, decision: "accept" };
    }
    return { ...base, matchedRule: null, decision: "decline" };
  }

  private decideFileChange(request: FileChangeApprovalRequest): PolicyDecisionRecord {
    const summary: PolicyDecisionRecord["request"] = {};
    if (typeof request.grantRoot === "string") summary.grantRoot = request.grantRoot;
    if (typeof request.reason === "string") summary.reason = request.reason;

    const base = { kind: "fileChange" as const, request: summary };
    if (this.policy.allowFileChanges !== true) {
      return { ...base, matchedRule: null, decision: "decline" };
    }
    // grantRoot asks for session-wide write access under a root; only the
    // workspace itself may be granted (FR-6: outputs leave via the shell copy).
    if (summary.grantRoot !== undefined && !isInside(this.workspaceDir, summary.grantRoot)) {
      return { ...base, matchedRule: null, decision: "decline" };
    }
    return { ...base, matchedRule: "allowFileChanges", decision: "accept" };
  }
}

function commandArgv(command: CommandApprovalRequest["command"]): string[] | undefined {
  if (Array.isArray(command) && command.every((part) => typeof part === "string")) {
    return command;
  }
  // codex 0.138.0 sends `command` as one string (schema: string | null);
  // whitespace tokenization is enough for anchored prefix matching.
  if (typeof command === "string" && command.trim() !== "") {
    return command.trim().split(/\s+/);
  }
  return undefined;
}

/** Anchored argv-prefix match (not regex — simpler to audit, per the plan). */
function matchPrefix(patterns: string[][] | undefined, argv: string[]): string[] | undefined {
  return patterns?.find(
    (pattern) =>
      pattern.length > 0 &&
      pattern.length <= argv.length &&
      pattern.every((part, index) => argv[index] === part),
  );
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
