import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { publishBundle, type FeedDescriptor } from "./publish.js";
import { generateKeyPair } from "./signing.js";
import { verifyBundle } from "./signing.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "foreman-publish-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function makeApp(version: string): string {
  const appDir = join(root, "app");
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, "manifest.json"), JSON.stringify({ id: "echo", version }));
  return appDir;
}

describe("publishBundle (app-author CLI core, FR-8.3/8.4)", () => {
  test("writes an artifact and a feed.json whose descriptor points at it and verifies", async () => {
    const appDir = makeApp("1.2.0");
    const { privateKey, publicKey } = generateKeyPair();
    const outDir = join(root, "feed");

    const { descriptor } = await publishBundle({ appDir, outDir, privateKey });

    // The feed JSON is what the shell fetches first.
    const feed = JSON.parse(readFileSync(join(outDir, "feed.json"), "utf8")) as FeedDescriptor;
    expect(feed.version).toBe("1.2.0");
    expect(feed).toEqual(descriptor);

    // It must name an artifact that actually exists in the feed dir...
    const artifact = readFileSync(join(outDir, feed.artifact));
    expect(artifact.byteLength).toBe(feed.size);

    // ...and the recorded signature must verify against that artifact.
    expect(verifyBundle(artifact, feed.signature, publicKey)).toBe(true);
  });

  test("the published artifact is signed over its own bytes (tamper is caught)", async () => {
    const appDir = makeApp("1.0.0");
    const { privateKey, publicKey } = generateKeyPair();
    const outDir = join(root, "feed");
    const { descriptor } = await publishBundle({ appDir, outDir, privateKey });

    const artifactPath = join(outDir, descriptor.artifact);
    const bytes = readFileSync(artifactPath);
    bytes[0] = bytes[0]! ^ 0x01;
    writeFileSync(artifactPath, bytes);

    expect(verifyBundle(readFileSync(artifactPath), descriptor.signature, publicKey)).toBe(false);
  });
});
