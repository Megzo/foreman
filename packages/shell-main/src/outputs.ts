import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, posix, sep } from "node:path";

export interface CopyOutputsOptions {
  /** Source root; output globs resolve against it. */
  workspaceDir: string;
  /** Completion globs from the manifest (relative, posix style). */
  outputs: string[];
  /** The OS Documents directory (app.getPath("documents")). */
  documentsDir: string;
  /** Branding product name — the per-app folder under Documents. */
  appName: string;
  /** The run's job name — the per-run folder under the app folder. */
  jobName: string;
}

export interface CopyOutputsResult {
  /** The folder the success state links to with "Open folder" (FR-6.3). */
  outputDir: string;
  /** Copied files as posix paths relative to outputDir, for the success summary. */
  files: string[];
}

/**
 * Copies (never moves — FR-6.3) the workspace files matching the completion
 * globs into `Documents/<AppName>/<job>/`, preserving their relative layout. A
 * pre-existing job folder is never overwritten: the copy lands in a suffixed
 * sibling (`<job>-2`, `<job>-3`, …) so a re-run can't clobber an earlier result.
 */
export async function copyOutputs(options: CopyOutputsOptions): Promise<CopyOutputsResult> {
  const { workspaceDir, outputs, documentsDir, appName, jobName } = options;
  const matchers = outputs.map(globToRegExp);
  const candidates = await walk(workspaceDir);
  const matched = candidates.filter((rel) => matchers.some((re) => re.test(rel))).sort();

  const outputDir = pickFreeDir(join(documentsDir, appName), jobName);
  for (const rel of matched) {
    const dest = join(outputDir, ...rel.split(posix.sep));
    await mkdir(join(dest, ".."), { recursive: true });
    await cp(join(workspaceDir, ...rel.split(posix.sep)), dest);
  }
  return { outputDir, files: matched };
}

/** All files under `root`, as posix paths relative to it. */
async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}${posix.sep}${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await recurse(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }
  await recurse(root, "");
  return out;
}

/** First non-existing `<base>/<name>`, `<base>/<name>-2`, `<base>/<name>-3`, … */
function pickFreeDir(base: string, name: string): string {
  let candidate = join(base, name);
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = join(base, `${name}-${suffix}`);
    suffix++;
  }
  return candidate;
}

/**
 * Compile a glob to an anchored RegExp over posix-relative paths. Supports `*`
 * (within a path segment), `**` / `**​/` (across segments), and `?`. Simple by
 * design — the manifest authors the patterns, so power-glob features are out.
 */
function globToRegExp(glob: string): RegExp {
  const normalized = glob.split(sep).join(posix.sep);
  let re = "";
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i]!;
    if (c === "*") {
      if (normalized[i + 1] === "*") {
        i++;
        if (normalized[i + 1] === "/") {
          i++;
          re += "(?:.*/)?"; // **/ matches zero or more leading directories
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}
