// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

afterEach(cleanup);
import { ChatPane } from "./ChatPane.js";

function renderPane(messages: string[] = []) {
  const sent: string[] = [];
  render(<ChatPane messages={messages} onSend={(text) => sent.push(text)} />);
  return { sent };
}

describe("ChatPane (FR-4.3): the task-scoped chat input", () => {
  test("the user's previous messages render in the transcript", () => {
    renderPane(["legyél formális", "miért fura a 3. fejezet?"]);

    const transcript = screen.getByTestId("chat-transcript");
    expect(transcript.textContent).toContain("legyél formális");
    expect(transcript.textContent).toContain("miért fura a 3. fejezet?");
  });

  test("sending is disabled while the input is empty", () => {
    renderPane();

    expect((screen.getByRole("button", { name: /Üzenet küldése/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  test("submitting delivers the text via onSend and clears the input", () => {
    const { sent } = renderPane();
    const input = screen.getByRole("textbox", { name: /Üzenet a feladatnak/ }) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "használj magázódást" } });
    fireEvent.click(screen.getByRole("button", { name: /Üzenet küldése/ }));

    expect(sent).toEqual(["használj magázódást"]);
    expect(input.value).toBe("");
  });
});
