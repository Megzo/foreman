import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { packBundle, unpackBundle } from "./bundle.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "foreman-bundle-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeFile(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

describe("bundle pack/unpack (PRD State: app bundle = manifest + skills)", () => {
  test("packs an app dir and unpacks it byte-for-byte, including nested skill files", async () => {
    const appDir = join(root, "app");
    writeFile("app/manifest.json", '{"id":"echo"}');
    writeFile("app/skill/SKILL.md", "# do the thing");
    writeFile("app/skill/scripts/run.py", "print('hi')");

    const archive = await packBundle(appDir);

    const dest = join(root, "out");
    await unpackBundle(archive, dest);

    expect(readFileSync(join(dest, "manifest.json"), "utf8")).toBe('{"id":"echo"}');
    expect(readFileSync(join(dest, "skill/SKILL.md"), "utf8")).toBe("# do the thing");
    expect(readFileSync(join(dest, "skill/scripts/run.py"), "utf8")).toBe("print('hi')");
  });

  test("packing the same tree twice is byte-identical (deterministic, signable)", async () => {
    const appDir = join(root, "app");
    writeFile("app/manifest.json", '{"id":"echo"}');
    writeFile("app/b.txt", "b");
    writeFile("app/a.txt", "a");

    const first = await packBundle(appDir);
    const second = await packBundle(appDir);

    expect(first.equals(second)).toBe(true);
  });
});
