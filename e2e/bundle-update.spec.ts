import { createServer, type Server } from "node:http";
import { createReadStream, cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { generateKeyPair, publishBundle } from "@foreman/app-bundle-tools";

/**
 * Phase 10 acceptance (FR-8.3): launch the shell pointed at a bundle feed that
 * serves a NEWER echo-demo (changed launcher label). The first launch downloads,
 * verifies and stages it; the relaunch applies it on startup, so the new label
 * is live without a reinstall.
 */

const MAIN_ENTRY = resolve(import.meta.dirname, "../packages/shell-main/out/main/main.js");
const ECHO_DEMO = resolve(import.meta.dirname, "../apps/echo-demo");

let app: ElectronApplication;
let window: Page;
let server: Server;
const keys = generateKeyPair();

function serve(feedDir: string): Promise<string> {
  return new Promise((res) => {
    server = createServer((req, response) => {
      const file = join(feedDir, (req.url ?? "/").slice(1));
      if (!existsSync(file)) {
        response.statusCode = 404;
        response.end();
        return;
      }
      createReadStream(file).pipe(response);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      res(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`);
    });
  });
}

/** Publishes a v2 echo-demo (bumped version + changed label) to a feed dir. */
async function publishV2(workdir: string): Promise<string> {
  const appDir = join(workdir, "echo-demo-v2");
  cpSync(ECHO_DEMO, appDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(appDir, "manifest.json"), "utf8")) as {
    version: string;
    tasks: { label: { hu: string; en?: string } }[];
  };
  manifest.version = "0.2.0";
  manifest.tasks[0]!.label = { hu: "Frissített visszhang", en: "Updated echo" };
  writeFileSync(join(appDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const feedDir = join(workdir, "feed");
  await publishBundle({ appDir, outDir: feedDir, privateKey: keys.privateKey });
  return feedDir;
}

async function launch(feedUrl: string, userData: string): Promise<void> {
  app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      FOREMAN_MOCK_PEER: "1",
      FOREMAN_USER_DATA: userData,
      FOREMAN_BUNDLE_FEED_URL: feedUrl,
      FOREMAN_BUNDLE_PUBLIC_KEY: keys.publicKey,
    },
  });
  window = await app.firstWindow();
}

test("a newer bundle is staged on first launch and applied on relaunch (FR-8.3)", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "foreman-bundle-e2e-"));
  const userData = mkdtempSync(join(tmpdir(), "foreman-bundle-data-"));
  const feedDir = await publishV2(workdir);
  const baseUrl = await serve(feedDir);
  const feedUrl = `${baseUrl}/feed.json`;

  // First launch: the installed echo-demo label is shown; in the background the
  // shell checks the feed and stages the verified v2 bundle for next launch.
  await launch(feedUrl, userData);
  await window.getByRole("button", { name: /Bejelentkezés ChatGPT/ }).click();
  await expect(window.getByRole("button", { name: /Visszhang futtatása/ })).toBeVisible();

  // Wait for the staged bundle to land (download + verify complete).
  const pendingFile = join(userData, "updates", "pending.json");
  await expect
    .poll(() => {
      try {
        return (JSON.parse(readFileSync(pendingFile, "utf8")) as { version: string }).version;
      } catch {
        return undefined;
      }
    })
    .toBe("0.2.0");
  await app.close();

  // Relaunch on the SAME userData: applyPending swaps in v2 at startup, so the
  // home screen shows the updated launcher label — no reinstall.
  await launch(feedUrl, userData);
  await window.getByRole("button", { name: /Bejelentkezés ChatGPT/ }).click();
  await expect(window.getByText("Frissített visszhang")).toBeVisible();
  await expect(window.getByRole("button", { name: /Visszhang futtatása/ })).toHaveCount(0);
});

test.afterEach(async () => {
  await app?.close();
  server?.close();
});
