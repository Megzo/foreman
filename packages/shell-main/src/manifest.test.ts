import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { ManifestLoader } from "./manifest.js";

const ECHO_DEMO_MANIFEST = fileURLToPath(
  new URL("../../../apps/echo-demo/manifest.json", import.meta.url),
);

function writeManifest(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "foreman-manifest-"));
  const path = join(dir, "manifest.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

/** A minimal valid manifest the invalid-field tests mutate one field at a time. */
function validManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "echo-demo",
    name: "Echo Demo",
    version: "0.1.0",
    locale: "hu",
    branding: {
      productName: "Echo Demo",
      colors: { primary: "#1f6feb" },
    },
    tasks: [
      {
        id: "echo",
        label: { hu: "Visszhang", en: "Echo" },
        description: { hu: "Kiír egy üzenetet", en: "Echoes a message" },
        skill: { name: "echo", path: "skill/SKILL.md" },
      },
    ],
  };
}

describe("ManifestLoader (FR-1.1, FR-1.2)", () => {
  test("the echo-demo manifest loads with branding, locale and task launcher data", async () => {
    const loader = new ManifestLoader();

    const manifest = await loader.load(ECHO_DEMO_MANIFEST);

    expect(manifest.id).toBe("echo-demo");
    expect(manifest.branding.productName).toBeTruthy();
    expect(manifest.branding.colors.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.tasks.length).toBeGreaterThan(0);
    expect(manifest.tasks[0]?.label.hu).toBeTruthy();
    expect(manifest.tasks[0]?.skill.name).toBeTruthy();
    expect(manifest.tasks[0]?.skill.path).toBeTruthy();
  });

  test("a task without a skill fails startup naming tasks[0].skill", async () => {
    const manifest = validManifest();
    delete (manifest.tasks as Array<Record<string, unknown>>)[0]!.skill;

    await expect(new ManifestLoader().load(writeManifest(manifest))).rejects.toThrow(
      /tasks\[0\]\.skill/,
    );
  });

  test("a malformed brand color fails naming branding.colors.primary", async () => {
    const manifest = validManifest();
    (manifest.branding as { colors: { primary: string } }).colors.primary = "blue";

    await expect(new ManifestLoader().load(writeManifest(manifest))).rejects.toThrow(
      /branding\.colors\.primary/,
    );
  });

  test("an unknown schema version fails naming schemaVersion", async () => {
    const manifest = validManifest();
    manifest.schemaVersion = 99;

    await expect(new ManifestLoader().load(writeManifest(manifest))).rejects.toThrow(
      /schemaVersion/,
    );
  });
});
