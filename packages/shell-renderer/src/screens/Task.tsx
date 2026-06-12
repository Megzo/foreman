import { useEffect, useState } from "react";
import type { ManifestTask, ShellApi, TaskEvent } from "@foreman/shell-main/ipc";
import { ParamForm } from "../widgets/ParamForm.js";
import { RunView } from "../widgets/RunView.js";
import { localized, t } from "../t.js";

/**
 * One task's flow (Phase 4): param form -> launch over IPC -> running view fed
 * by the task event stream -> terminal state with a way back to the launchers.
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

  useEffect(
    () => api.onTaskEvent((event) => setEvents((current) => [...current, event])),
    [api],
  );

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
      {finished ? (
        <button type="button" onClick={onBack}>
          {t("Vissza")}
        </button>
      ) : null}
    </section>
  );
}
