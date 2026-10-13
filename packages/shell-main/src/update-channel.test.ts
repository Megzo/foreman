import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ManifestUpdates } from "./manifest-types.js";
import { readUpdateChannel, resolveFeeds } from "./update-channel.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "foreman-channel-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const UPDATES: ManifestUpdates = {
  bundleFeedUrl: "https://feed.example/stable/feed.json",
  shellFeedUrl: "https://feed.example/stable",
  publicKey: "PEM",
  channels: {
    beta: { bundleFeedUrl: "https://feed.example/beta/feed.json" },
  },
};

describe("update channel selection (FR-12, provisioner-controlled config file)", () => {
  test("with no config file, the default channel's feeds are used", () => {
    const feeds = resolveFeeds(UPDATES, readUpdateChannel(dir));
    expect(feeds.channel).toBe("stable");
    expect(feeds.bundleFeedUrl).toBe("https://feed.example/stable/feed.json");
    expect(feeds.publicKey).toBe("PEM");
  });

  test("a provisioner config naming a channel overrides the feed URLs", () => {
    writeFileSync(join(dir, "update-channel.json"), JSON.stringify({ channel: "beta" }));

    const feeds = resolveFeeds(UPDATES, readUpdateChannel(dir));
    expect(feeds.channel).toBe("beta");
    expect(feeds.bundleFeedUrl).toBe("https://feed.example/beta/feed.json");
    // The verification key is never per-channel (FR-8.4).
    expect(feeds.publicKey).toBe("PEM");
    // Unset channel fields fall back to the default.
    expect(feeds.shellFeedUrl).toBe("https://feed.example/stable");
  });

  test("a corrupt config file falls back to the default channel rather than throwing", () => {
    writeFileSync(join(dir, "update-channel.json"), "{ not json");
    expect(readUpdateChannel(dir)).toBeUndefined();
  });

  test("a manifest without an updates block resolves to empty feeds (updates disabled)", () => {
    const feeds = resolveFeeds(undefined, undefined);
    expect(feeds.bundleFeedUrl).toBeUndefined();
    expect(feeds.shellFeedUrl).toBeUndefined();
  });
});
