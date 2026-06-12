import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { codexHomePath } from "./codex-home.js";

describe("codexHomePath (FR-3.5)", () => {
  test("lives under the app's user-data directory", () => {
    const userData = join("/tmp", "foreman-appdata", "Echo Demo");

    const home = codexHomePath(userData);

    const rel = relative(resolve(userData), resolve(home));
    expect(rel).not.toMatch(/^\.\./);
    expect(rel.length).toBeGreaterThan(0);
  });

  test("is never the developer's own ~/.codex", () => {
    // Even if Electron's userData were misconfigured to the home directory,
    // the codex home must not collide with the user's real ~/.codex.
    const home = codexHomePath(homedir());

    expect(resolve(home)).not.toBe(resolve(homedir(), ".codex"));
  });
});
