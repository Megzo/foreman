/**
 * Locate a spawnable codex binary (Phase 2 Windows finding).
 *
 * `npm install -g @openai/codex` puts a `codex.cmd` shim on PATH; PowerShell
 * resolves it but Node's spawn() only auto-resolves `.exe`, so `spawn("codex")`
 * fails with ENOENT on win32. The real binary ships inside the npm package
 * (vendored per platform). Pure function with injected fs/env so the win32
 * behavior is testable everywhere.
 */

export interface ResolveCodexBinOptions {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  fileExists: (path: string) => boolean;
}

export function resolveCodexBin(options: ResolveCodexBinOptions): string {
  const explicit = options.env.CODEX_BIN;
  if (explicit) return explicit;
  if (options.platform !== "win32") return "codex";

  // process.env is case-insensitive on Windows, plain test objects are not.
  const pathValue = options.env.Path ?? options.env.PATH ?? "";
  const dirs = pathValue.split(";").filter(Boolean);

  for (const dir of dirs) {
    const exe = `${dir}\\codex.exe`;
    if (options.fileExists(exe)) return exe;
  }

  // npm global install: codex.cmd shim beside node_modules, real binary
  // vendored in the platform package (layout verified against 0.138.0).
  for (const dir of dirs) {
    if (!options.fileExists(`${dir}\\codex.cmd`)) continue;
    for (const [pkg, triple] of [
      ["codex-win32-x64", "x86_64-pc-windows-msvc"],
      ["codex-win32-arm64", "aarch64-pc-windows-msvc"],
    ]) {
      const vendored = `${dir}\\node_modules\\@openai\\codex\\node_modules\\@openai\\${pkg}\\vendor\\${triple}\\bin\\codex.exe`;
      if (options.fileExists(vendored)) return vendored;
    }
  }
  return "codex";
}
