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

const FIELD_TYPES = ["file", "text", "number", "select", "checkbox"] as const;

function validateFormField(value: unknown, field: string): void {
  const param = requireObject(value, field);
  requireString(param.id, `${field}.id`);
  const type = requireString(param.type, `${field}.type`);
  if (!(FIELD_TYPES as readonly string[]).includes(type)) {
    throw new ManifestError(`${field}.type`, `expected one of ${FIELD_TYPES.join(", ")}`);
  }
  requireString(requireObject(param.label, `${field}.label`).hu, `${field}.label.hu`);
  if (type === "select") {
    const options = param.options;
    if (!Array.isArray(options) || options.length === 0) {
      throw new ManifestError(`${field}.options`, "select fields require a non-empty options array");
    }
    options.forEach((option, index) => {
      const opt = requireObject(option, `${field}.options[${index}]`);
      requireString(opt.value, `${field}.options[${index}].value`);
      requireString(
        requireObject(opt.label, `${field}.options[${index}].label`).hu,
        `${field}.options[${index}].label.hu`,
      );
    });
  }
}

function validateTask(value: unknown, field: string): void {
  const task = requireObject(value, field);
  requireString(task.id, `${field}.id`);
  requireString(requireObject(task.label, `${field}.label`).hu, `${field}.label.hu`);
  validateSkillRef(task.skill, `${field}.skill`);
  if (task.params !== undefined) {
    if (!Array.isArray(task.params)) {
      throw new ManifestError(`${field}.params`, "expected an array");
    }
    task.params.forEach((param, index) => validateFormField(param, `${field}.params[${index}]`));
  }
}

function validateArgvPatterns(value: unknown, field: string): void {
  if (!Array.isArray(value)) {
    throw new ManifestError(field, "expected an array of argv-prefix patterns");
  }
  value.forEach((pattern, index) => {
    if (!Array.isArray(pattern) || pattern.length === 0) {
      throw new ManifestError(
        `${field}[${index}]`,
        'expected a non-empty argv array, e.g. ["python3"]',
      );
    }
    pattern.forEach((part, partIndex) => {
      requireString(part, `${field}[${index}][${partIndex}]`);
    });
  });
}

function validatePolicy(value: unknown, field: string): void {
  const policy = requireObject(value, field);
  for (const list of ["allowCommands", "allowCommandsForSession"] as const) {
    if (policy[list] !== undefined) {
      validateArgvPatterns(policy[list], `${field}.${list}`);
    }
  }
  if (policy.allowFileChanges !== undefined && typeof policy.allowFileChanges !== "boolean") {
    throw new ManifestError(`${field}.allowFileChanges`, "expected a boolean");
  }
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
  if (root.sandbox !== undefined && root.sandbox !== "read-only" && root.sandbox !== "workspace-write") {
    throw new ManifestError("sandbox", 'expected "read-only" or "workspace-write"');
  }
  if (root.policy !== undefined) {
    validatePolicy(root.policy, "policy");
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
