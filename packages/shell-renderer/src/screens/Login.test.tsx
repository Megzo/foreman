// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

afterEach(cleanup);
import { App } from "../App.js";
import { makeFakeShell } from "../test-helpers.js";

describe("login screen flows (FR-3.2, FR-3.3)", () => {
  test("the device-code fallback link starts that flow and shows userCode + verificationUrl", async () => {
    const shell = makeFakeShell();
    render(<App api={shell.api} />);
    act(() => shell.pushAuth({ status: "signedOut" }));

    (await screen.findByRole("button", { name: /kóddal/i })).click();
    expect(shell.calls).toEqual(["startLogin:chatgptDeviceCode"]);

    act(() =>
      shell.pushAuth({
        status: "loginPending",
        flow: {
          type: "chatgptDeviceCode",
          userCode: "ABCD-1234",
          verificationUrl: "https://chatgpt.com/device",
        },
      }),
    );

    expect(await screen.findByText("ABCD-1234")).toBeTruthy();
    expect(screen.getByText(/chatgpt\.com\/device/)).toBeTruthy();
  });

  test("a failed login shows a friendly error and retry starts a fresh login", async () => {
    const shell = makeFakeShell();
    render(<App api={shell.api} />);
    act(() => shell.pushAuth({ status: "loginFailed", message: "browser closed" }));

    // Friendly text, never the raw OAuth error (UX requirement); the raw
    // cause is only available behind a collapsed details expander.
    const retry = await screen.findByRole("button", { name: /Újrapróbálás/ });
    const details = screen.getByText("browser closed").closest("details");
    expect(details).toBeTruthy();
    expect(details!.open).toBe(false);

    retry.click();
    act(() => shell.pushAuth({ status: "signedOut" }));

    expect(await screen.findByRole("button", { name: /Bejelentkezés ChatGPT-fiókkal/ })).toBeTruthy();
    expect(shell.calls).toEqual(["cancelLogin"]);
  });
});
