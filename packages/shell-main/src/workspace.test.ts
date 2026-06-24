import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { AppManifest } from "./manifest-types.js";
import { WorkspaceProvisioner } from "./workspace.js";

/** A tiny on-disk app bundle: manifest dir with a skill/ directory beside it. */
function makeBundle(): { appDir: string; manifest: AppManifest } {
  const appDir = mkdtempSync(join(tmpdir(), "foreman-bundle-"));
  mkdirSync(join(appDir, "skill"));
  writeFileSync(join(appDir, "skill", "SKILL.md"), "# echo skill\nwrite params to result.txt\n");
  writeFileSync(join(appDir, "skill", "helper.py"), "print('helper')\n");
  const manifest: AppManifest = {
    schemaVersion: 1,
    id: "echo-demo",
    name: "Echo Demo",
    version: "0.1.0",
    branding: { productName: "Echo Demo", colors: { primary: "#1f6feb" } },
    tasks: [
      {
        id: "echo",
        label: { hu: "Visszhang" },
        skill: { name: "echo", path: "skill/SKILL.md" },
      },
    ],
  };
  return { appDir, manifest };
}

function makeDirs(): { dataDir: string; codexHome: string } {
  const dataDir = mkdtempSync(join(tmpdir(), "foreman-data-"));
  return { dataDir, codexHome: join(dataDir, "codex-home") };
}

describe("WorkspaceProvisioner (FR-6.1, FR-6.2 minimal)", () => {
  test("a fresh provision creates the workspace and copies skill files into the CODEX_HOME skills dir", async () => {
    const { appDir, manifest } = makeBundle();
    const { dataDir, codexHome } = makeDirs();

    const provisioned = await new WorkspaceProvisioner().provision({
      manifest,
      appDir,
      dataDir,
      codexHome,
    });

    expect(existsSync(provisioned.workspaceDir)).toBe(true);
    const skillPath = provisioned.skillPaths["echo"];
    expect(skillPath).toBe(join(codexHome, "skills", "echo", "SKILL.md"));
    expect(readFileSync(skillPath!, "utf8")).toContain("# echo skill");
    // The whole skill directory travels, not just SKILL.md.
    expect(existsSync(join(codexHome, "skills", "echo", "helper.py"))).toBe(true);
  });

  test("a bundle-version bump re-provisions managed skill files but leaves user files intact (FR-6.2)", async () => {
    const { appDir, manifest } = makeBundle();
    const { dataDir, codexHome } = makeDirs();
    const provisioner = new WorkspaceProvisioner();

    const first = await provisioner.provision({ manifest, appDir, dataDir, codexHome });
    // The user drops a file into the hidden workspace during the first run...
    const userFile = join(first.workspaceDir, "my-book.epub");
    writeFileSync(userFile, "user data\n");
    // ...and a managed skill file drifts (e.g. a half-applied edit).
    writeFileSync(first.skillPaths["echo"]!, "stale\n");

    // The app bundle ships a new version with an updated skill.
    writeFileSync(join(appDir, "skill", "SKILL.md"), "# echo skill v2\n");
    const bumped: AppManifest = { ...manifest, version: "0.2.0" };
    const second = await provisioner.provision({ manifest: bumped, appDir, dataDir, codexHome });

    // Managed files are refreshed from the new bundle...
    expect(readFileSync(second.skillPaths["echo"]!, "utf8")).toContain("# echo skill v2");
    // ...but user-generated workspace files are never deleted.
    expect(readFileSync(userFile, "utf8")).toBe("user data\n");
  });

  test("a second provision of the same bundle version is a no-op (FR-6.2 minimal)", async () => {
    const { appDir, manifest } = makeBundle();
    const { dataDir, codexHome } = makeDirs();
    const provisioner = new WorkspaceProvisioner();

    const first = await provisioner.provision({ manifest, appDir, dataDir, codexHome });
    // Simulate post-provision drift; an idempotent re-run must not re-copy over it.
    writeFileSync(first.skillPaths["echo"]!, "locally modified\n");

    const second = await provisioner.provision({ manifest, appDir, dataDir, codexHome });

    expect(second.skillPaths).toEqual(first.skillPaths);
    expect(readFileSync(first.skillPaths["echo"]!, "utf8")).toBe("locally modified\n");
  });
});
