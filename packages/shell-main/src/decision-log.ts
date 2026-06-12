import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PolicyDecisionRecord } from "./policy.js";

/**
 * The policy decision trail (FR-5.4): one JSON line per decision, appended to
 * a local file. Synchronous on purpose — approvals are rare and the line must
 * be on disk before the response leaves, so the trail can never lag the wire.
 * A logging failure never blocks the decision (the policy answer matters more
 * than its audit line).
 */
export class DecisionLog {
  constructor(private readonly filePath: string) {}

  append(record: PolicyDecisionRecord): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(
        this.filePath,
        `${JSON.stringify({ time: new Date().toISOString(), ...record })}\n`,
      );
    } catch (error) {
      console.warn(`decision log write failed: ${(error as Error).message}`);
    }
  }
}
