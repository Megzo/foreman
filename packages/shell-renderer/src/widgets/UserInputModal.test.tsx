// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

afterEach(cleanup);
import type { UserInputAnswers, UserInputRequestPayload } from "@foreman/shell-main/ipc";
import { UserInputModal } from "./UserInputModal.js";

const OPTIONS_REQUEST: UserInputRequestPayload = {
  requestId: 7,
  questions: [
    {
      id: "tone",
      header: "Megszólítás",
      question: "Formális vagy informális megszólítást használjak?",
      options: [
        { label: "Formális", description: "magázódás" },
        { label: "Informális", description: "tegeződés" },
      ],
    },
  ],
};

const FREE_TEXT_REQUEST: UserInputRequestPayload = {
  requestId: 8,
  questions: [{ id: "title", header: "Cím", question: "Mi legyen a könyv címe?" }],
};

function renderModal(request: UserInputRequestPayload) {
  const submitted: UserInputAnswers[] = [];
  render(<UserInputModal request={request} onSubmit={(answers) => submitted.push(answers)} />);
  return { submitted };
}

describe("UserInputModal (FR-4.4): agent questions as a native form", () => {
  test("a question with options renders them as radio choices, never raw JSON", () => {
    renderModal(OPTIONS_REQUEST);

    expect(screen.getByText(/Formális vagy informális megszólítást/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Formális/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Informális/ })).toBeTruthy();
  });

  test("submit is disabled until every question has an answer", () => {
    renderModal(OPTIONS_REQUEST);

    const submit = screen.getByRole("button", { name: /Küldés/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /Formális/ }));
    expect(submit.disabled).toBe(false);
  });

  test("the chosen option is submitted in the protocol answer shape", () => {
    const { submitted } = renderModal(OPTIONS_REQUEST);

    fireEvent.click(screen.getByRole("radio", { name: /Informális/ }));
    fireEvent.click(screen.getByRole("button", { name: /Küldés/ }));

    expect(submitted).toEqual([{ tone: { answers: ["Informális"] } }]);
  });

  test("a question without options renders a free-text field whose value is submitted", () => {
    const { submitted } = renderModal(FREE_TEXT_REQUEST);

    fireEvent.change(screen.getByRole("textbox", { name: /Mi legyen a könyv címe/ }), {
      target: { value: "Alice Csodaországban" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Küldés/ }));

    expect(submitted).toEqual([{ title: { answers: ["Alice Csodaországban"] } }]);
  });
});
