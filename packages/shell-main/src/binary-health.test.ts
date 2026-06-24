import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, test } from "vitest";
import { checkBinaries } from "./binary-health.js";

describe("checkBinaries (Integration: bundled-binary health check)", () => {
  test("when every required binary resolves, the result is ok with no message", async () => {
    const result = await checkBinaries(["python3", "pandoc", "ebook-convert"], {
      lookup: () => true,
    });
    expect(result).toEqual({ ok: true, missing: [] });
  });

  test("an empty requirement list is trivially ok", async () => {
    expect(await checkBinaries([], { lookup: () => false })).toEqual({ ok: true, missing: [] });
  });

  test("a missing binary fails with a friendly message naming it and the reinstall remedy", async () => {
    const result = await checkBinaries(["python3", "ebook-convert"], {
      lookup: (name) => name === "python3",
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["ebook-convert"]);
    expect(result.message).toContain("ebook-convert");
    // End-user-facing repair guidance (PRD Integration: "reinstall the app").
    expect(result.message?.toLowerCase()).toMatch(/telepít|reinstall/);
  });

  test("the default lookup resolves a binary present on PATH and rejects an absent one", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "foreman-bin-"));
    const exe = join(binDir, "foreman-fake-tool");
    writeFileSync(exe, "#!/bin/sh\n");
    chmodSync(exe, 0o755);
    const env = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` };

    expect((await checkBinaries(["foreman-fake-tool"], { env })).ok).toBe(true);
    expect((await checkBinaries(["definitely-not-on-path-xyz"], { env })).ok).toBe(false);
  });
});
