import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ManifestUpdates } from "./manifest-types.js";

/**
 * Channel selection (FR-12, PRD Permissions: provisioner-controlled). The
 * manifest ships the default channel's feed URLs; a provisioner can pin a
 * machine to a named channel (e.g. "beta") by dropping an `update-channel.json`
 * in app data — so an untested update never lands on a production machine. The
 * config is the only place this choice lives; there is no in-app UI for it (v1).
 */

export interface ResolvedFeeds {
  channel: string;
  bundleFeedUrl?: string;
  shellFeedUrl?: string;
  publicKey?: string;
}

const CHANNEL_FILE = "update-channel.json";

/** Reads the provisioner's channel choice; fail-soft (missing/corrupt → none). */
export function readUpdateChannel(dataDir: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, CHANNEL_FILE), "utf8")) as {
      channel?: unknown;
    };
    return typeof parsed.channel === "string" && parsed.channel.length > 0
      ? parsed.channel
      : undefined;
  } catch {
    return undefined;
  }
}

/** Resolves the active feed URLs for a channel, falling back to the defaults. */
export function resolveFeeds(
  updates: ManifestUpdates | undefined,
  channelName: string | undefined,
): ResolvedFeeds {
  const override = channelName ? updates?.channels?.[channelName] : undefined;
  return {
    channel: channelName ?? "stable",
    bundleFeedUrl: override?.bundleFeedUrl ?? updates?.bundleFeedUrl,
    shellFeedUrl: override?.shellFeedUrl ?? updates?.shellFeedUrl,
    // The verification key is global to the app, never per-channel (FR-8.4).
    publicKey: updates?.publicKey,
  };
}
