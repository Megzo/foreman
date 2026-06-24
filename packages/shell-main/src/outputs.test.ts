import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { copyOutputs } from "./outputs.js";

function makeWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "foreman-ws-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

describe("copyOutputs (FR-6.3): present finished files in Documents", () => {
  test("matching files are copied (not moved) into Documents/<AppName>/<job>/", async () => {
    const workspaceDir = makeWorkspace({
      "alice.epub": "EPUB",
      "alice.docx": "DOCX",
      "scratch.md": "ignore me",
    });
    const documentsDir = mkdtempSync(join(tmpdir(), "foreman-docs-"));

    const result = await copyOutputs({
      workspaceDir,
      outputs: ["*.epub", "*.docx"],
      documentsDir,
      appName: "Könyvfordító",
      jobName: "alice",
    });

    expect(result.outputDir).toBe(join(documentsDir, "Könyvfordító", "alice"));
    expect(result.files.sort()).toEqual(["alice.docx", "alice.epub"]);
    // Copied, not moved: the workspace originals survive.
    expect(existsSync(join(workspaceDir, "alice.epub"))).toBe(true);
    expect(readFileSync(join(result.outputDir, "alice.epub"), "utf8")).toBe("EPUB");
    // Non-matching files stay behind.
    expect(existsSync(join(result.outputDir, "scratch.md"))).toBe(false);
  });

  test("a job-name collision lands in a suffixed folder rather than overwriting", async () => {
    const workspaceDir = makeWorkspace({ "out.epub": "v2" });
    const documentsDir = mkdtempSync(join(tmpdir(), "foreman-docs-"));
    // Pretend a previous run already produced this job folder.
    mkdirSync(join(documentsDir, "App", "alice"), { recursive: true });
    writeFileSync(join(documentsDir, "App", "alice", "out.epub"), "v1");

    const result = await copyOutputs({
      workspaceDir,
      outputs: ["*.epub"],
      documentsDir,
      appName: "App",
      jobName: "alice",
    });

    expect(result.outputDir).toBe(join(documentsDir, "App", "alice-2"));
    expect(readFileSync(join(result.outputDir, "out.epub"), "utf8")).toBe("v2");
    // The earlier run's output is untouched.
    expect(readFileSync(join(documentsDir, "App", "alice", "out.epub"), "utf8")).toBe("v1");
  });

  test("recursive globs reach nested outputs and preserve their relative path", async () => {
    const workspaceDir = makeWorkspace({ "build/final/book.pdf": "PDF" });
    const documentsDir = mkdtempSync(join(tmpdir(), "foreman-docs-"));

    const result = await copyOutputs({
      workspaceDir,
      outputs: ["**/*.pdf"],
      documentsDir,
      appName: "App",
      jobName: "job",
    });

    expect(result.files).toEqual(["build/final/book.pdf"]);
    expect(readFileSync(join(result.outputDir, "build", "final", "book.pdf"), "utf8")).toBe("PDF");
  });
});
