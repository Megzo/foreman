import { readFile } from "node:fs/promises";
import type { AppManifest } from "./manifest-types.js";

export type * from "./manifest-types.js";

/** Validation failure naming the offending field (FR-1.2, app-author-facing). */
export class ManifestError extends Error {
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`Invalid manifest field ${field}: ${detail}`);
    this.name = "ManifestError";
  }
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError(field, "expected an object");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ManifestError(field, "expected a non-empty string");
  }
  return value;
}

function validateSkillRef(value: unknown, field: string): void {
  const skill = requireObject(value, field);
  requireString(skill.name, `${field}.name`);
  requireString(skill.path, `${field}.path`);
}

function validateTask(value: unknown, field: string): void {
  const task = requireObject(value, field);
  requireString(task.id, `${field}.id`);
  requireString(requireObject(task.label, `${field}.label`).hu, `${field}.label.hu`);
  validateSkillRef(task.skill, `${field}.skill`);
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function requireColor(value: unknown, field: string): void {
  if (!HEX_COLOR.test(requireString(value, field))) {
    throw new ManifestError(field, "expected a #rrggbb hex color");
  }
}

/** The manifest schema version this shell understands (PRD State: migrations). */
export const SUPPORTED_SCHEMA_VERSION = 1;

function validateManifest(value: unknown): AppManifest {
  const root = requireObject(value, "(root)");
  if (root.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new ManifestError(
      "schemaVersion",
      `expected ${SUPPORTED_SCHEMA_VERSION}, got ${JSON.stringify(root.schemaVersion)} — update the app`,
    );
  }
  requireString(root.id, "id");
  requireString(root.name, "name");
  requireString(root.version, "version");
  const branding = requireObject(root.branding, "branding");
  requireString(branding.productName, "branding.productName");
  const colors = requireObject(branding.colors, "branding.colors");
  requireColor(colors.primary, "branding.colors.primary");
  for (const optional of ["background", "accent"] as const) {
    if (colors[optional] !== undefined) {
      requireColor(colors[optional], `branding.colors.${optional}`);
    }
  }
  const tasks = root.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new ManifestError("tasks", "expected a non-empty array");
  }
  tasks.forEach((task, index) => validateTask(task, `tasks[${index}]`));
  return root as unknown as AppManifest;
}

export class ManifestLoader {
  async load(filePath: string): Promise<AppManifest> {
    const raw = await readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ManifestError("(root)", `not valid JSON (${(error as Error).message})`);
    }
    return validateManifest(parsed);
  }
}
