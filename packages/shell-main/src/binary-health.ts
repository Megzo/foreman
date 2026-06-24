import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

export interface BinaryHealthResult {
  ok: boolean;
  /** Required binaries that could not be resolved on PATH. */
  missing: string[];
  /** Friendly, end-user-facing repair message; present only when not ok. */
  message?: string;
}

export interface CheckBinariesOptions {
  /** Test seam: resolve a binary name -> found? Defaults to a PATH search. */
  lookup?: (name: string) => boolean | Promise<boolean>;
  /** Environment for the default PATH lookup (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
}

/**
 * Verifies the manifest's declared binaries are on PATH (PRD Integration). The
 * shell only checks presence — the agent invokes them inside the sandbox. A
 * miss yields a friendly, localized repair message (reinstall the app), never a
 * raw "command not found".
 */
export async function checkBinaries(
  binaries: string[],
  options: CheckBinariesOptions = {},
): Promise<BinaryHealthResult> {
  const lookup = options.lookup ?? ((name: string) => onPath(name, options.env ?? process.env));
  const missing: string[] = [];
  for (const name of binaries) {
    if (!(await lookup(name))) missing.push(name);
  }
  if (missing.length === 0) return { ok: true, missing: [] };
  return {
    ok: false,
    missing,
    message:
      `Hiányzó program: ${missing.join(", ")}. ` +
      `Telepítsd újra az alkalmazást a hiba elhárításához. ` +
      `(Missing required tools — please reinstall the app.)`,
  };
}

/** True if `name` (or a PATHEXT variant on win32) is an executable on PATH. */
async function onPath(name: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      try {
        await access(join(dir, name + ext), constants.X_OK);
        return true;
      } catch {
        // try the next dir/ext
      }
    }
  }
  return false;
}
