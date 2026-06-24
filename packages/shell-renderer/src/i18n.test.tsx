// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { App } from "./App.js";
import { Login } from "./screens/Login.js";
import { setActiveLocale } from "./t.js";
import { makeFakeShell } from "./test-helpers.js";

afterEach(() => {
  cleanup();
  setActiveLocale("hu"); // the locale is a singleton — reset between tests
});

describe("UI localization (Phase 9, FR-9.1)", () => {
  test("under en a top-level screen renders English with no Hungarian source leaking through", () => {
    setActiveLocale("en");
    const shell = makeFakeShell();
    render(<Login auth={{ status: "signedOut" }} api={shell.api} />);

    expect(screen.getByRole("button", { name: "Sign in with your ChatGPT account" })).toBeTruthy();
    // A hardcoded hu literal (bypassing t()) would still be visible here.
    expect(screen.queryByText(/Bejelentkezés ChatGPT-fiókkal/)).toBeNull();
  });

  test("switching the locale in the settings menu re-renders the home in English", async () => {
    const shell = makeFakeShell();
    render(<App api={shell.api} />);
    act(() => shell.pushAuth({ status: "signedIn", account: { type: "chatgpt" } }));

    // Home boots in the hu default.
    fireEvent.click(await screen.findByRole("button", { name: "Beállítások" }));
    expect(screen.getByText("Korábbi futások")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    expect(await screen.findByText("Recent tasks")).toBeTruthy();
    expect(screen.queryByText("Korábbi futások")).toBeNull();
    expect(shell.calls).toContain("setLocale:en");
  });

  test("the persisted locale is applied on boot before the first paint", async () => {
    const shell = makeFakeShell();
    shell.settingsLocale = "en";
    render(<App api={shell.api} />);
    act(() => shell.pushAuth({ status: "signedIn", account: { type: "chatgpt" } }));

    expect(await screen.findByRole("button", { name: "Settings" })).toBeTruthy();
  });
});
