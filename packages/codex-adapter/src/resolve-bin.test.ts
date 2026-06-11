import { describe, expect, test } from "vitest";
import { resolveCodexBin } from "./resolve-bin.js";

const none = () => false;

describe("resolveCodexBin (Phase 2 finding: win32 npm shim is not spawnable)", () => {
  test("explicit CODEX_BIN wins on any platform", () => {
    expect(
      resolveCodexBin({
        platform: "win32",
        env: { CODEX_BIN: "D:\\tools\\codex.exe", Path: "C:\\somewhere" },
        fileExists: none,
      }),
    ).toBe("D:\\tools\\codex.exe");
  });

  test("win32: codex.exe found on PATH resolves to its absolute path", () => {
    expect(
      resolveCodexBin({
        platform: "win32",
        env: { Path: "C:\\Windows\\system32;C:\\tools\\codex" },
        fileExists: (p) => p === "C:\\tools\\codex\\codex.exe",
      }),
    ).toBe("C:\\tools\\codex\\codex.exe");
  });

  test("win32: npm codex.cmd shim resolves to the vendored codex.exe (layout verified on Windows 2026-06-12)", () => {
    const npmDir = "C:\\Users\\Admin\\AppData\\Roaming\\npm";
    const vendored = `${npmDir}\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`;
    expect(
      resolveCodexBin({
        platform: "win32",
        env: { Path: `C:\\Windows\\system32;${npmDir}` },
        fileExists: (p) => p === `${npmDir}\\codex.cmd` || p === vendored,
      }),
    ).toBe(vendored);
  });

  test("win32: nothing found falls back to the bare command (spawn fails with a clear error)", () => {
    expect(
      resolveCodexBin({ platform: "win32", env: { Path: "C:\\Windows" }, fileExists: none }),
    ).toBe("codex");
  });

  test("non-Windows platforms keep the bare command for PATH lookup", () => {
    expect(
      resolveCodexBin({ platform: "linux", env: { PATH: "/usr/bin" }, fileExists: none }),
    ).toBe("codex");
  });
});
