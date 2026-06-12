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

describe("task param form schema (FR-1.3, Phase 4)", () => {
  function withParams(params: unknown): Record<string, unknown> {
    const manifest = validManifest();
    (manifest.tasks as Array<Record<string, unknown>>)[0]!.params = params;
    return manifest;
  }

  test("all five field types load with label, required flag and default", async () => {
    const manifest = withParams([
      { id: "book", type: "file", label: { hu: "Könyv" }, required: true, extensions: ["pdf", "epub"] },
      { id: "title", type: "text", label: { hu: "Cím" }, default: "névtelen" },
      { id: "copies", type: "number", label: { hu: "Példányszám" } },
      {
        id: "address",
        type: "select",
        label: { hu: "Megszólítás" },
        options: [
          { value: "formal", label: { hu: "Magázó" } },
          { value: "informal", label: { hu: "Tegező" } },
        ],
      },
      { id: "cover", type: "checkbox", label: { hu: "Borító készítése" }, default: false },
    ]);

    const loaded = await new ManifestLoader().load(writeManifest(manifest));

    expect(loaded.tasks[0]?.params?.map((field) => field.type)).toEqual([
      "file",
      "text",
      "number",
      "select",
      "checkbox",
    ]);
    expect(loaded.tasks[0]?.params?.[0]).toMatchObject({ id: "book", required: true });
    expect(loaded.tasks[0]?.params?.[1]).toMatchObject({ default: "névtelen" });
  });

  test("an unknown field type fails naming tasks[0].params[0].type", async () => {
    const manifest = withParams([{ id: "x", type: "date", label: { hu: "Dátum" } }]);

    await expect(new ManifestLoader().load(writeManifest(manifest))).rejects.toThrow(
      /tasks\[0\]\.params\[0\]\.type/,
    );
  });

  test("a select field without options fails naming tasks[0].params[0].options", async () => {
    const manifest = withParams([{ id: "x", type: "select", label: { hu: "Választás" } }]);

    await expect(new ManifestLoader().load(writeManifest(manifest))).rejects.toThrow(
      /tasks\[0\]\.params\[0\]\.options/,
    );
  });

  test("a field without a Hungarian label fails naming tasks[0].params[1].label.hu", async () => {
    const manifest = withParams([
      { id: "ok", type: "text", label: { hu: "Jó" } },
      { id: "bad", type: "text", label: { en: "English only" } },
    ]);

    await expect(new ManifestLoader().load(writeManifest(manifest))).rejects.toThrow(
      /tasks\[0\]\.params\[1\]\.label\.hu/,
    );
  });
});

describe("manifest sandbox mode (Phase 4: thread/start sandbox)", () => {
  test("a valid sandbox mode loads and an omitted one stays undefined", async () => {
    const manifest = validManifest();
    manifest.sandbox = "workspace-write";

    const loaded = await new ManifestLoader().load(writeManifest(manifest));
    expect(loaded.sandbox).toBe("workspace-write");

    const without = await new ManifestLoader().load(writeManifest(validManifest()));
    expect(without.sandbox).toBeUndefined();
  });

  test("an invalid sandbox mode fails naming sandbox", async () => {
    const manifest = validManifest();
    manifest.sandbox = "danger-full-access-please";

    await expect(new ManifestLoader().load(writeManifest(manifest))).rejects.toThrow(/sandbox/);
  });
});
