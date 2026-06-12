import { useState } from "react";
import { t } from "../t.js";

/**
 * The task-scoped chat input (FR-4.3). Only the user's own messages live here
 * (per-run renderer state); the agent's replies stream into the RunView
 * message pane. There is no blank chat anywhere — this pane only exists
 * inside a task context (UX requirement).
 */
export function ChatPane({
  messages,
  onSend,
}: {
  messages: string[];
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div className="chat-pane">
      <ul data-testid="chat-transcript" className="chat-transcript">
        {messages.map((message, index) => (
          <li key={index} className="chat-user-message">
            {message}
          </li>
        ))}
      </ul>
      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          onSend(draft);
          setDraft("");
        }}
      >
        <input
          type="text"
          aria-label={t("Üzenet a feladatnak")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={draft.trim() === ""}>
          {t("Üzenet küldése")}
        </button>
      </form>
    </div>
  );
}
