import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadStream } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { generateKeyPair, publishBundle } from "@foreman/app-bundle-tools";
import { BundleUpdater, type UpdateLogEntry } from "./bundle-updater.js";

// A real local HTTP feed (plan: "local HTTP fixture") backed by a published
// feed directory — exercises the actual download + verify path end to end.
let root: string;
let server: Server;
let baseUrl: string;
const keys = generateKeyPair();

function startFeedServer(feedDir: string): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      const file = join(feedDir, decodeURIComponent((req.url ?? "/").slice(1)));
      if (!existsSync(file)) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

async function publishApp(version: string, label = "v"): Promise<string> {
  const appDir = join(root, `app-${version}`);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    join(appDir, "manifest.json"),
    JSON.stringify({ id: "echo", version, label }),
  );
  const feedDir = join(root, "feed");
  await publishBundle({ appDir, outDir: feedDir, privateKey: keys.privateKey });
  return feedDir;
}

function makeUpdater(opts: {
  currentVersion: string;
  log?: (e: UpdateLogEntry) => void;
  isTaskRunning?: () => boolean;
  publicKey?: string;
  feedUrl?: string;
}): BundleUpdater {
  return new BundleUpdater({
    feedUrl: opts.feedUrl ?? `${baseUrl}/feed.json`,
    publicKey: opts.publicKey ?? keys.publicKey,
    currentVersion: opts.currentVersion,
    dataDir: join(root, "data"),
    log: opts.log,
    isTaskRunning: opts.isTaskRunning,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "foreman-updater-"));
});
afterEach(() => {
  server?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("BundleUpdater (FR-8.3/8.4/8.6)", () => {
  test("a newer feed version downloads, verifies, and stages a pending bundle", async () => {
    const feedDir = await publishApp("2.0.0");
    baseUrl = await startFeedServer(feedDir);
    const updater = makeUpdater({ currentVersion: "1.0.0" });

    const result = await updater.check();

    expect(result.status).toBe("staged");
    expect(updater.pendingVersion()).toBe("2.0.0");
  });

  test("a staged bundle is applied on the next launch (apply-on-restart)", async () => {
    const feedDir = await publishApp("2.0.0", "fresh-label");
    baseUrl = await startFeedServer(feedDir);
    const updater = makeUpdater({ currentVersion: "1.0.0" });
    await updater.check();

    const applied = await updater.applyPending();

    expect(applied.applied).toBe(true);
    if (!applied.applied) throw new Error("expected the bundle to apply");
    expect(applied.version).toBe("2.0.0");
    // The applied bundle's manifest is now the active bundle on disk.
    const manifest = JSON.parse(
      readFileSync(join(root, "data", "bundle", "manifest.json"), "utf8"),
    ) as { label: string };
    expect(manifest.label).toBe("fresh-label");
    // Pending is cleared so it is not re-applied.
    expect(updater.pendingVersion()).toBeUndefined();
  });

  test("an up-to-date feed stages nothing", async () => {
    const feedDir = await publishApp("1.0.0");
    baseUrl = await startFeedServer(feedDir);
    const updater = makeUpdater({ currentVersion: "1.0.0" });

    expect((await updater.check()).status).toBe("up-to-date");
    expect(updater.pendingVersion()).toBeUndefined();
  });

  test("a tampered artifact is rejected, logged, and never staged (FR-8.4)", async () => {
    const feedDir = await publishApp("2.0.0");
    // Flip a byte in the published artifact so its signature no longer matches.
    const feed = JSON.parse(readFileSync(join(feedDir, "feed.json"), "utf8")) as {
      artifact: string;
    };
    const artifactPath = join(feedDir, feed.artifact);
    const bytes = readFileSync(artifactPath);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0x01;
    writeFileSync(artifactPath, bytes);
    baseUrl = await startFeedServer(feedDir);

    const log: UpdateLogEntry[] = [];
    const updater = makeUpdater({ currentVersion: "1.0.0", log: (e) => log.push(e) });

    const result = await updater.check();

    expect(result.status).toBe("rejected");
    expect(updater.pendingVersion()).toBeUndefined();
    expect(log.some((e) => e.event === "rejected")).toBe(true);
  });

  test("an unreachable feed is non-fatal: check returns an error result, never throws (FR-8.6)", async () => {
    const log: UpdateLogEntry[] = [];
    const updater = makeUpdater({
      currentVersion: "1.0.0",
      feedUrl: "http://127.0.0.1:1/feed.json",
      log: (e) => log.push(e),
    });

    const result = await updater.check();

    expect(result.status).toBe("error");
    expect(log.some((e) => e.event === "error")).toBe(true);
  });

  test("a running task blocks apply until the next launch (FR-8.2)", async () => {
    const feedDir = await publishApp("2.0.0");
    baseUrl = await startFeedServer(feedDir);
    const updater = makeUpdater({ currentVersion: "1.0.0", isTaskRunning: () => true });
    await updater.check();

    const applied = await updater.applyPending();

    expect(applied.applied).toBe(false);
    if (applied.applied) throw new Error("expected apply to be deferred");
    expect(applied.reason).toBe("task-running");
    // Still pending — a later launch (no task running) will apply it.
    expect(updater.pendingVersion()).toBe("2.0.0");
  });
});
