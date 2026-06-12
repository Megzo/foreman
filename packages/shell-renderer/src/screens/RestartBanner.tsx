import type { ShellApi } from "@foreman/shell-main/ipc";
import { t } from "../t.js";

/**
 * FR-2.5 UI half: the codex child process died. We show a calm, non-scary
 * banner — never the raw crash line — with one button that restarts the agent
 * and resumes the interrupted run via thread/resume (main wires restartAgent).
 * The technical detail stays tucked in a collapsed expander for support.
 */
export function RestartBanner({ message, api }: { message: string; api: ShellApi }) {
  return (
    <section data-testid="restart-banner" className="restart-banner" role="alert">
      <h2>{t("A háttérszolgáltatás újraindult")}</h2>
      <p>{t("Folytathatod ott, ahol abbamaradt.")}</p>
      <button type="button" onClick={() => void api.restartAgent()}>
        {t("Folytatás")}
      </button>
      <details className="restart-details">
        <summary>{t("Részletek")}</summary>
        <code>{message}</code>
      </details>
    </section>
  );
}
