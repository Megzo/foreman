import { useState } from "react";
import type {
  ManifestFormField,
  ManifestTask,
  TaskParamValues,
} from "@foreman/shell-main/ipc";
import { localized, t } from "../t.js";

function initialValues(fields: ManifestFormField[]): TaskParamValues {
  const values: TaskParamValues = {};
  for (const field of fields) {
    if (field.default !== undefined) values[field.id] = field.default;
    else if (field.type === "checkbox") values[field.id] = false;
    else if (field.type === "select") values[field.id] = field.options?.[0]?.value ?? "";
  }
  return values;
}

function isEmpty(value: string | number | boolean | undefined): boolean {
  return value === undefined || value === "";
}

/**
 * Renders a task's parameter form from the manifest field schema (FR-1.3):
 * the five field types, required-gap submit blocking with an inline hint, and
 * a typed TaskParamValues payload on submit. The file picker is a callback so
 * the native dialog stays in the main process (ShellApi.pickFile).
 */
export function ParamForm({
  task,
  pickFile,
  onSubmit,
}: {
  task: ManifestTask;
  pickFile: (extensions?: string[]) => Promise<string | null>;
  onSubmit: (params: TaskParamValues) => void;
}) {
  const fields = task.params ?? [];
  const [values, setValues] = useState<TaskParamValues>(() => initialValues(fields));

  const setValue = (id: string, value: string | number | boolean | undefined) =>
    setValues((current) => {
      const next = { ...current };
      if (value === undefined) delete next[id];
      else next[id] = value;
      return next;
    });

  const missing = fields.filter((field) => field.required && isEmpty(values[field.id]));

  const renderControl = (field: ManifestFormField) => {
    const label = localized(field.label);
    switch (field.type) {
      case "file": {
        const current = values[field.id];
        return (
          <>
            <button
              type="button"
              onClick={() =>
                void pickFile(field.extensions).then((path) => {
                  if (path !== null) setValue(field.id, path);
                })
              }
            >
              {label}
            </button>
            {typeof current === "string" && current !== "" ? <span>{current}</span> : null}
          </>
        );
      }
      case "text":
        return (
          <input
            type="text"
            aria-label={label}
            value={String(values[field.id] ?? "")}
            onChange={(event) => setValue(field.id, event.target.value)}
          />
        );
      case "number":
        return (
          <input
            type="number"
            aria-label={label}
            value={values[field.id] === undefined ? "" : String(values[field.id])}
            onChange={(event) =>
              setValue(
                field.id,
                event.target.value === "" ? undefined : Number(event.target.value),
              )
            }
          />
        );
      case "select":
        return (
          <select
            aria-label={label}
            value={String(values[field.id] ?? "")}
            onChange={(event) => setValue(field.id, event.target.value)}
          >
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {localized(option.label)}
              </option>
            ))}
          </select>
        );
      case "checkbox":
        return (
          <input
            type="checkbox"
            aria-label={label}
            checked={values[field.id] === true}
            onChange={(event) => setValue(field.id, event.target.checked)}
          />
        );
    }
  };

  return (
    <form
      className="param-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (missing.length === 0) onSubmit(values);
      }}
    >
      {fields.map((field) => (
        <div className="param-field" key={field.id}>
          {field.type !== "file" ? <label>{localized(field.label)}</label> : null}
          {renderControl(field)}
        </div>
      ))}
      {missing.length > 0 ? (
        <p className="form-hint">
          {t("Kötelező mező")}: {missing.map((field) => localized(field.label)).join(", ")}
        </p>
      ) : null}
      <button type="submit" disabled={missing.length > 0}>
        {t("Indítás")}
      </button>
    </form>
  );
}
