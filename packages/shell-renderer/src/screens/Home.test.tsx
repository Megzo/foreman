// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

afterEach(cleanup);
import { App } from "../App.js";
import { makeFakeShell } from "../test-helpers.js";

function renderSignedInHome() {
  const shell = makeFakeShell();
  render(<App api={shell.api} />);
  act(() =>
    shell.pushAuth({
      status: "signedIn",
      account: { type: "chatgpt", email: "user@example.com", planType: "plus" },
    }),
  );
  return shell;
}

describe("home settings menu (FR-3.4)", () => {
  test("shows the signed-in account and the shell version", async () => {
    renderSignedInHome();

    fireEvent.click(await screen.findByRole("button", { name: /Beállítások/ }));

    expect(await screen.findByText("user@example.com")).toBeTruthy();
    expect(screen.getByText(/0\.0\.1/)).toBeTruthy();
  });

  test("logout asks main to log out", async () => {
    const shell = renderSignedInHome();

    fireEvent.click(await screen.findByRole("button", { name: /Beállítások/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Kijelentkezés/ }));

    expect(shell.calls).toEqual(["logout"]);
  });
});
