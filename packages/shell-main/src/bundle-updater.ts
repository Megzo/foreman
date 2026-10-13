import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { unpackBundle, verifyBundle, type FeedDescriptor } from "@foreman/app-bundle-tools";

/**
 * The app-bundle update layer (FR-8.3/8.4/8.6). On startup (and every 6 h while
 * running) the shell fetches the channel feed; a newer, signature-verified
 * bundle is downloaded and **staged**, then applied on the next launch — never
 * mid-task (FR-8.2) and never without a valid signature (FR-8.4). Every failure
 * mode is non-fatal: a bad signature, a malformed feed, or an unreachable host
 * leaves the app on its current bundle and is logged, never thrown (FR-8.6).
 *
 * On-disk layout under <dataDir>:
 *   bundle/                 the active applied bundle (absent until first apply)
 *   updates/staging-<v>/    a verified, unpacked bundle awaiting apply
 *   updates/pending.json    { version, dir } pointer to the staged bundle
 */

export type UpdateEvent = "up-to-date" | "staged" | "rejected" | "error" | "applied" | "deferred";

export interface UpdateLogEntry {
  event: UpdateEvent;
  version?: string;
  message?: string;
}

export type CheckResult =
  | { status: "up-to-date" }
  | { status: "staged"; version: string }
  | { status: "rejected"; version: string }
  | { status: "pending"; version: string }
  | { status: "error"; message: string };

export type ApplyResult =
  | { applied: true; version: string }
  | { applied: false; reason: "none" | "task-running" };

export interface BundleUpdaterOptions {
  /** URL of the channel feed.json (FR-8.3). */
  feedUrl: string;
  /** Trusted Ed25519 public key, PEM (compiled in per app, FR-8.4). */
  publicKey: string;
  /** The active bundle version this shell is running. */
  currentVersion: string;
  /** App user-data dir; staging + active bundle live under here. */
  dataDir: string;
  log?: (entry: UpdateLogEntry) => void;
  /** Apply is deferred while a task runs (FR-8.2); defaults to "never busy". */
  isTaskRunning?: () => boolean;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface PendingMarker {
  version: string;
  dir: string;
}

/** Dotted-numeric version compare; returns >0 when `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i] ?? 0);
    const nb = Number(pb[i] ?? 0);
    if (Number.isNaN(na) || Number.isNaN(nb)) return a === b ? 0 : a > b ? 1 : -1;
    if (na !== nb) return na - nb;
  }
  return 0;
}

export class BundleUpdater {
  private readonly fetchImpl: typeof fetch;
  private readonly updatesDir: string;
  private readonly pendingFile: string;

  constructor(private readonly options: BundleUpdaterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.updatesDir = join(options.dataDir, "updates");
    this.pendingFile = join(this.updatesDir, "pending.json");
  }

  /** The active applied-bundle directory (may not exist until first apply). */
  activeBundleDir(): string {
    return join(this.options.dataDir, "bundle");
  }

  pendingVersion(): string | undefined {
    return this.readPending()?.version;
  }

  /** Fetch the feed, verify, and stage a newer bundle. Always non-fatal. */
  async check(): Promise<CheckResult> {
    try {
      const feedRes = await this.fetchImpl(this.options.feedUrl);
      if (!feedRes.ok) throw new Error(`feed responded ${feedRes.status}`);
      const descriptor = (await feedRes.json()) as FeedDescriptor;

      if (descriptor.schemaVersion !== 1) {
        return this.log({ status: "up-to-date" }, { event: "up-to-date" });
      }
      if (compareVersions(descriptor.version, this.options.currentVersion) <= 0) {
        return this.log({ status: "up-to-date" }, { event: "up-to-date" });
      }
      if (this.pendingVersion() === descriptor.version) {
        return { status: "pending", version: descriptor.version };
      }

      const artifactUrl = new URL(descriptor.artifact, this.options.feedUrl).toString();
      const artRes = await this.fetchImpl(artifactUrl);
      if (!artRes.ok) throw new Error(`artifact responded ${artRes.status}`);
      const archive = Buffer.from(await artRes.arrayBuffer());

      if (!verifyBundle(archive, descriptor.signature, this.options.publicKey)) {
        return this.log(
          { status: "rejected", version: descriptor.version },
          { event: "rejected", version: descriptor.version, message: "signature verification failed" },
        );
      }

      const stagingDir = join(this.updatesDir, `staging-${descriptor.version}`);
      rmSync(stagingDir, { recursive: true, force: true });
      await unpackBundle(archive, stagingDir);
      this.writePending({ version: descriptor.version, dir: stagingDir });
      return this.log(
        { status: "staged", version: descriptor.version },
        { event: "staged", version: descriptor.version },
      );
    } catch (error) {
      const message = (error as Error).message;
      return this.log({ status: "error", message }, { event: "error", message });
    }
  }

  /** Apply a staged bundle (called at launch). Blocked while a task runs. */
  async applyPending(): Promise<ApplyResult> {
    const pending = this.readPending();
    if (!pending) return { applied: false, reason: "none" };
    if (this.options.isTaskRunning?.()) {
      this.emit({ event: "deferred", version: pending.version, message: "task running" });
      return { applied: false, reason: "task-running" };
    }
    const active = this.activeBundleDir();
    rmSync(active, { recursive: true, force: true });
    mkdirSync(dirname(active), { recursive: true });
    renameSync(pending.dir, active);
    rmSync(this.pendingFile, { force: true });
    this.emit({ event: "applied", version: pending.version });
    return { applied: true, version: pending.version };
  }

  private readPending(): PendingMarker | undefined {
    try {
      return JSON.parse(readFileSync(this.pendingFile, "utf8")) as PendingMarker;
    } catch {
      return undefined;
    }
  }

  private writePending(marker: PendingMarker): void {
    mkdirSync(this.updatesDir, { recursive: true });
    writeFileSync(this.pendingFile, JSON.stringify(marker, null, 2));
  }

  private emit(entry: UpdateLogEntry): void {
    this.options.log?.(entry);
  }

  private log(result: CheckResult, entry: UpdateLogEntry): CheckResult {
    this.emit(entry);
    return result;
  }
}
