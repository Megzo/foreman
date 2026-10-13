import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { packBundle } from "./bundle.js";
import { signBundle } from "./signing.js";

/**
 * The feed descriptor the shell fetches first (FR-8.3): a tiny JSON pointer at
 * the signed artifact for a channel. `schemaVersion` is stamped from day one
 * (PRD State: migrations) so an unknown-newer feed can fail safe later.
 */
export interface FeedDescriptor {
  schemaVersion: 1;
  /** The app-bundle version (from the packed manifest); the shell compares this. */
  version: string;
  /** Artifact filename, resolved relative to the feed.json location. */
  artifact: string;
  /** Base64 Ed25519 detached signature over the artifact bytes (FR-8.4). */
  signature: string;
  /** Artifact size in bytes — a cheap integrity pre-check. */
  size: number;
  algorithm: "ed25519";
}

export interface PublishOptions {
  /** App directory containing manifest.json + skill files. */
  appDir: string;
  /** Feed output directory; feed.json + the artifact are written here. */
  outDir: string;
  /** PKCS8 PEM signing key. */
  privateKey: string;
}

export interface PublishResult {
  feedPath: string;
  artifactPath: string;
  descriptor: FeedDescriptor;
}

/**
 * Packs an app dir, signs it, and writes the artifact + feed.json (the CLI core,
 * FR-8.3/8.4). The artifact is signed over its own bytes so the shell can verify
 * exactly what it downloads.
 */
export async function publishBundle(options: PublishOptions): Promise<PublishResult> {
  const { appDir, outDir, privateKey } = options;
  const manifest = JSON.parse(await readFile(join(appDir, "manifest.json"), "utf8")) as {
    version?: string;
  };
  const version = manifest.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("manifest.json has no version — cannot publish a bundle");
  }

  const archive = await packBundle(appDir);
  const signature = signBundle(archive, privateKey);
  const artifact = `bundle-${version}.fbundle`;
  const descriptor: FeedDescriptor = {
    schemaVersion: 1,
    version,
    artifact,
    signature,
    size: archive.byteLength,
    algorithm: "ed25519",
  };

  await mkdir(outDir, { recursive: true });
  const artifactPath = join(outDir, artifact);
  const feedPath = join(outDir, "feed.json");
  await writeFile(artifactPath, archive);
  await writeFile(feedPath, JSON.stringify(descriptor, null, 2));

  return { feedPath, artifactPath, descriptor };
}
