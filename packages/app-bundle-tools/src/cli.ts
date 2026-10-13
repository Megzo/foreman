#!/usr/bin/env tsx
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateKeyPair } from "./signing.js";
import { publishBundle } from "./publish.js";

/**
 * App-author CLI (English-only, FR-9.2). Two commands cover the v1 flow:
 *   foreman-bundle keygen <dir>                  -> public.pem + private.pem
 *   foreman-bundle publish <appDir> <feedDir> --key <private.pem>
 *
 * Hosting is out of scope: <feedDir> is a static directory served over HTTPS
 * (or a file:// URL in tests). Logic lives in the tested library modules; this
 * is a thin argv shell.
 */

function fail(message: string): never {
  console.error(`foreman-bundle: ${message}`);
  process.exit(1);
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "keygen") {
    const dir = args[0];
    if (!dir) fail("usage: keygen <dir>");
    const { publicKey, privateKey } = generateKeyPair();
    mkdirSync(resolve(dir), { recursive: true });
    writeFileSync(join(resolve(dir), "public.pem"), publicKey);
    writeFileSync(join(resolve(dir), "private.pem"), privateKey);
    console.log(`wrote public.pem + private.pem to ${resolve(dir)}`);
    return;
  }

  if (command === "publish") {
    const [appDir, outDir] = args;
    const keyFile = getFlag(args, "--key");
    if (!appDir || !outDir || !keyFile) {
      fail("usage: publish <appDir> <feedDir> --key <private.pem>");
    }
    const privateKey = readFileSync(resolve(keyFile), "utf8");
    const { descriptor, feedPath } = await publishBundle({
      appDir: resolve(appDir),
      outDir: resolve(outDir),
      privateKey,
    });
    console.log(`published v${descriptor.version} (${descriptor.size} bytes) -> ${feedPath}`);
    return;
  }

  fail(`unknown command ${JSON.stringify(command)} — expected "keygen" or "publish"`);
}

main().catch((error) => fail((error as Error).message));
