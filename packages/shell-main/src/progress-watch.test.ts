import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ProgressWatcher, parseProgress, type ProgressUpdate } from "./progress-watch.js";

describe("parseProgress — the progress.json convention (PRD Open Q2)", () => {
  test("a well-formed progress object yields current/total plus optional phase and label", () => {
    expect(
      parseProgress('{"current": 47, "total": 120, "phase": "translating", "label": "3. fejezet"}'),
    ).toEqual({ current: 47, total: 120, phase: "translating", label: "3. fejezet" });
  });

  test("current/total alone is enough; missing optional fields are simply absent", () => {
    expect(parseProgress('{"current": 1, "total": 10}')).toEqual({ current: 1, total: 10 });
  });

  test("malformed JSON or missing numeric fields are ignored (fail-soft, returns undefined)", () => {
    expect(parseProgress("not json {")).toBeUndefined();
    expect(parseProgress('{"current": 1}')).toBeUndefined();
    expect(parseProgress('{"current": "x", "total": 10}')).toBeUndefined();
    expect(parseProgress('{"current": 1, "total": 0}')).toBeUndefined();
    expect(parseProgress("[]")).toBeUndefined();
  });
});

describe("ProgressWatcher — workspace progress.json (Phase 8)", () => {
  let watcher: ProgressWatcher | undefined;
  afterEach(() => watcher?.stop());

  /** Wait until at least `count` updates have arrived, or fail after a timeout. */
  async function waitFor(updates: ProgressUpdate[], count: number): Promise<void> {
    const deadline = Date.now() + 4000;
    while (updates.length < count) {
      if (Date.now() > deadline) throw new Error(`only saw ${updates.length}/${count} updates`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  test("sequential progress.json writes surface as ordered progress updates; malformed writes are skipped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "foreman-progress-"));
    const file = join(dir, "progress.json");
    const updates: ProgressUpdate[] = [];

    watcher = new ProgressWatcher(file, (u) => updates.push(u));
    watcher.start();

    writeFileSync(file, '{"current": 1, "total": 3}');
    await waitFor(updates, 1);
    // A malformed write between valid ones must not crash the watcher or emit.
    writeFileSync(file, "{ broken");
    writeFileSync(file, '{"current": 2, "total": 3}');
    await waitFor(updates, 2);
    writeFileSync(file, '{"current": 3, "total": 3}');
    await waitFor(updates, 3);

    expect(updates).toEqual([
      { current: 1, total: 3 },
      { current: 2, total: 3 },
      { current: 3, total: 3 },
    ]);
  });
});
