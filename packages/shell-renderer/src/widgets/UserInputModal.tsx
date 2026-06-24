import { useState } from "react";
import type { UserInputAnswers, UserInputRequestPayload } from "@foreman/shell-main/ipc";
import { t } from "../t.js";

/**
 * `item/tool/requestUserInput` rendered as a native modal form (FR-4.4):
 * options become radio choices, an option-less question becomes free text.
 * Submitting returns the protocol-shaped answers, keyed by question id.
 */
export function UserInputModal({
  request,
  onSubmit,
}: {
  request: UserInputRequestPayload;
  onSubmit: (answers: UserInputAnswers) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  const answered = request.questions.every((question) => (values[question.id] ?? "") !== "");

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form
        className="user-input-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(
            Object.fromEntries(
              request.questions.map((question) => [
                question.id,
                { answers: [values[question.id] ?? ""] },
              ]),
            ),
          );
        }}
      >
        {request.questions.map((question) => (
          <fieldset key={question.id}>
            {question.header ? <legend>{question.header}</legend> : null}
            <p id={`user-input-q-${question.id}`}>{question.question}</p>
            {question.options?.length ? (
              question.options.map((option) => (
                <label key={option.label} className="user-input-option">
                  <input
                    type="radio"
                    name={question.id}
                    value={option.label}
                    checked={values[question.id] === option.label}
                    onChange={() =>
                      setValues((current) => ({ ...current, [question.id]: option.label }))
                    }
                  />
                  {option.label}
                  {option.description ? <small> {option.description}</small> : null}
                </label>
              ))
            ) : (
              <input
                type="text"
                aria-labelledby={`user-input-q-${question.id}`}
                value={values[question.id] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [question.id]: event.target.value }))
                }
              />
            )}
          </fieldset>
        ))}
        <div className="dialog-actions">
          <button type="submit" className="primary" disabled={!answered}>
            {t("Küldés")}
          </button>
        </div>
      </form>
    </div>
  );
}
