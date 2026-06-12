// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(cleanup);
import type { ManifestTask, TaskParamValues } from "@foreman/shell-main/ipc";
import { ParamForm } from "./ParamForm.js";

const TASK: ManifestTask = {
  id: "translate",
  label: { hu: "Könyv fordítása" },
  skill: { name: "translate", path: "skill/SKILL.md" },
  params: [
    { id: "book", type: "file", label: { hu: "Könyv fájl" }, required: true, extensions: ["pdf", "epub"] },
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
    { id: "cover", type: "checkbox", label: { hu: "Borító készítése" } },
  ],
};

function renderForm(overrides: { pickFile?: (extensions?: string[]) => Promise<string | null> } = {}) {
  const submitted: TaskParamValues[] = [];
  const pickFile = overrides.pickFile ?? (async () => "/home/user/book.epub");
  render(<ParamForm task={TASK} pickFile={pickFile} onSubmit={(params) => submitted.push(params)} />);
  return { submitted };
}

describe("ParamForm (FR-1.3): the five field types from the manifest schema", () => {
  test("renders one control per field type with the localized label", () => {
    renderForm();

    expect(screen.getByRole("button", { name: /Könyv fájl/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /Cím/ })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: /Példányszám/ })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Megszólítás/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Magázó" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Borító készítése/ })).toBeTruthy();
  });

  test("a manifest default prefills its field", () => {
    renderForm();

    expect((screen.getByRole("textbox", { name: /Cím/ }) as HTMLInputElement).value).toBe(
      "névtelen",
    );
  });

  test("a missing required field disables submit and shows an inline hint", () => {
    renderForm();

    const submit = screen.getByRole("button", { name: /Indítás/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText(/Kötelező/)).toBeTruthy();
  });

  test("the file picker fills the field via pickFile and enables submit", async () => {
    const picked: Array<string[] | undefined> = [];
    renderForm({
      pickFile: async (extensions) => {
        picked.push(extensions);
        return "/home/user/book.epub";
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Könyv fájl/ }));
    await screen.findByText(/book\.epub/);

    expect(picked).toEqual([["pdf", "epub"]]);
    expect((screen.getByRole("button", { name: /Indítás/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  test("submit emits typed params: file/text strings, number, select value, checkbox boolean", async () => {
    const { submitted } = renderForm();

    fireEvent.click(screen.getByRole("button", { name: /Könyv fájl/ }));
    await screen.findByText(/book\.epub/);
    fireEvent.change(screen.getByRole("spinbutton", { name: /Példányszám/ }), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: /Megszólítás/ }), {
      target: { value: "informal" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Borító készítése/ }));
    fireEvent.click(screen.getByRole("button", { name: /Indítás/ }));

    expect(submitted).toEqual([
      {
        book: "/home/user/book.epub",
        title: "névtelen",
        copies: 3,
        address: "informal",
        cover: true,
      },
    ]);
  });

  test("a cancelled file pick leaves the field empty and submit disabled", async () => {
    renderForm({ pickFile: async () => null });

    fireEvent.click(screen.getByRole("button", { name: /Könyv fájl/ }));
    await Promise.resolve();

    expect((screen.getByRole("button", { name: /Indítás/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
