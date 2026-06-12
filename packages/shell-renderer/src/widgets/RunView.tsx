import type { ManifestTask, TaskEvent } from "@foreman/shell-main/ipc";
import { localized, t } from "../t.js";

/** Canned human-readable feed lines per item type — never raw commands or JSON (UX requirement). */
function feedLine(itemType: string): string | undefined {
  switch (itemType) {
    case "commandExecution":
      return t("Lépés végrehajtása");
    case "fileChange":
      return t("Fájlok írása");
    case "webSearch":
      return t("Keresés");
    case "mcpToolCall":
    case "toolCall":
      return t("Eszköz használata");
    default:
      // agentMessage streams into the message pane; reasoning collapses to the
      // thinking indicator (FR-4.7); unknown types stay silent rather than raw.
      return undefined;
  }
}

/**
 * The task running view (Phase 4): status line, activity feed and the streamed
 * agent message, rendered purely from the recorded TaskEvent stream so the
 * Phase 7 transcript replay can reuse it unchanged.
 */
export function RunView({ task, events }: { task: ManifestTask; events: TaskEvent[] }) {
  const finished = events.find((event) => event.type === "finished");
  const message = events
    .filter((event) => event.type === "agentDelta")
    .map((event) => event.text)
    .join("");
  const feed = events
    .filter((event) => event.type === "itemStarted")
    .map((event) => feedLine(event.itemType))
    .filter((line): line is string => line !== undefined);
  const thinking =
    finished === undefined &&
    events.some((event) => event.type === "itemStarted" && event.itemType === "reasoning");

  return (
    <section className="run-view">
      <h2>{localized(task.label)}</h2>
      <p data-testid="run-status" className="run-status">
        {finished === undefined
          ? t("Folyamatban…")
          : finished.status === "success"
            ? t("Kész")
            : t("Sikertelen")}
      </p>
      <ul data-testid="run-feed" className="run-feed">
        {feed.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
        {thinking ? <li className="thinking">{t("Gondolkodik…")}</li> : null}
      </ul>
      {message !== "" ? (
        <p data-testid="run-message" className="run-message">
          {message}
        </p>
      ) : null}
      {finished?.status === "success" ? (
        <p data-testid="run-success" className="run-terminal success">
          {t("A feladat sikeresen befejeződött.")}
        </p>
      ) : null}
      {finished?.status === "failed" ? (
        <p data-testid="run-failed" className="run-terminal failed">
          {t("A feladat nem sikerült.")} {finished.errorMessage ?? ""}
        </p>
      ) : null}
    </section>
  );
}
