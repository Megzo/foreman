// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { App } from "./App.js";
import { themeTokens } from "./theme.js";
import {
  makeFakeShell,
  TEST_MANIFEST,
  TEST_MANIFEST_ALT,
} from "./test-helpers.js";

afterEach(cleanup);

describe("manifest-driven theme tokens (Phase 9, FR-1.1)", () => {
  test("branding colors land as the documented CSS custom properties", () => {
    expect(themeTokens(TEST_MANIFEST.branding)).toEqual({
      "--color-primary": "#1f6feb",
      "--color-primary-contrast": "#ffffff",
      "--color-background": "#f6f8fa",
      "--color-accent": "#2da44e",
    });
  });

  test("two manifests yield distinct token sets — the framework is not hardcoded", () => {
    const echo = themeTokens(TEST_MANIFEST.branding);
    const alt = themeTokens(TEST_MANIFEST_ALT.branding);
    expect(alt["--color-primary"]).toBe("#7c3aed");
    expect(alt["--color-primary"]).not.toBe(echo["--color-primary"]);
  });

  test("optional colors fall back to neutrals and the accent to the primary", () => {
    expect(themeTokens({ productName: "x", colors: { primary: "#000000" } })).toEqual({
      "--color-primary": "#000000",
      "--color-primary-contrast": "#ffffff",
      "--color-background": "#ffffff",
      "--color-accent": "#000000",
    });
  });

  test("the on-primary text token flips to dark on a light brand color, so buttons stay readable", () => {
    expect(
      themeTokens({ productName: "x", colors: { primary: "#f5f5f5" } })["--color-primary-contrast"],
    ).toBe("#1f2328");
  });
});

describe("manifest-driven window title (Phase 9, FR-1.1)", () => {
  test("the window title follows the manifest's product name, distinctly per app", async () => {
    render(<App api={makeFakeShell({ ok: true, manifest: TEST_MANIFEST, shellVersion: "0.0.1" }).api} />);
    act(() => {});
    expect(await screen.findByTestId("screen-loading")).toBeTruthy();
    expect(document.title).toBe("Echo Demo");

    cleanup();
    render(<App api={makeFakeShell({ ok: true, manifest: TEST_MANIFEST_ALT, shellVersion: "0.0.1" }).api} />);
    expect(await screen.findByTestId("screen-loading")).toBeTruthy();
    expect(document.title).toBe("Könyvfordító");
  });
});
