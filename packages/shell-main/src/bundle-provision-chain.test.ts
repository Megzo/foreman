import { createServer, type Server } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { generateKeyPair, publishBundle } from "@foreman/app-bundle-tools";
import { BundleUpdater } from "./bundle-updater.js";
import { ManifestLoader } from "./manifest.js";
import { WorkspaceProvisioner } from "./workspace.js";

// The Phase-10 → Phase-8 chain: an applied app bundle carries a bumped version,
// and the provisioner keys its managed-file refresh off that version. Verified
// end to end: download+verify+apply a v2 bundle, then re-provision from it.
let root: string;
let server: Server;
const keys = generateKeyPair();

function serve(feedDir: string): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      const file = join(feedDir, (req.url ?? "/").slice(1));
      if (!existsSync(file)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`);
    });
  });
}

async function makeApp(version: string, skillBody: string): Promise<string> {
  const appDir = join(root, `app-${version}`);
  await mkdir(join(appDir, "skill"), { recursive: true });
  await writeFile(
    join(appDir, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "echo",
      name: "Echo",
      version,
      branding: { productName: "Echo", colors: { primary: "#1f6feb" } },
      tasks: [{ id: "echo", label: { hu: "Visszhang" }, skill: { name: "echo", path: "skill/SKILL.md" } }],
    }),
  );
  await writeFile(join(appDir, "skill", "SKILL.md"), skillBody);
  return appDir;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "foreman-chain-"));
});
afterEach(() => {
  server?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("applied-bundle → re-provision chain (Phase 10 + FR-6.2)", () => {
  test("applying a bumped bundle re-provisions managed skill files while user files survive", async () => {
    const dataDir = join(root, "data");
    const codexHome = join(dataDir, "codex");
    const provisioner = new WorkspaceProvisioner();

    // v1 is the installed bundle: provision it, then the user creates a file.
    const v1App = await makeApp("1.0.0", "# skill v1");
    const v1Manifest = await new ManifestLoader().load(join(v1App, "manifest.json"));
    const ws = await provisioner.provision({ manifest: v1Manifest, appDir: v1App, dataDir, codexHome });
    const userFile = join(ws.workspaceDir, "my-translation.txt");
    await writeFile(userFile, "user work in progress");
    expect(await readFile(join(codexHome, "skills", "echo", "SKILL.md"), "utf8")).toBe("# skill v1");

    // Publish v2 and apply it through the updater (download + verify + stage).
    const v2App = await makeApp("2.0.0", "# skill v2");
    const feedDir = join(root, "feed");
    await publishBundle({ appDir: v2App, outDir: feedDir, privateKey: keys.privateKey });
    const baseUrl = await serve(feedDir);
    const updater = new BundleUpdater({
      feedUrl: `${baseUrl}/feed.json`,
      publicKey: keys.publicKey,
      currentVersion: "1.0.0",
      dataDir,
    });
    await updater.check();
    const applied = await updater.applyPending();
    expect(applied.applied).toBe(true);

    // The active bundle on disk is now v2; re-provision from it.
    const activeManifest = await new ManifestLoader().load(
      join(updater.activeBundleDir(), "manifest.json"),
    );
    expect(activeManifest.version).toBe("2.0.0");
    await provisioner.provision({
      manifest: activeManifest,
      appDir: updater.activeBundleDir(),
      dataDir,
      codexHome,
    });

    // Managed skill file refreshed to v2; the user's workspace file untouched.
    expect(await readFile(join(codexHome, "skills", "echo", "SKILL.md"), "utf8")).toBe("# skill v2");
    expect(await readFile(userFile, "utf8")).toBe("user work in progress");
  });
});
