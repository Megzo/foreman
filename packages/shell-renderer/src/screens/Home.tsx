import { useEffect, useState } from "react";
import type {
  AccountInfo,
  AppManifest,
  ManifestTask,
  RunRecord,
  RunStatus,
  ShellApi,
} from "@foreman/shell-main/ipc";
import { TaskScreen } from "./Task.js";
import { localized, t } from "../t.js";

/** Localized run-status label, shared by the history rows and the resume offer. */
function runStatusLabel(status: RunStatus): string {
  switch (status) {
    case "running":
      return t("Folyamatban");
    case "success":
      return t("Kész");
    case "failed":
      return t("Sikertelen");
    case "cancelled":
      return t("Megszakítva");
  }
}

export function Home({
  manifest,
  account,
  shellVersion,
  api,
}: {
  manifest: AppManifest;
  account: AccountInfo;
  shellVersion: string;
  api: ShellApi;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTask, setActiveTask] = useState<ManifestTask | undefined>();
  const [resumeRunId, setResumeRunId] = useState<string | undefined>();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [resumable, setResumable] = useState<RunRecord | undefined>();

  // Load the run history and any resumable run on mount and whenever we return
  // from a task run, so a just-finished run shows up and a completed resume
  // stops being offered (FR-7.2/7.3).
  useEffect(() => {
    if (activeTask) return;
    let cancelled = false;
    void api.listRuns().then((list) => {
      if (!cancelled) setRuns(list);
    });
    void api.findResumable().then((run) => {
      if (!cancelled) setResumable(run);
    });
    return () => {
      cancelled = true;
    };
  }, [api, activeTask]);

  const findTask = (taskId: string) =>
    manifest.tasks.find((candidate) => candidate.id === taskId);
  const taskLabel = (taskId: string) => {
    const task = findTask(taskId);
    return task ? localized(task.label) : taskId;
  };

  if (activeTask) {
    return (
      <TaskScreen
        task={activeTask}
        api={api}
        resumeRunId={resumeRunId}
        onBack={() => {
          setActiveTask(undefined);
          setResumeRunId(undefined);
        }}
      />
    );
  }

  return (
    <section className="home">
      <header className="home-header">
        <h1>{manifest.branding.productName}</h1>
        <button
          type="button"
          className="link"
          aria-label={t("Beállítások")}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          {t("Beállítások")}
        </button>
      </header>
      {settingsOpen ? (
        <aside className="settings-menu">
          <p>{account.email ?? account.type}</p>
          <p>
            {t("Verzió")}: {shellVersion} · {manifest.name} {manifest.version}
          </p>
          <button type="button" onClick={() => void api.logout()}>
            {t("Kijelentkezés")}
          </button>
        </aside>
      ) : null}
      {resumable ? (
        <aside data-testid="resume-offer" className="resume-offer">
          <p>
            {t("Egy korábbi feladat félbeszakadt:")} <strong>{taskLabel(resumable.taskId)}</strong>
          </p>
          <div className="resume-actions">
            <button
              type="button"
              onClick={() => {
                const task = findTask(resumable.taskId);
                if (!task) return;
                setResumeRunId(resumable.runId);
                setActiveTask(task);
              }}
            >
              {t("Folytatás")}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                void api.dismissResume(resumable.runId);
                setResumable(undefined);
              }}
            >
              {t("Új indítása")}
            </button>
          </div>
        </aside>
      ) : null}
      <div className="launchers">
        {manifest.tasks.map((task) => (
          <button
            type="button"
            key={task.id}
            className="launcher-card"
            onClick={() => setActiveTask(task)}
          >
            <strong>{localized(task.label)}</strong>
            {task.description ? <span>{localized(task.description)}</span> : null}
          </button>
        ))}
      </div>
      <section className="history">
        <h2>{t("Korábbi futások")}</h2>
        {runs.length === 0 ? (
          <p data-testid="history-empty" className="history-empty">
            {t("Itt jelennek meg a korábbi feladataid, amint elindítasz egyet.")}
          </p>
        ) : (
          <ul data-testid="run-history" className="run-history">
            {runs.map((run) => (
              <li key={run.runId} className="history-row">
                <span className="history-task">{taskLabel(run.taskId)}</span>
                <span className={`history-status status-${run.status}`}>
                  {runStatusLabel(run.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
