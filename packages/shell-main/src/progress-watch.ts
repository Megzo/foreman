import { type FSWatcher, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

/**
 * A human-meaningful progress update derived from the skill's `progress.json`
 * (PRD Open Q2). `current`/`total` drive the "chunk N of M" bar; `phase` and
 * `label` are optional context. The skill writes this file as a backward-
 * compatible addition; agent-message heuristics alone are too fragile.
 */
export interface ProgressUpdate {
  current: number;
  total: number;
  phase?: string;
  label?: string;
}

/**
 * Parse one `progress.json` body. Returns undefined for anything malformed —
 * unparseable JSON, missing/non-numeric counters, a non-positive total — so the
 * watcher stays fail-soft and a half-written file is simply skipped.
 */
export function parseProgress(raw: string): ProgressUpdate | undefined {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const obj = data as Record<string, unknown>;
  const { current, total } = obj;
  if (typeof current !== "number" || typeof total !== "number") return undefined;
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return undefined;
  const update: ProgressUpdate = { current, total };
  if (typeof obj.phase === "string") update.phase = obj.phase;
  if (typeof obj.label === "string") update.label = obj.label;
  return update;
}

/**
 * Watches the workspace for `progress.json` and surfaces ordered progress
 * updates to the running view. Watches the *directory* (not the file): the file
 * may not exist when the run starts, and atomic rename-writes would break a
 * direct file watch. Repeated identical updates are deduped so a touch without a
 * content change is silent.
 */
export class ProgressWatcher {
  private watcher: FSWatcher | undefined;
  private last: string | undefined;

  constructor(
    private readonly filePath: string,
    private readonly onProgress: (update: ProgressUpdate) => void,
  ) {}

  start(): void {
    // The file may already exist (resume); read it once before watching.
    void this.refresh();
    try {
      this.watcher = watch(dirname(this.filePath), (_event, filename) => {
        if (filename === null || filename === basename(this.filePath)) void this.refresh();
      });
    } catch {
      // The workspace dir may not exist yet (or be unwatchable) — fail-soft;
      // progress is a nicety, never a reason to break a run.
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  private async refresh(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return; // file not present yet, or a transient read race — fail-soft.
    }
    const update = parseProgress(raw);
    if (!update) return;
    const key = JSON.stringify(update);
    if (key === this.last) return;
    this.last = key;
    this.onProgress(update);
  }
}
