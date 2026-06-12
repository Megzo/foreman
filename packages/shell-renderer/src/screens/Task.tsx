import { useEffect, useState } from "react";
import type {
  ManifestTask,
  ShellApi,
  TaskEvent,
  UserInputRequestPayload,
} from "@foreman/shell-main/ipc";
import { ChatPane } from "../widgets/ChatPane.js";
import { ConfirmDialog } from "../widgets/ConfirmDialog.js";
import { ParamForm } from "../widgets/ParamForm.js";
import { RunView } from "../widgets/RunView.js";
import { UserInputModal } from "../widgets/UserInputModal.js";
import { localized, t } from "../t.js";

/**
 * One task's flow: param form -> launch over IPC -> running view fed by the
 * task event stream -> terminal state with a way back to the launchers.
 * Phase 6 adds the task-scoped chat (FR-4.3), the cancel flow with
 * confirmation (FR-4.5) and the agent's user-input questions as a native
 * modal (FR-4.4). The chat transcript lives here, in per-run renderer state
 * (persistence is Phase 7).
 */
export function TaskScreen({
  task,
  api,
  onBack,
}: {
  task: ManifestTask;
  api: ShellApi;
  onBack: () => void;
}) {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [launched, setLaunched] = useState(false);
  const [chatMessages, setChatMessages] = useState<string[]>([]);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [userInput, setUserInput] = useState<UserInputRequestPayload | undefined>();

  useEffect(
    () => api.onTaskEvent((event) => setEvents((current) => [...current, event])),
    [api],
  );
  useEffect(() => api.onUserInputRequest(setUserInput), [api]);

  if (!launched) {
    return (
      <section className="task-setup">
        <h2>{localized(task.label)}</h2>
        <ParamForm
          task={task}
          pickFile={(extensions) => api.pickFile(extensions)}
          onSubmit={(params) => {
            setLaunched(true);
            void api.launchTask(task.id, params);
          }}
        />
        <button type="button" className="link" onClick={onBack}>
          {t("Mégse")}
        </button>
      </section>
    );
  }

  const finished = events.some((event) => event.type === "finished");
  return (
    <section className="task-run">
      <RunView task={task} events={events} />
      <ChatPane
        messages={chatMessages}
        onSend={(text) => {
          setChatMessages((current) => [...current, text]);
          void api.sendChat(text);
        }}
      />
      {!finished ? (
        <button type="button" onClick={() => setConfirmingCancel(true)}>
          {t("Megszakítás")}
        </button>
      ) : (
        <button type="button" onClick={onBack}>
          {t("Vissza")}
        </button>
      )}
      {confirmingCancel ? (
        <ConfirmDialog
          message={t("Biztosan megszakítod a feladatot?")}
          confirmLabel={t("Igen, megszakítom")}
          onConfirm={() => {
            setConfirmingCancel(false);
            void api.cancelTask();
          }}
          onDismiss={() => setConfirmingCancel(false)}
        />
      ) : null}
      {userInput ? (
        <UserInputModal
          request={userInput}
          onSubmit={(answers) => {
            setUserInput(undefined);
            void api.answerUserInput(userInput.requestId, answers);
          }}
        />
      ) : null}
    </section>
  );
}
