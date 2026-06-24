import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { AppManifest } from "./manifest-types.js";

export interface ProvisionOptions {
  manifest: AppManifest;
  /** Directory containing manifest.json; task skill paths resolve against it. */
  appDir: string;
  /** The app's user-data dir; the hidden workspace and provisioning state live here (FR-6.1/6.4). */
  dataDir: string;
  /** The app-scoped CODEX_HOME; skills are provisioned to <codexHome>/skills/<name>/ (Open Q3). */
  codexHome: string;
}

export interface ProvisionedWorkspace {
  /** The hidden per-app workspace — thread/start cwd for every task. */
  workspaceDir: string;
  /** Skill name -> absolute provisioned SKILL.md path, ready for turn/start `{type:"skill"}`. */
  skillPaths: Record<string, string>;
}

interface ProvisionState {
  schemaVersion: 1;
  bundleVersion: string;
}

const STATE_FILE = "provision-state.json";

/**
 * Provisions the single hidden per-app workspace and copies manifest-declared
 * skill directories into the CODEX_HOME skills dir where codex discovers them.
 * Idempotent per bundle version (FR-6.2): a re-run with an unchanged version
 * copies nothing, so files in place are never clobbered mid-life; a version
 * bump re-copies the managed skill dirs (refreshing them) while user-generated
 * files in the hidden workspace — a separate tree — are never touched.
 */
export class WorkspaceProvisioner {
  async provision(options: ProvisionOptions): Promise<ProvisionedWorkspace> {
    const { manifest, appDir, dataDir, codexHome } = options;
    const workspaceDir = join(dataDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });

    const skillPaths: Record<string, string> = {};
    const fresh = !(await this.isProvisioned(dataDir, manifest.version));
    for (const task of manifest.tasks) {
      const sourceFile = resolve(appDir, task.skill.path);
      const targetDir = join(codexHome, "skills", task.skill.name);
      if (fresh) {
        await cp(dirname(sourceFile), targetDir, { recursive: true });
      }
      skillPaths[task.skill.name] = join(targetDir, basename(sourceFile));
    }

    if (fresh) {
      const state: ProvisionState = { schemaVersion: 1, bundleVersion: manifest.version };
      await writeFile(join(dataDir, STATE_FILE), JSON.stringify(state, null, 2));
    }
    return { workspaceDir, skillPaths };
  }

  private async isProvisioned(dataDir: string, bundleVersion: string): Promise<boolean> {
    try {
      const raw = await readFile(join(dataDir, STATE_FILE), "utf8");
      const state = JSON.parse(raw) as ProvisionState;
      return state.schemaVersion === 1 && state.bundleVersion === bundleVersion;
    } catch {
      return false;
    }
  }
}
